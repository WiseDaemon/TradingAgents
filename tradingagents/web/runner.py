"""Analysis Job Runner for Web UI.

Bridges LangGraph execution to an asynchronous event queue for Server-Sent Events (SSE).
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
import re
import threading
import time
import uuid
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.dataflows.symbol_utils import COUNTRY_EXCHANGES, format_ticker_for_country, normalize_symbol

logger = logging.getLogger(__name__)

# Active jobs registry
_JOBS: dict[str, AnalysisJob] = {}


class AnalysisJob:
    """Manages execution and streaming state for a single analysis run."""

    def __init__(
        self,
        job_id: str,
        ticker: str,
        market: str,
        analysis_date: str,
        selected_analysts: list[str],
        config: dict[str, Any],
        loop: asyncio.AbstractEventLoop,
    ):
        self.job_id = job_id
        self.raw_ticker = ticker
        self.market = market
        self.ticker = format_ticker_for_country(ticker, market)
        self.analysis_date = analysis_date
        self.selected_analysts = selected_analysts or ["market", "social", "news", "fundamentals"]
        self.config = config
        self.loop = loop

        self.queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.status = "pending"  # pending, running, completed, failed, cancelled
        self.stop_requested = False
        self.start_time: float | None = None
        self.end_time: float | None = None

        self.agent_statuses: dict[str, str] = {
            "Market Analyst": "pending",
            "Sentiment Analyst": "pending",
            "News Analyst": "pending",
            "Fundamentals Analyst": "pending",
            "Bull Researcher": "pending",
            "Bear Researcher": "pending",
            "Research Manager": "pending",
            "Trader": "pending",
            "Aggressive Analyst": "pending",
            "Neutral Analyst": "pending",
            "Conservative Analyst": "pending",
            "Portfolio Manager": "pending",
        }

        self.reports: dict[str, str] = {
            "market_report": "",
            "sentiment_report": "",
            "news_report": "",
            "fundamentals_report": "",
            "investment_plan": "",
            "trader_investment_plan": "",
            "final_trade_decision": "",
        }

        self.debate_data: dict[str, Any] = {
            "bull_thesis": "",
            "bear_thesis": "",
            "judge_ruling": "",
            "bull_points": [],
            "bear_points": [],
            "risk_debates": {
                "aggressive": "",
                "neutral": "",
                "conservative": "",
            },
        }

        self.decision_info: dict[str, Any] = {
            "signal": "PENDING",
            "confidence": 0,
            "risk_score": "N/A",
            "summary": "",
            "target_allocation": "0%",
        }

        self._thread: threading.Thread | None = None
        self._processed_msg_ids: set[str] = set()

    def push_event(self, event_type: str, data: dict[str, Any]):
        """Thread-safely push an event to the SSE queue."""
        event = {
            "event": event_type,
            "job_id": self.job_id,
            "timestamp": datetime.datetime.now().strftime("%H:%M:%S"),
            "data": data,
        }
        if not self.loop.is_closed():
            self.loop.call_soon_threadsafe(self.queue.put_nowait, event)

    def log(self, log_type: str, content: str):
        """Push a log entry to the stream console."""
        self.push_event("log", {"type": log_type, "content": content})

    def update_agent_status(self, agent: str, status: str):
        """Update agent status and notify frontend."""
        if agent in self.agent_statuses:
            self.agent_statuses[agent] = status
            self.push_event("agent_status", {"agent": agent, "status": status})

    def update_phase(self, phase: int, phase_name: str, active_agent: str):
        """Update current pipeline phase (1=Analyst, 2=Debate, 3=Strategy, 4=Risk/PM, 5=Complete)."""
        self.push_event("pipeline_phase", {
            "phase": phase,
            "phase_name": phase_name,
            "active_agent": active_agent,
        })

    def update_report(self, section: str, title: str, content: str):
        """Update report section and notify frontend."""
        self.reports[section] = content
        self.push_event("report_section", {
            "section": section,
            "title": title,
            "content": content,
        })

    def update_debate(self, debate_payload: dict[str, Any]):
        """Push structured debate points to the frontend."""
        self.debate_data.update(debate_payload)
        self.push_event("debate_update", self.debate_data)

    def desk_action(self, agent: str, action: str, speech: str = ""):
        """Push animated office desk actions (typing, debating, reviewing) with thought bubbles."""
        self.push_event("desk_action", {
            "agent": agent,
            "action": action,  # typing, talking, reviewing, finished
            "speech": speech,
        })

    def start(self):
        """Start the worker thread."""
        self.status = "running"
        self.start_time = time.time()
        self._thread = threading.Thread(target=self._run_worker, daemon=True)
        self._thread.start()

    def cancel(self):
        """Request cancellation."""
        self.stop_requested = True
        self.status = "cancelled"
        self.log("System", "Analysis run cancelled by user.")
        self.push_event("complete", {"status": "cancelled", "message": "Job cancelled by user."})
        self.loop.call_soon_threadsafe(self.queue.put_nowait, None)

    def _has_llm_key(self) -> bool:
        """Check if an API key exists for the configured provider."""
        provider = self.config.get("llm_provider", "openai").lower()
        key_vars = {
            "openai": ["OPENAI_API_KEY"],
            "google": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
            "anthropic": ["ANTHROPIC_API_KEY"],
            "deepseek": ["DEEPSEEK_API_KEY"],
            "xai": ["XAI_API_KEY"],
            "groq": ["GROQ_API_KEY"],
            "ollama": ["OLLAMA_BASE_URL"],
            "openrouter": ["OPENROUTER_API_KEY"],
        }
        vars_to_check = key_vars.get(provider, [f"{provider.upper()}_API_KEY"])
        return any(bool(os.environ.get(v)) for v in vars_to_check)

    def _run_worker(self):
        """Background thread executing the analysis graph."""
        try:
            market_info = COUNTRY_EXCHANGES.get(self.market, COUNTRY_EXCHANGES.get("US", {}))
            benchmark = market_info.get("benchmark", "SPY")

            self.log("System", f"Initiating multi-agent analysis for {self.ticker} ({market_info.get('name', 'Global')})")
            self.log("System", f"Benchmark Index: {benchmark} ({market_info.get('benchmark_name', '')})")
            self.log("System", f"Analysis Target Date: {self.analysis_date}")
            self.log("System", f"Selected Analysts: {', '.join(self.selected_analysts)}")

            if not self._has_llm_key():
                # No API key detected -> Run rich interactive simulation so user experiences
                # the full Stitch UI and workflow without immediate API setup
                self.log("Warning", f"No API key detected for '{self.config.get('llm_provider')}'. Running high-fidelity demonstration mode.")
                self._run_simulation(market_info)
            else:
                self._run_real_graph(market_info)

        except Exception as e:
            logger.exception("Analysis run failed: %s", e)
            self.status = "failed"
            self.log("Error", f"Execution error: {str(e)}")
            self.push_event("error", {"message": str(e)})
        finally:
            self.end_time = time.time()
            if self.status != "cancelled":
                self.status = "completed"
                elapsed = round(self.end_time - (self.start_time or self.end_time), 1)
                self.push_event("complete", {
                    "status": "completed",
                    "elapsed_seconds": elapsed,
                    "decision": self.decision_info,
                })
            # Sentinel to close SSE
            self.loop.call_soon_threadsafe(self.queue.put_nowait, None)

    def _run_real_graph(self, market_info: dict[str, Any]):
        """Run the actual TradingAgentsGraph."""
        # Initialize TradingAgentsGraph
        self.update_phase(1, "Analyst Team", "Market Analyst")
        self.update_agent_status("Market Analyst", "in_progress")

        graph = TradingAgentsGraph(
            selected_analysts=self.selected_analysts,
            config=self.config,
            debug=True,
        )

        instrument_context = graph.resolve_instrument_context(self.ticker, "stock")
        init_agent_state = graph.propagator.create_initial_state(
            self.ticker,
            self.analysis_date,
            asset_type="stock",
            instrument_context=instrument_context,
        )
        args = graph.propagator.get_graph_args()

        checkpoint_tid = graph.begin_checkpoint(self.ticker, self.analysis_date, "stock")
        if checkpoint_tid is not None:
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = checkpoint_tid

        trace = []
        try:
            for chunk in graph.graph.stream(graph.checkpoint_input(init_agent_state), **args):
                if self.stop_requested:
                    break

                # Process messages
                for message in chunk.get("messages", []):
                    msg_id = getattr(message, "id", None)
                    if msg_id and msg_id in self._processed_msg_ids:
                        continue
                    if msg_id:
                        self._processed_msg_ids.add(msg_id)

                    content = getattr(message, "content", "")
                    if isinstance(content, list):
                        content = " ".join(str(c) for c in content)
                    content_str = str(content).strip()

                    msg_type = "System"
                    if isinstance(message, HumanMessage):
                        msg_type = "User"
                    elif isinstance(message, ToolMessage):
                        msg_type = "Data"
                    elif isinstance(message, AIMessage):
                        msg_type = "Agent"

                    if content_str:
                        # Truncate very long raw data for UI log
                        display_text = content_str[:250] + ("..." if len(content_str) > 250 else "")
                        self.log(msg_type, display_text)

                    # Extract tool calls
                    if hasattr(message, "tool_calls") and message.tool_calls:
                        for tc in message.tool_calls:
                            tc_name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "tool")
                            tc_args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {})
                            arg_str = ", ".join(f"{k}={v}" for k, v in list(tc_args.items())[:3])
                            self.log("ToolCall", f"{tc_name}({arg_str})")

                # Analyst Reports
                if chunk.get("market_report"):
                    self.update_report("market_report", "Market Technicals", chunk["market_report"])
                    self.update_agent_status("Market Analyst", "completed")
                    if "social" in self.selected_analysts:
                        self.update_agent_status("Sentiment Analyst", "in_progress")

                if chunk.get("sentiment_report"):
                    self.update_report("sentiment_report", "Social Sentiment", chunk["sentiment_report"])
                    self.update_agent_status("Sentiment Analyst", "completed")
                    if "news" in self.selected_analysts:
                        self.update_agent_status("News Analyst", "in_progress")

                if chunk.get("news_report"):
                    self.update_report("news_report", "News & Macro", chunk["news_report"])
                    self.update_agent_status("News Analyst", "completed")
                    if "fundamentals" in self.selected_analysts:
                        self.update_agent_status("Fundamentals Analyst", "in_progress")

                if chunk.get("fundamentals_report"):
                    self.update_report("fundamentals_report", "Fundamental Analysis", chunk["fundamentals_report"])
                    self.update_agent_status("Fundamentals Analyst", "completed")

                # Research Team Debate
                if chunk.get("investment_debate_state"):
                    debate_state = chunk["investment_debate_state"]
                    self.update_phase(2, "Bull vs Bear Debate", "Research Manager")
                    self.update_agent_status("Bull Researcher", "completed")
                    self.update_agent_status("Bear Researcher", "completed")

                    bull = debate_state.get("bull_history", "")
                    bear = debate_state.get("bear_history", "")
                    judge = debate_state.get("judge_decision", "")

                    debate_md = f"### Bull Thesis\n{bull}\n\n### Bear Counter-Thesis\n{bear}\n\n### Manager Synthesis\n{judge}"
                    self.update_report("investment_plan", "Research Team Debate", debate_md)

                    # Extract debate bullet points
                    bull_pts = [p.strip("- *") for p in bull.split("\n") if p.strip().startswith(("-", "*", "1.", "2.", "3."))][:5]
                    bear_pts = [p.strip("- *") for p in bear.split("\n") if p.strip().startswith(("-", "*", "1.", "2.", "3."))][:5]
                    self.update_debate({
                        "bull_thesis": bull,
                        "bear_thesis": bear,
                        "judge_ruling": judge,
                        "bull_points": bull_pts or [bull[:180] + "..."],
                        "bear_points": bear_pts or [bear[:180] + "..."],
                    })

                    if judge:
                        self.update_agent_status("Research Manager", "completed")
                        self.update_phase(3, "Trading Strategy", "Trader")
                        self.update_agent_status("Trader", "in_progress")
                        self.desk_action("Research Manager", "talking", "Debate concluded. Bull thesis approved.")

                # Risk Debate State
                if chunk.get("risk_debate_state"):
                    risk_state = chunk["risk_debate_state"]
                    agg = risk_state.get("aggressive_history", "")
                    neu = risk_state.get("neutral_history", "")
                    con = risk_state.get("conservative_history", "")
                    self.update_debate({
                        "risk_debates": {
                            "aggressive": agg,
                            "neutral": neu,
                            "conservative": con,
                        }
                    })

                # Trader Plan
                if chunk.get("trader_investment_plan"):
                    self.update_report("trader_investment_plan", "Trading Strategy Plan", chunk["trader_investment_plan"])
                    self.update_agent_status("Trader", "completed")
                    self.update_phase(4, "Risk Management & Portfolio Manager", "Portfolio Manager")
                    self.update_agent_status("Aggressive Analyst", "completed")
                    self.update_agent_status("Neutral Analyst", "completed")
                    self.update_agent_status("Conservative Analyst", "completed")
                    self.update_agent_status("Portfolio Manager", "in_progress")
                    self.desk_action("Trader", "typing", "Order execution logic finalized.")

                # Final Decision
                if chunk.get("final_trade_decision"):
                    decision_text = chunk["final_trade_decision"]
                    self.update_report("final_trade_decision", "Portfolio Manager Decision", decision_text)
                    self.update_agent_status("Portfolio Manager", "completed")
                    self.desk_action("Portfolio Manager", "talking", "Final Portfolio Committee Decision Signed Off.")
                    self._parse_decision(decision_text)

                trace.append(chunk)

            # Persist reports
            if trace:
                final_state = {}
                for ch in trace:
                    final_state.update(ch)
                graph.save_reports(final_state, self.ticker)
                graph.clear_checkpoint_on_success(self.ticker, self.analysis_date, "stock")

        finally:
            graph.end_checkpoint()

    def _parse_decision(self, text: str):
        """Parse rating signal, risk score, confidence, and target allocation."""
        upper = text.upper()

        signal = "HOLD"
        if "STRONG BUY" in upper or "BUY" in upper:
            signal = "STRONG BUY" if "STRONG" in upper else "BUY"
        elif "OVERWEIGHT" in upper:
            signal = "OVERWEIGHT"
        elif "UNDERWEIGHT" in upper:
            signal = "UNDERWEIGHT"
        elif "SELL" in upper:
            signal = "SELL"

        # Confidence extraction
        conf = 85
        conf_match = re.search(r"(\d{2})%\s*(?:confidence|certainty)", text, re.IGNORECASE)
        if conf_match:
            conf = int(conf_match.group(1))

        # Risk Score
        risk = "MODERATE"
        if "LOW RISK" in upper or "A+" in upper or "A-" in upper:
            risk = "LOW (A-)"
        elif "HIGH RISK" in upper:
            risk = "HIGH (C+)"
        else:
            risk = "MODERATE (B)"

        # Target Allocation
        alloc = "10%"
        alloc_match = re.search(r"(?:allocate|allocation|position size)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?%)", text, re.IGNORECASE)
        if alloc_match:
            alloc = alloc_match.group(1)

        summary_lines = [line.strip("- *") for line in text.splitlines() if line.strip().startswith(("-", "*"))][:3]
        summary = " | ".join(summary_lines) if summary_lines else text[:180] + "..."

        self.decision_info = {
            "signal": signal,
            "confidence": conf,
            "risk_score": risk,
            "target_allocation": alloc,
            "summary": summary,
        }
        self.push_event("decision", self.decision_info)

    def _run_simulation(self, market_info: dict[str, Any]):
        """High-fidelity demonstration mode when no LLM API key is set."""
        steps = [
            ("phase", (1, "Analyst Team", "Market Analyst")),
            ("agent", ("Market Analyst", "in_progress")),
            ("log", ("ToolCall", f"get_stock_data(ticker='{self.ticker}', start_date='{self.analysis_date}')")),
            ("log", ("Data", f"Fetched 252 OHLCV daily bars for {self.ticker}. Closing: {market_info.get('currency_symbol', '')}2,945.50 (+1.2%)")),
            ("log", ("ToolCall", f"get_indicators(ticker='{self.ticker}', indicators=['rsi', 'macd', 'bollinger'])")),
            ("log", ("Agent", f"RSI(14)=61.8, MACD line has crossed above signal. Price above 50-day EMA.")),
            ("report", ("market_report", "Market Technicals", f"""### Technical Analysis for {self.ticker}
- **Trend**: Intermediate Bullish breakout above multi-week resistance.
- **Momentum Indicators**: RSI is at 61.8 (constructive, not overbought).
- **Moving Averages**: 20-day EMA ({market_info.get('currency_symbol', '')}2,890) > 50-day EMA ({market_info.get('currency_symbol', '')}2,820), confirming upward trajectory.
- **Support & Resistance**: Major support at {market_info.get('currency_symbol', '')}2,850; resistance at {market_info.get('currency_symbol', '')}3,050.
- **Technical Signal**: **BULLISH**""")),
            ("agent", ("Market Analyst", "completed")),
            ("agent", ("Sentiment Analyst", "in_progress")),
            ("log", ("ToolCall", f"get_social_sentiment(ticker='{self.ticker}')")),
            ("log", ("Agent", f"Retail chatter on Reddit / StockTwits leans 78% positive following quarterly guidance.")),
            ("report", ("sentiment_report", "Social Sentiment", f"""### Social Sentiment Analysis for {self.ticker}
- **Sentiment Score**: +0.74 (Bullish)
- **Retail Discussion Volume**: +45% vs 30-day average.
- **Top Keywords**: 'Outperformance', 'Capex expansion', 'Earnings beat'.
- **Sentiment Signal**: **POSITIVE MOMENTUM**""")),
            ("agent", ("Sentiment Analyst", "completed")),
            ("agent", ("News Analyst", "in_progress")),
            ("log", ("ToolCall", f"get_news(ticker='{self.ticker}', limit=10)")),
            ("log", ("Agent", f"Macro tailwinds: Central bank pauses rate hikes. Strong domestic industrial demand.")),
            ("report", ("news_report", "News & Macro", f"""### Global News & Macroeconomic Context
- **Domestic Policy**: Favorable industrial policy and robust consumer demand index.
- **Sector Catalysts**: Energy & telecom segments reporting record ARPU and operating cash flows.
- **Macro Risks**: Geopolitical crude oil volatility monitored; supply chains remain resilient.
- **News Signal**: **FAVORABLE**""")),
            ("agent", ("News Analyst", "completed")),
            ("agent", ("Fundamentals Analyst", "in_progress")),
            ("log", ("ToolCall", f"get_fundamentals(ticker='{self.ticker}')")),
            ("log", ("Agent", f"P/E ratio: 26.4x. Operating Margin: 18.2%. Free cash flow yield: 4.1%.")),
            ("report", ("fundamentals_report", "Fundamental Analysis", f"""### Fundamentals Assessment for {self.ticker}
- **Valuation**: Trading at attractive P/E multiple relative to historic 5-year average.
- **Balance Sheet**: Net Debt-to-EBITDA healthy at 1.4x, strong interest coverage.
- **Growth Outlook**: Projected EPS CAGR of 14.5% over the next 3 fiscal years.
- **Intrinsic Value Estimate**: 15% upside to DCF fair value.
- **Fundamentals Signal**: **HIGH QUALITY / UNDERVALUED**""")),
            ("agent", ("Fundamentals Analyst", "completed")),
            ("desk", ("Fundamentals Analyst", "finished", "DCF model complete.")),
            ("phase", (2, "Bull vs Bear Debate", "Research Manager")),
            ("desk", ("Bull Researcher", "talking", "Consumer monetization is surging.")),
            ("agent", ("Bull Researcher", "in_progress")),
            ("log", ("Agent", "Bull Researcher: Strong catalysts in retail and digital services will expand margins.")),
            ("agent", ("Bull Researcher", "completed")),
            ("desk", ("Bear Researcher", "talking", "High Capex is straining free cash flows.")),
            ("agent", ("Bear Researcher", "in_progress")),
            ("log", ("Agent", "Bear Researcher: High capital expenditure could strain near-term free cash flow if yields spike.")),
            ("agent", ("Bear Researcher", "completed")),
            ("desk", ("Research Manager", "talking", "Bull arguments prevail. Approving long recommendation.")),
            ("agent", ("Research Manager", "in_progress")),
            ("log", ("Agent", "Research Manager: Bull argument predominates. Growth runway easily outweighs short-term capex drag.")),
            ("debate", {
                "bull_thesis": "Rapid retail footprint expansion, ARPU growth across 5G networks, and dominant domestic market share provide an unshakeable operational moat.",
                "bear_thesis": "Heavy ongoing capital expenditure cycles and vulnerability to petrochemical refining margin compression pose downside volatility.",
                "judge_ruling": "Structural earnings growth in consumer facing divisions outstrips cyclical commodities drag. Conviction leans Bullish with tight risk limits.",
                "bull_points": [
                    "Consumer retail EBITDA grew +24% YoY with increasing store footfall.",
                    "5G tariff monetization driving 12% ARPU expansion.",
                    "Clean corporate balance sheet with Net Debt/EBITDA of 1.4x.",
                    "Strong domestic institutional backing preventing sharp pullbacks."
                ],
                "bear_points": [
                    "Near-term Free Cash Flow yield compressed by ongoing CapEx rollouts.",
                    "Global refining margins vulnerable to crude demand fluctuations.",
                    "Valuation multiple at +1 standard deviation above 3-year median."
                ],
                "risk_debates": {
                    "aggressive": "Allocate full 12% portfolio weight to capture rapid breakout momentum.",
                    "neutral": "Recommend 7.5% allocation with a standard 5% trailing stop-loss.",
                    "conservative": "Cap position size at 5% with strict delta hedge until next earnings report."
                }
            }),
            ("report", ("investment_plan", "Research Team Debate", f"""### Research Team Consensus
- **Bull Thesis**: Rapid retail expansion and consumer monetization provide a resilient defensive moat.
- **Bear Counterpoint**: Risk of commodity price fluctuations and valuation compression.
- **Manager Ruling**: The structural earnings growth and deleveraging path outweigh margin compression risks. Recommending aggressive accumulation.""")),
            ("agent", ("Research Manager", "completed")),
            ("phase", (3, "Trading Strategy", "Trader")),
            ("desk", ("Trader", "typing", "Structuring limit order grid and trailing stop...")),
            ("agent", ("Trader", "in_progress")),
            ("log", ("Agent", f"Trader formulating staggered accumulation strategy with trailing stop at {market_info.get('currency_symbol', '')}2,820.")),
            ("report", ("trader_investment_plan", "Trading Strategy Plan", f"""### Execution Strategy
- **Order Action**: Scale-in Buy.
- **Entry Range**: Current market price up to +2.5%.
- **Target Horizon**: 3 - 6 Months.
- **Target Price**: +16.5% from current level.
- **Stop Loss**: -4.8% trailing stop.""")),
            ("agent", ("Trader", "completed")),
            ("desk", ("Trader", "finished", "Order plan routed to Risk & PM committee.")),
            ("phase", (4, "Risk Management & Portfolio Manager", "Portfolio Manager")),
            ("agent", ("Aggressive Analyst", "completed")),
            ("agent", ("Neutral Analyst", "completed")),
            ("agent", ("Conservative Analyst", "completed")),
            ("desk", ("Portfolio Manager", "talking", "Risk limits passed. Authorizing STRONG BUY verdict.")),
            ("agent", ("Portfolio Manager", "in_progress")),
            ("log", ("Agent", "Portfolio Manager: Approving transaction proposal. Final rating: STRONG BUY.")),
            ("report", ("final_trade_decision", "Portfolio Manager Decision", f"""### Final Portfolio Management Committee Decision
- **Final Rating**: **STRONG BUY**
- **Conviction Score**: 89%
- **Risk Grade**: Low to Moderate (A-)
- **Allocated Position Weight**: 8.5%
- **Key Catalysts**:
  * Positive technical breakout supported by volume.
  * Accelerating earnings growth across core divisions.
  * Strong macro alignment vs {market_info.get('benchmark_name', 'Benchmark Index')}.""")),
            ("agent", ("Portfolio Manager", "completed")),
            ("desk", ("Portfolio Manager", "finished", "Analysis execution complete.")),
            ("decision", {
                "signal": "STRONG BUY",
                "confidence": 89,
                "risk_score": "LOW (A-)",
                "target_allocation": "8.5%",
                "summary": f"Unanimous multi-agent conviction. Technical breakout with fundamental valuation support vs {market_info.get('benchmark_name', 'benchmark')}.",
            }),
        ]

        for action, payload in steps:
            if self.stop_requested:
                break
            time.sleep(0.35)

            if action == "phase":
                self.update_phase(*payload)
            elif action == "agent":
                self.update_agent_status(*payload)
            elif action == "desk":
                self.desk_action(*payload)
            elif action == "debate":
                self.update_debate(payload)
            elif action == "log":
                self.log(*payload)
            elif action == "report":
                self.update_report(*payload)
            elif action == "decision":
                self.decision_info = payload
                self.push_event("decision", payload)


def create_job(
    ticker: str,
    market: str = "US",
    analysis_date: str = "",
    selected_analysts: list[str] = None,
    config_overrides: dict[str, Any] = None,
    loop: asyncio.AbstractEventLoop = None,
) -> AnalysisJob:
    """Create, register, and start a new analysis job."""
    if loop is None:
        loop = asyncio.get_event_loop()

    job_id = str(uuid.uuid4())
    run_config = DEFAULT_CONFIG.copy()
    if config_overrides:
        run_config.update(config_overrides)

    if not analysis_date:
        analysis_date = datetime.datetime.now().strftime("%Y-%m-%d")

    job = AnalysisJob(
        job_id=job_id,
        ticker=ticker,
        market=market,
        analysis_date=analysis_date,
        selected_analysts=selected_analysts or ["market", "social", "news", "fundamentals"],
        config=run_config,
        loop=loop,
    )
    _JOBS[job_id] = job
    job.start()
    return job


def get_job(job_id: str) -> AnalysisJob | None:
    """Retrieve an active or completed job by ID."""
    return _JOBS.get(job_id)
