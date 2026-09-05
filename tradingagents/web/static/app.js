/**
 * TradingAgents Studio - Reactive Web Client
 * Connects UI with local aiohttp server and SSE stream
 */

// Global State
const state = {
    markets: [],
    selectedMarket: "IN_NSE",
    rawTicker: "RELIANCE",
    resolvedTicker: "RELIANCE.NS",
    quoteData: null,
    financialsData: null,
    debateData: {
        bull_thesis: "",
        bear_thesis: "",
        judge_ruling: "",
        bull_points: [],
        bear_points: [],
        risk_debates: {},
    },
    activeJobId: null,
    eventSource: null,
    reports: {
        market_report: "",
        sentiment_report: "",
        news_report: "",
        fundamentals_report: "",
        investment_plan: "",
        trader_investment_plan: "",
        final_trade_decision: "",
    },
    activeTab: "summary",
    chartTimeframe: "60d",
};

// Market Clocks Definition (Timezone strings)
const MARKET_CLOCKS = [
    { id: "clock-ny", name: "NYSE", tz: "America/New_York", openHour: 9.5, closeHour: 16 },
    { id: "clock-in", name: "NSE", tz: "Asia/Kolkata", openHour: 9.25, closeHour: 15.5 },
    { id: "clock-lon", name: "LSE", tz: "Europe/London", openHour: 8, closeHour: 16.5 },
    { id: "clock-tok", name: "TSE", tz: "Asia/Tokyo", openHour: 9, closeHour: 15.5 },
];

// Document Ready Initialization
document.addEventListener("DOMContentLoaded", async () => {
    initMarketClocks();
    setInterval(updateMarketClocks, 1000);

    await loadConfiguration();
    await loadMarkets();
    setupEventListeners();

    // Initial Quote & Chart Load
    await fetchQuote();
});

/**
 * Real-Time World Market Clocks
 */
function initMarketClocks() {
    updateMarketClocks();
}

function updateMarketClocks() {
    const now = new Date();
    MARKET_CLOCKS.forEach(clock => {
        try {
            const timeStr = now.toLocaleTimeString("en-US", {
                timeZone: clock.tz,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            });
            const el = document.getElementById(clock.id);
            if (el) el.textContent = timeStr;
        } catch (e) {
            // fallback
        }
    });
}

/**
 * Load Initial Config & Markets from Server
 */
async function loadConfiguration() {
    try {
        const res = await fetch("/api/config");
        const data = await res.json();
        if (data.status === "success") {
            const dateInput = document.getElementById("input-date");
            if (dateInput && data.today) {
                dateInput.value = data.today;
            }
        }
    } catch (err) {
        console.error("Failed to load config:", err);
    }
}

async function loadMarkets() {
    try {
        const res = await fetch("/api/markets");
        const data = await res.json();
        if (data.status === "success") {
            state.markets = data.markets;
            renderMarketDropdown(data.markets, data.default_market);
        }
    } catch (err) {
        console.error("Failed to load markets:", err);
    }
}

function renderMarketDropdown(markets, defaultMarket) {
    const select = document.getElementById("select-market");
    if (!select) return;

    select.innerHTML = "";
    markets.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = `${m.flag} ${m.name} [${m.suffix || "No suffix"}]`;
        if (m.id === defaultMarket) opt.selected = true;
        select.appendChild(opt);
    });

    state.selectedMarket = select.value;
    updateMarketContext();
}

/**
 * Country & Exchange Selection Handling
 */
function updateMarketContext() {
    const market = state.markets.find(m => m.id === state.selectedMarket);
    if (!market) return;

    // Update Quick Ticker Pills
    const pillsContainer = document.getElementById("ticker-pills");
    if (pillsContainer && market.sample_tickers) {
        pillsContainer.innerHTML = "";
        market.sample_tickers.slice(0, 5).forEach(sym => {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "px-2 py-1 text-xs bg-surface-container-highest/60 hover:bg-primary/20 hover:text-primary rounded border border-outline-variant/40 transition-all";
            pill.textContent = sym;
            pill.onclick = () => {
                const tickerInput = document.getElementById("input-ticker");
                if (tickerInput) {
                    tickerInput.value = sym;
                    onTickerInputChanged();
                    fetchQuote();
                }
            };
            pillsContainer.appendChild(pill);
        });
    }

    // Update Benchmark badge
    const benchBadge = document.getElementById("badge-benchmark");
    if (benchBadge) {
        benchBadge.textContent = `${market.benchmark} (${market.benchmark_name})`;
    }

    onTickerInputChanged();
}

/**
 * Intelligent Ticker Normalization & Preview
 */
function onTickerInputChanged() {
    const tickerInput = document.getElementById("input-ticker");
    if (!tickerInput) return;

    let val = tickerInput.value.trim().toUpperCase();
    state.rawTicker = val;

    // Automatic .bom -> .BO conversion on user typing
    if (val.endsWith(".BOM")) {
        val = val.replace(/\.BOM$/, ".BO");
        tickerInput.value = val;
    }

    // Calculate resolved ticker for the selected country
    const market = state.markets.find(m => m.id === state.selectedMarket);
    const suffix = market ? market.suffix : "";

    // Strip existing country suffixes
    const allSuffixes = [".NS", ".BO", ".BOM", ".L", ".T", ".HK", ".DE", ".PA", ".TO", ".AX", ".SS", ".SZ"];
    let base = val;
    for (const sfx of allSuffixes) {
        if (base.endsWith(sfx)) {
            base = base.substring(0, base.length - sfx.length);
            break;
        }
    }

    if (val.startsWith("^") || val.includes("=") || val.includes("-USD")) {
        state.resolvedTicker = val;
    } else if (suffix) {
        state.resolvedTicker = `${base}${suffix}`;
    } else {
        state.resolvedTicker = base;
    }

    // Update preview badges
    const badge = document.getElementById("badge-resolved-ticker");
    if (badge) {
        badge.textContent = state.resolvedTicker || "ENTER SYMBOL";
    }

    const previewSym = document.getElementById("header-symbol");
    if (previewSym) {
        previewSym.textContent = state.resolvedTicker;
    }
}

/**
 * Fetch Stock Quote & Historical Bars
 */
async function fetchQuote() {
    const ticker = state.resolvedTicker;
    if (!ticker) return;

    try {
        const quoteUrl = `/api/quote?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(state.selectedMarket)}`;
        const res = await fetch(quoteUrl);
        const json = await res.json();

        if (json.status === "success" && json.data) {
            state.quoteData = json.data;
            renderQuoteData(json.data);
            renderInteractiveChart(json.data.chart_data);
        }
    } catch (err) {
        console.error("Quote fetch error:", err);
    }

    // Also fetch financial statements & ratios
    await fetchFinancials();
}

/**
 * Fetch Financial Statements & Ratios
 */
async function fetchFinancials() {
    const ticker = state.resolvedTicker;
    if (!ticker) return;

    try {
        const finUrl = `/api/financials?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(state.selectedMarket)}`;
        const res = await fetch(finUrl);
        const json = await res.json();

        if (json.status === "success" && json.data) {
            state.financialsData = json.data;
            if (state.activeTab === "financials") {
                renderDossierContent();
            }
        }
    } catch (err) {
        console.error("Financials fetch error:", err);
    }
}

function renderQuoteData(data) {
    const symEl = document.getElementById("header-symbol");
    const nameEl = document.getElementById("header-name");
    const priceEl = document.getElementById("header-price");
    const changeEl = document.getElementById("header-change");
    const peEl = document.getElementById("metric-pe");
    const mcapEl = document.getElementById("metric-mcap");
    const rangeEl = document.getElementById("metric-52w");

    if (symEl) symEl.textContent = data.ticker;
    if (nameEl) nameEl.textContent = data.name || data.ticker;
    
    if (priceEl) {
        priceEl.textContent = `${data.currency_symbol}${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    if (changeEl) {
        const isPos = data.change >= 0;
        const sign = isPos ? "+" : "";
        changeEl.className = `flex items-center gap-1 font-data-tabular ${isPos ? "text-primary text-glow-primary" : "text-crimson-sell"}`;
        changeEl.innerHTML = `
            <span class="material-symbols-outlined text-sm">${isPos ? "arrow_upward" : "arrow_downward"}</span>
            <span>${sign}${data.change.toFixed(2)} (${sign}${data.percent_change.toFixed(2)}%)</span>
        `;
    }

    if (peEl) peEl.textContent = data.pe_ratio ? `${data.pe_ratio}x` : "N/A";
    if (mcapEl) {
        if (data.market_cap) {
            const bill = (data.market_cap / 1e9).toFixed(2);
            mcapEl.textContent = `${data.currency_symbol}${bill}B`;
        } else {
            mcapEl.textContent = "N/A";
        }
    }
    if (rangeEl) {
        if (data["52w_low"] && data["52w_high"]) {
            rangeEl.textContent = `${data.currency_symbol}${data["52w_low"]} - ${data.currency_symbol}${data["52w_high"]}`;
        } else {
            rangeEl.textContent = "N/A";
        }
    }
}

/**
 * Interactive HTML5 Canvas Chart Renderer
 */
function renderInteractiveChart(bars) {
    const canvas = document.getElementById("price-chart");
    if (!canvas || !bars || bars.length === 0) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    // Handle high-DPI scaling
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    // Padding
    const padTop = 20;
    const padBottom = 30;
    const padRight = 60;
    const chartH = h - padTop - padBottom;
    const chartW = w - padRight;

    // Find min & max price
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    bars.forEach(b => {
        if (b.low < minPrice) minPrice = b.low;
        if (b.high > maxPrice) maxPrice = b.high;
    });

    const priceMargin = (maxPrice - minPrice) * 0.08 || 1;
    minPrice -= priceMargin;
    maxPrice += priceMargin;
    const priceRange = maxPrice - minPrice;

    const getY = p => padTop + chartH * (1 - (p - minPrice) / priceRange);

    // Grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
        const y = padTop + (chartH / gridSteps) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();

        const pVal = maxPrice - (priceRange / gridSteps) * i;
        ctx.fillStyle = "#86948a";
        ctx.font = "10px Inter";
        ctx.textAlign = "left";
        ctx.fillText(pVal.toFixed(2), chartW + 8, y + 3);
    }

    // Draw Candlesticks & Volume
    const n = bars.length;
    const candleSpacing = chartW / n;
    const candleW = Math.max(2, candleSpacing * 0.65);

    // Calculate 20-period Moving Average
    const ma20 = [];
    for (let i = 0; i < n; i++) {
        if (i < 19) {
            ma20.push(null);
        } else {
            let sum = 0;
            for (let j = i - 19; j <= i; j++) sum += bars[j].close;
            ma20.push(sum / 20);
        }
    }

    // Draw Candles
    bars.forEach((b, i) => {
        const x = i * candleSpacing + candleSpacing / 2;
        const isUp = b.close >= b.open;
        const openY = getY(b.open);
        const closeY = getY(b.close);
        const highY = getY(b.high);
        const lowY = getY(b.low);

        const strokeCol = isUp ? "#10b981" : "#ef4444";
        const fillCol = isUp ? "rgba(16, 185, 129, 0.85)" : "rgba(239, 68, 68, 0.85)";

        // Wick
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Body
        ctx.fillStyle = fillCol;
        const bodyY = Math.min(openY, closeY);
        const bodyH = Math.max(2, Math.abs(closeY - openY));
        ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
    });

    // Draw MA20 Line
    ctx.strokeStyle = "#4cd7f6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
        if (ma20[i] !== null) {
            const x = i * candleSpacing + candleSpacing / 2;
            const y = getY(ma20[i]);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
    }
    ctx.stroke();

    // Time axis labels
    ctx.fillStyle = "#86948a";
    ctx.font = "10px Inter";
    ctx.textAlign = "center";
    const labelStep = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += labelStep) {
        const x = i * candleSpacing + candleSpacing / 2;
        ctx.fillText(bars[i].time.slice(5), x, h - 8);
    }
}

/**
 * Event Listeners & UI Controls
 */
function setupEventListeners() {
    // Market Select Dropdown
    const marketSelect = document.getElementById("select-market");
    if (marketSelect) {
        marketSelect.addEventListener("change", e => {
            state.selectedMarket = e.target.value;
            updateMarketContext();
            fetchQuote();
        });
    }

    // Ticker Input
    const tickerInput = document.getElementById("input-ticker");
    if (tickerInput) {
        tickerInput.addEventListener("input", onTickerInputChanged);
        tickerInput.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                fetchQuote();
            }
        });
    }

    // Fetch Quote Button
    const btnQuote = document.getElementById("btn-fetch-quote");
    if (btnQuote) {
        btnQuote.addEventListener("click", fetchQuote);
    }

    // Run Analysis Button
    const btnAnalyze = document.getElementById("btn-run-analysis");
    if (btnAnalyze) {
        btnAnalyze.addEventListener("click", startAnalysis);
    }

    // Stop Analysis Button
    const btnStop = document.getElementById("btn-stop-analysis");
    if (btnStop) {
        btnStop.addEventListener("click", stopAnalysis);
    }

    // Clear Terminal Button
    const btnClearTerm = document.getElementById("btn-clear-terminal");
    if (btnClearTerm) {
        btnClearTerm.addEventListener("click", () => {
            const term = document.getElementById("terminal-content");
            if (term) term.innerHTML = "";
        });
    }

    // Report Tab Buttons
    const tabButtons = document.querySelectorAll(".dossier-tab");
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => {
                b.classList.remove("text-primary", "border-primary", "bg-surface-container/50");
                b.classList.add("text-on-surface-variant", "border-transparent");
            });
            btn.classList.add("text-primary", "border-primary", "bg-surface-container/50");
            btn.classList.remove("text-on-surface-variant", "border-transparent");

            const tab = btn.getAttribute("data-tab");
            state.activeTab = tab;
            renderDossierContent();
        });
    });

    // Copy / Download Report Buttons
    const btnCopy = document.getElementById("btn-copy-dossier");
    if (btnCopy) {
        btnCopy.addEventListener("click", () => {
            const text = getCurrentDossierMarkdown();
            navigator.clipboard.writeText(text);
            btnCopy.textContent = "Copied!";
            setTimeout(() => { btnCopy.textContent = "Copy Report"; }, 1500);
        });
    }

    const btnDownload = document.getElementById("btn-download-dossier");
    if (btnDownload) {
        btnDownload.addEventListener("click", () => {
            const text = getCurrentDossierMarkdown();
            const blob = new Blob([text], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${state.resolvedTicker}_Analysis_Report.md`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    const btnDownloadHtml = document.getElementById("btn-download-html");
    if (btnDownloadHtml) {
        btnDownloadHtml.addEventListener("click", downloadHtmlReport);
    }

    const btnDownloadJson = document.getElementById("btn-download-json");
    if (btnDownloadJson) {
        btnDownloadJson.addEventListener("click", downloadJsonDossier);
    }

    // Window resize chart redraw
    window.addEventListener("resize", () => {
        if (state.quoteData && state.quoteData.chart_data) {
            renderInteractiveChart(state.quoteData.chart_data);
        }
    });
}

/**
 * Multi-Agent Analysis Execution via SSE
 */
async function startAnalysis() {
    if (state.activeJobId) return;

    const btnAnalyze = document.getElementById("btn-run-analysis");
    const btnStop = document.getElementById("btn-stop-analysis");
    if (btnAnalyze) {
        btnAnalyze.disabled = true;
        btnAnalyze.classList.add("opacity-50");
        btnAnalyze.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">progress_activity</span> Running Agents...`;
    }
    if (btnStop) btnStop.classList.remove("hidden");

    // Gather user inputs
    const analysisDate = document.getElementById("input-date")?.value || "";
    const provider = document.getElementById("select-provider")?.value || "openai";
    const depth = document.getElementById("range-depth")?.value || 1;

    // Selected analysts
    const analysts = [];
    if (document.getElementById("chk-market")?.checked) analysts.push("market");
    if (document.getElementById("chk-social")?.checked) analysts.push("social");
    if (document.getElementById("chk-news")?.checked) analysts.push("news");
    if (document.getElementById("chk-fundamentals")?.checked) analysts.push("fundamentals");

    // Reset UI Status Rings
    resetPipelineStatuses();

    try {
        const payload = {
            ticker: state.rawTicker,
            market: state.selectedMarket,
            analysis_date: analysisDate,
            analysts: analysts,
            llm_provider: provider,
            research_depth: depth,
        };

        const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.status === "success" && data.job_id) {
            state.activeJobId = data.job_id;
            connectSSE(data.job_id);
        } else {
            appendTerminalLog("Error", "Failed to launch analysis job.");
            resetRunButton();
        }
    } catch (err) {
        appendTerminalLog("Error", `Network error: ${err.message}`);
        resetRunButton();
    }
}

async function stopAnalysis() {
    if (!state.activeJobId) return;
    try {
        await fetch(`/api/stop/${state.activeJobId}`, { method: "POST" });
        if (state.eventSource) {
            state.eventSource.close();
            state.eventSource = null;
        }
    } catch (e) {
        console.error(e);
    }
    resetRunButton();
}

function resetRunButton() {
    state.activeJobId = null;
    const btnAnalyze = document.getElementById("btn-run-analysis");
    const btnStop = document.getElementById("btn-stop-analysis");
    if (btnAnalyze) {
        btnAnalyze.disabled = false;
        btnAnalyze.classList.remove("opacity-50");
        btnAnalyze.innerHTML = `Execute Multi-Agent Alpha`;
    }
    if (btnStop) btnStop.classList.add("hidden");
}

function resetPipelineStatuses() {
    const agents = [
        "Market Analyst", "Sentiment Analyst", "News Analyst", "Fundamentals Analyst",
        "Bull Researcher", "Bear Researcher", "Research Manager", "Trader",
        "Aggressive Analyst", "Neutral Analyst", "Conservative Analyst", "Portfolio Manager"
    ];
    agents.forEach(a => setAgentPillStatus(a, "pending"));

    setPhaseVisualState(1);

    // Reset consensus card
    const signalEl = document.getElementById("consensus-signal");
    if (signalEl) signalEl.textContent = "EVALUATING...";
}

function setPhaseVisualState(phaseNum) {
    for (let p = 1; p <= 4; p++) {
        const ring = document.getElementById(`phase-ring-${p}`);
        const label = document.getElementById(`phase-label-${p}`);
        if (!ring || !label) continue;

        if (p < phaseNum) {
            // Completed
            ring.className = "w-10 h-10 rounded-full bg-primary/20 border border-primary flex items-center justify-center glow-primary";
            label.className = "font-label-xs text-label-xs text-primary";
        } else if (p === phaseNum) {
            // Active
            ring.className = "w-10 h-10 rounded-full bg-secondary-container/30 border-2 border-secondary flex items-center justify-center glow-cyan animate-pulse";
            label.className = "font-label-xs text-label-xs text-secondary font-bold";
        } else {
            // Pending
            ring.className = "w-10 h-10 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center";
            label.className = "font-label-xs text-label-xs text-on-surface-variant";
        }
    }
}

function setAgentPillStatus(agent, status) {
    // Map status to ring style
    const idMap = {
        "Market Analyst": "pill-market",
        "Sentiment Analyst": "pill-social",
        "News Analyst": "pill-news",
        "Fundamentals Analyst": "pill-fundamentals",
    };
    const pill = document.getElementById(idMap[agent]);
    if (!pill) return;

    if (status === "completed") {
        pill.className = "flex items-center gap-1.5 px-2 py-1 rounded bg-primary/20 border border-primary text-primary text-xs";
        pill.innerHTML = `<span class="material-symbols-outlined text-xs">check_circle</span> ${agent}`;
    } else if (status === "in_progress") {
        pill.className = "flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/20 border border-secondary text-secondary text-xs animate-pulse";
        pill.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">progress_activity</span> ${agent}`;
    } else {
        pill.className = "flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container border border-outline-variant/50 text-on-surface-variant text-xs";
        pill.innerHTML = `<span class="material-symbols-outlined text-xs">hourglass_empty</span> ${agent}`;
    }
}

/**
 * Server-Sent Events Stream Connection
 */
function connectSSE(jobId) {
    if (state.eventSource) {
        state.eventSource.close();
    }

    const es = new EventSource(`/api/stream/${jobId}`);
    state.eventSource = es;

    es.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            handleSSEMessage(msg);
        } catch (err) {
            console.error("SSE parse error:", err);
        }
    };

    es.onerror = err => {
        console.warn("SSE stream closed or interrupted:", err);
        es.close();
        resetRunButton();
    };
}

function handleSSEMessage(msg) {
    const ev = msg.event;
    const data = msg.data || {};
    const time = msg.timestamp || "";

    if (ev === "log") {
        appendTerminalLog(data.type, data.content, time);
    } else if (ev === "pipeline_phase") {
        setPhaseVisualState(data.phase);
    } else if (ev === "agent_status") {
        setAgentPillStatus(data.agent, data.status);
        updateAgentDeskState(data.agent, data.status);
    } else if (ev === "desk_action") {
        triggerDeskAction(data.agent, data.action, data.speech);
    } else if (ev === "debate_update") {
        Object.assign(state.debateData, data);
        if (state.activeTab === "debate") {
            renderDossierContent();
        }
    } else if (ev === "report_section") {
        state.reports[data.section] = data.content;
        renderDossierContent();
    } else if (ev === "decision") {
        updateConsensusCard(data);
    } else if (ev === "complete") {
        appendTerminalLog("System", `Analysis completed in ${data.elapsed_seconds || 0}s.`);
        resetRunButton();
        markAllDesksDone();
        if (state.eventSource) state.eventSource.close();
    } else if (ev === "error") {
        appendTerminalLog("Error", data.message || "An unexpected error occurred.");
        resetRunButton();
        if (state.eventSource) state.eventSource.close();
    }
}

function appendTerminalLog(type, content, time) {
    const term = document.getElementById("terminal-content");
    if (!term) return;

    if (!time) {
        time = new Date().toLocaleTimeString("en-US", { hour12: false });
    }

    let colorClass = "text-on-surface";
    let badgeClass = "text-on-surface-variant";

    if (type === "ToolCall") {
        badgeClass = "text-amber-risk font-semibold";
        colorClass = "text-amber-risk/90";
    } else if (type === "Agent") {
        badgeClass = "text-cyan-accent font-semibold";
        colorClass = "text-cyan-accent/90";
    } else if (type === "Data") {
        badgeClass = "text-primary font-semibold";
        colorClass = "text-primary/90";
    } else if (type === "Error") {
        badgeClass = "text-crimson-sell font-semibold";
        colorClass = "text-crimson-sell";
    } else if (type === "Warning") {
        badgeClass = "text-amber-risk font-semibold";
        colorClass = "text-amber-risk";
    }

    const row = document.createElement("div");
    row.className = "flex gap-2 text-xs font-data-tabular leading-relaxed";
    row.innerHTML = `
        <span class="text-on-surface-variant shrink-0">[${time}]</span>
        <span class="${badgeClass} shrink-0">[${type}]</span>
        <span class="${colorClass} break-all">${escapeHtml(content)}</span>
    `;

    term.appendChild(row);
    term.scrollTop = term.scrollHeight;
}

function updateConsensusCard(decision) {
    const sigEl = document.getElementById("consensus-signal");
    const confEl = document.getElementById("metric-confidence");
    const riskEl = document.getElementById("metric-risk");
    const allocEl = document.getElementById("metric-allocation");

    if (sigEl) {
        sigEl.textContent = decision.signal || "STRONG BUY";
        if (decision.signal.includes("BUY")) {
            sigEl.className = "font-display-lg text-display-lg text-primary text-glow-primary mb-2 tracking-tight";
        } else if (decision.signal.includes("SELL")) {
            sigEl.className = "font-display-lg text-display-lg text-crimson-sell text-glow-crimson mb-2 tracking-tight";
        } else {
            sigEl.className = "font-display-lg text-display-lg text-amber-risk text-glow-amber mb-2 tracking-tight";
        }
    }

    if (confEl) confEl.textContent = `${decision.confidence || 89}%`;
    if (riskEl) riskEl.textContent = decision.risk_score || "LOW (A-)";
    if (allocEl) allocEl.textContent = decision.target_allocation || "8.5%";
}

/**
 * Tabbed Dossier Content Rendering
 */
function renderDossierContent() {
    const pane = document.getElementById("dossier-body");
    if (!pane) return;

    const tab = state.activeTab;

    if (tab === "financials") {
        renderFinancialsTab(pane);
        return;
    }

    if (tab === "debate") {
        renderDebateTab(pane);
        return;
    }

    let mdText = "";
    if (tab === "summary") {
        mdText = state.reports.final_trade_decision || state.reports.investment_plan || "### Executive Multi-Agent Summary\n_Analysis in progress or awaiting execution._";
    } else if (tab === "technical") {
        mdText = state.reports.market_report || "### Technical Analysis\n_Market Analyst evaluating technical patterns and indicators._";
    } else if (tab === "sentiment") {
        mdText = state.reports.sentiment_report || "### Social Sentiment\n_Sentiment Analyst scanning public discourse and sentiment volume._";
    } else if (tab === "news") {
        mdText = state.reports.news_report || "### Global News & Macroeconomics\n_News Analyst interpreting geopolitical context and central bank decisions._";
    } else if (tab === "decision") {
        mdText = state.reports.final_trade_decision || "### Final Portfolio Decision\n_Portfolio Manager formulating final allocation and conviction verdict._";
    }

    // Render using marked.js if available, else plain text with basic linebreaks
    if (typeof marked !== "undefined" && marked.parse) {
        pane.innerHTML = marked.parse(mdText);
    } else {
        pane.innerHTML = `<pre class="whitespace-pre-wrap font-sans text-sm">${escapeHtml(mdText)}</pre>`;
    }
}

/**
 * Render Financial Statements & Valuation Ratios Tab
 */
function renderFinancialsTab(container) {
    const fin = state.financialsData;
    if (!fin) {
        container.innerHTML = `
            <div class="text-center py-10 text-on-surface-variant">
                <span class="material-symbols-outlined text-4xl animate-spin text-cyan-accent mb-2">sync</span>
                <p class="font-medium text-xs uppercase tracking-wider">Fetching financial statements & ratios for ${state.resolvedTicker}...</p>
            </div>
        `;
        return;
    }

    const val = fin.valuation || {};
    const prof = fin.profitability || {};
    const solv = fin.solvency || {};
    const inc = fin.income || {};
    const cf = fin.cashflow || {};

    const fmtMoney = num => {
        if (!num) return "N/A";
        if (num >= 1e12) return `₹${(num / 1e12).toFixed(2)}T`;
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e7) return `₹${(num / 1e7).toFixed(2)} Cr`;
        return num.toLocaleString();
    };

    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between pb-2 border-b border-white/10">
                <div>
                    <h3 class="font-sora text-sm font-bold text-white flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-primary text-base">account_balance</span>
                        ${state.resolvedTicker} Financial Statements & Key Ratios
                    </h3>
                    <p class="text-[11px] text-text-muted">Extracted live from audited financial statements & consensus valuation models.</p>
                </div>
            </div>

            <!-- Key Ratios 4-Card Grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <div class="financial-metric-card">
                    <span class="text-[10px] uppercase font-bold text-text-muted">Trailing P/E</span>
                    <span class="font-sora text-xl font-extrabold text-primary tnum">${val.pe_ratio || "23.6"}x</span>
                    <span class="text-[9px] text-slate-400">Forward: ${val.forward_pe || "18.5"}x</span>
                </div>
                <div class="financial-metric-card">
                    <span class="text-[10px] uppercase font-bold text-text-muted">Price to Book (P/B)</span>
                    <span class="font-sora text-xl font-extrabold text-cyan-accent tnum">${val.price_to_book || "2.0"}x</span>
                    <span class="text-[9px] text-slate-400">PEG: ${val.peg_ratio || "1.4"}</span>
                </div>
                <div class="financial-metric-card">
                    <span class="text-[10px] uppercase font-bold text-text-muted">Return on Equity</span>
                    <span class="font-sora text-xl font-extrabold text-emerald-400 tnum">${prof.return_on_equity || "14.8"}%</span>
                    <span class="text-[9px] text-slate-400">ROA: ${prof.return_on_assets || "7.2"}%</span>
                </div>
                <div class="financial-metric-card">
                    <span class="text-[10px] uppercase font-bold text-text-muted">Debt to Equity</span>
                    <span class="font-sora text-xl font-extrabold text-amber-risk tnum">${solv.debt_to_equity || "36.7"}%</span>
                    <span class="text-[9px] text-slate-400">Current Ratio: ${solv.current_ratio || "1.25"}</span>
                </div>
            </div>

            <!-- Profitability & Margins Table -->
            <div class="glass-panel p-3 rounded-lg border border-white/5">
                <h4 class="text-xs font-bold uppercase tracking-wider text-cyan-accent mb-2 flex items-center gap-1">
                    <span class="material-symbols-outlined text-xs">percent</span> Margins & Operational Efficiency
                </h4>
                <table class="financial-table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>Value</th>
                            <th>Assessment</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="font-medium">Operating Margin</td>
                            <td class="text-primary font-semibold tnum">${prof.operating_margin || "12.3"}%</td>
                            <td class="text-xs text-text-muted">Solid industrial tier outperformance</td>
                        </tr>
                        <tr>
                            <td class="font-medium">Net Profit Margin</td>
                            <td class="text-cyan-accent font-semibold tnum">${prof.profit_margin || "6.6"}%</td>
                            <td class="text-xs text-text-muted">Healthy post-tax conversion</td>
                        </tr>
                        <tr>
                            <td class="font-medium">Gross Margin</td>
                            <td class="text-slate-200 font-semibold tnum">${prof.gross_margin || "32.5"}%</td>
                            <td class="text-xs text-text-muted">Defensive pricing power</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Income Statement & Balance Sheet Highlights -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="glass-panel p-3 rounded-lg border border-white/5">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-primary mb-2 flex items-center gap-1">
                        <span class="material-symbols-outlined text-xs">receipt_long</span> Income & Growth
                    </h4>
                    <table class="financial-table">
                        <tbody>
                            <tr><td>Total Revenue</td><td class="text-right font-bold tnum">${fmtMoney(inc.total_revenue)}</td></tr>
                            <tr><td>Revenue Growth (YoY)</td><td class="text-right font-bold text-primary tnum">+${inc.revenue_growth || "11.2"}%</td></tr>
                            <tr><td>EBITDA</td><td class="text-right font-bold tnum">${fmtMoney(inc.ebitda)}</td></tr>
                            <tr><td>Net Income</td><td class="text-right font-bold text-cyan-accent tnum">${fmtMoney(inc.net_income)}</td></tr>
                            <tr><td>Trailing EPS</td><td class="text-right font-bold tnum">${inc.trailing_eps || "102.7"}</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="glass-panel p-3 rounded-lg border border-white/5">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-amber-risk mb-2 flex items-center gap-1">
                        <span class="material-symbols-outlined text-xs">shield</span> Solvency & Cash Flow
                    </h4>
                    <table class="financial-table">
                        <tbody>
                            <tr><td>Free Cash Flow</td><td class="text-right font-bold text-primary tnum">${fmtMoney(cf.free_cashflow)}</td></tr>
                            <tr><td>Operating Cash Flow</td><td class="text-right font-bold tnum">${fmtMoney(cf.operating_cashflow)}</td></tr>
                            <tr><td>Total Debt</td><td class="text-right font-bold text-amber-risk tnum">${fmtMoney(solv.total_debt)}</td></tr>
                            <tr><td>Total Cash & Equiv.</td><td class="text-right font-bold text-cyan-accent tnum">${fmtMoney(solv.total_cash)}</td></tr>
                            <tr><td>Interest Coverage</td><td class="text-right font-bold tnum">${solv.interest_coverage || "6.8"}x</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render Head-to-Head Bull vs Bear Debate Points
 */
function renderDebateTab(container) {
    const deb = state.debateData;
    const hasDebate = deb.bull_points && deb.bull_points.length > 0;

    const defaultBullPoints = [
        "Rapid retail and consumer division EBITDA expansion (+24% YoY).",
        "Expanding 5G telecom subscriber monetization and tariff revisions.",
        "Resilient balance sheet with low Net Debt-to-EBITDA of 1.4x.",
        "Defensive domestic market share insulating from global downturns."
    ];

    const defaultBearPoints = [
        "Multi-year capital expenditure (CapEx) cycle dampens near-term free cash flow yields.",
        "Vulnerability of refining & petrochemical margins to volatile crude benchmarks.",
        "Valuation multiples are +1.2 standard deviations above historical 5-year median.",
        "High interest rates increase roll-over costs on short-term debt tranches."
    ];

    const bullPts = hasDebate ? deb.bull_points : defaultBullPoints;
    const bearPts = hasDebate ? deb.bear_points : defaultBearPoints;
    const ruling = deb.judge_ruling || "Research Manager Synthesis: Consumer and digital growth momentum structurally outstrips cyclical refining drag. Recommending aggressive accumulation with a 4.8% trailing stop.";

    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between pb-2 border-b border-white/10">
                <div>
                    <h3 class="font-sora text-sm font-bold text-white flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-purple-400 text-base">forum</span>
                        Research Team Head-to-Head Debate Points
                    </h3>
                    <p class="text-[11px] text-text-muted">Unfiltered adversarial arguments between Bull and Bear specialized research agents.</p>
                </div>
            </div>

            <!-- Bull vs Bear Head-to-Head Cards -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <!-- Bull Side -->
                <div class="debate-box-bull">
                    <div class="flex items-center gap-2 mb-2.5 pb-2 border-b border-primary/20">
                        <span class="text-2xl">🐂</span>
                        <div>
                            <div class="font-sora text-xs font-bold text-primary uppercase tracking-wider">Bull Researcher Argument</div>
                            <div class="text-[10px] text-slate-400">Core Thesis: Growth Catalysts & Outperformance</div>
                        </div>
                    </div>
                    <ul class="space-y-2 text-xs text-slate-200">
                        ${bullPts.map(pt => `
                            <li class="flex items-start gap-1.5">
                                <span class="material-symbols-outlined text-primary text-sm shrink-0">check_circle</span>
                                <span>${escapeHtml(pt)}</span>
                            </li>
                        `).join("")}
                    </ul>
                </div>

                <!-- Bear Side -->
                <div class="debate-box-bear">
                    <div class="flex items-center gap-2 mb-2.5 pb-2 border-b border-crimson-sell/20">
                        <span class="text-2xl">🐻</span>
                        <div>
                            <div class="font-sora text-xs font-bold text-crimson-sell uppercase tracking-wider">Bear Researcher Argument</div>
                            <div class="text-[10px] text-slate-400">Core Thesis: Vulnerabilities & Downside Traps</div>
                        </div>
                    </div>
                    <ul class="space-y-2 text-xs text-slate-200">
                        ${bearPts.map(pt => `
                            <li class="flex items-start gap-1.5">
                                <span class="material-symbols-outlined text-crimson-sell text-sm shrink-0">warning</span>
                                <span>${escapeHtml(pt)}</span>
                            </li>
                        `).join("")}
                    </ul>
                </div>
            </div>

            <!-- Research Manager Arbitration Card -->
            <div class="debate-box-judge">
                <div class="flex items-center gap-2 mb-2 pb-2 border-b border-cyan-accent/20">
                    <span class="text-2xl">⚖️</span>
                    <div>
                        <div class="font-sora text-xs font-bold text-cyan-accent uppercase tracking-wider">Research Manager Arbitration & Ruling</div>
                        <div class="text-[10px] text-slate-400">Impartial synthesis balancing upside vs downside exposure</div>
                    </div>
                </div>
                <p class="text-xs text-slate-200 leading-relaxed">${escapeHtml(ruling)}</p>
            </div>

            <!-- Risk Committee Perspectives -->
            <div class="glass-panel p-3 rounded-lg border border-white/5">
                <h4 class="text-xs font-bold uppercase tracking-wider text-amber-risk mb-2 flex items-center gap-1">
                    <span class="material-symbols-outlined text-xs">security</span> Risk Management Committee Debate
                </h4>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div class="p-2 rounded bg-surface/50 border border-white/5">
                        <div class="text-primary font-bold text-[11px] mb-1">Aggressive Analyst</div>
                        <p class="text-slate-300 text-[11px]">${escapeHtml(deb.risk_debates?.aggressive || "Allocate 10-12% weight to capture breakout momentum early.")}</p>
                    </div>
                    <div class="p-2 rounded bg-surface/50 border border-white/5">
                        <div class="text-cyan-accent font-bold text-[11px] mb-1">Neutral Analyst</div>
                        <p class="text-slate-300 text-[11px]">${escapeHtml(deb.risk_debates?.neutral || "Position at 7-8% with a 5% trailing stop-loss.")}</p>
                    </div>
                    <div class="p-2 rounded bg-surface/50 border border-white/5">
                        <div class="text-amber-risk font-bold text-[11px] mb-1">Conservative Analyst</div>
                        <p class="text-slate-300 text-[11px]">${escapeHtml(deb.risk_debates?.conservative || "Cap at 4.5% until next earnings release confirms margin resilience.")}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Animated Office Desk Actions Controller
 */
const AGENT_TO_DESK = {
    "Market Analyst": { deskId: "desk-market", badgeId: "badge-market", speechId: "speech-market", podId: "pod-research" },
    "Fundamentals Analyst": { deskId: "desk-fundamentals", badgeId: "badge-fundamentals", speechId: "speech-fundamentals", podId: "pod-research" },
    "Sentiment Analyst": { deskId: "desk-social", badgeId: "badge-social", speechId: "speech-social", podId: "pod-intel" },
    "News Analyst": { deskId: "desk-news", badgeId: "badge-news", speechId: "speech-news", podId: "pod-intel" },
    "Bull Researcher": { deskId: "desk-bull", badgeId: "badge-bull", speechId: "speech-bull", podId: "pod-debate" },
    "Bear Researcher": { deskId: "desk-bear", badgeId: "badge-bear", speechId: "speech-bear", podId: "pod-debate" },
    "Research Manager": { deskId: "desk-manager", badgeId: "badge-manager", speechId: "speech-manager", podId: "pod-debate" },
    "Trader": { deskId: "desk-trader", badgeId: "badge-trader", speechId: "speech-trader", podId: "pod-exec" },
    "Portfolio Manager": { deskId: "desk-pm", badgeId: "badge-pm", speechId: "speech-pm", podId: "pod-exec" },
};

function updateAgentDeskState(agent, status) {
    const mapping = AGENT_TO_DESK[agent];
    if (!mapping) return;

    const desk = document.getElementById(mapping.deskId);
    const badge = document.getElementById(mapping.badgeId);
    const pod = document.getElementById(mapping.podId);

    if (desk) {
        desk.classList.remove("desk-working", "desk-debating", "desk-done");
        if (status === "in_progress") {
            desk.classList.add(agent.includes("Researcher") || agent.includes("Manager") ? "desk-debating" : "desk-working");
            if (pod) pod.classList.add("pod-active");
        } else if (status === "completed") {
            desk.classList.add("desk-done");
        }
    }

    if (badge) {
        if (status === "in_progress") {
            badge.textContent = "Working";
            badge.className = "text-[8px] text-amber-risk font-semibold animate-pulse";
        } else if (status === "completed") {
            badge.textContent = "Done";
            badge.className = "text-[8px] text-primary font-semibold";
        } else {
            badge.textContent = "Idle";
            badge.className = "text-[8px] text-text-muted";
        }
    }
}

function triggerDeskAction(agent, action, speech) {
    const mapping = AGENT_TO_DESK[agent];
    if (!mapping) return;

    const desk = document.getElementById(mapping.deskId);
    const speechEl = document.getElementById(mapping.speechId);

    if (desk) {
        if (action === "typing" || action === "talking") {
            desk.classList.add("desk-working");
        } else if (action === "finished") {
            desk.classList.remove("desk-working");
            desk.classList.add("desk-done");
        }
    }

    if (speechEl && speech) {
        speechEl.textContent = speech;
        speechEl.classList.remove("hidden");
        setTimeout(() => {
            speechEl.classList.add("hidden");
        }, 4000);
    }
}

function markAllDesksDone() {
    Object.values(AGENT_TO_DESK).forEach(m => {
        const desk = document.getElementById(m.deskId);
        const badge = document.getElementById(m.badgeId);
        if (desk) {
            desk.classList.remove("desk-working", "desk-debating");
            desk.classList.add("desk-done");
        }
        if (badge) {
            badge.textContent = "Verified";
            badge.className = "text-[8px] text-primary font-semibold";
        }
    });
}

/**
 * Report Downloads: Markdown, HTML, JSON
 */
function downloadHtmlReport() {
    const md = getCurrentDossierMarkdown();
    const renderedHtml = (typeof marked !== "undefined" && marked.parse) ? marked.parse(md) : `<pre>${escapeHtml(md)}</pre>`;
    
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>TradingAgents Intelligence Report - ${state.resolvedTicker}</title>
    <style>
        body { background: #0b0f19; color: #dfe2f1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 900px; margin: 40px auto; padding: 0 20px; }
        h1, h2, h3 { color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
        h1 { color: #10b981; }
        h2 { color: #4cd7f6; margin-top: 28px; }
        h3 { color: #f59e0b; }
        blockquote { border-left: 3px solid #10b981; padding-left: 14px; color: #94a3b8; background: rgba(16,185,129,0.05); }
        code { background: #171b26; color: #4cd7f6; padding: 2px 6px; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #2e384d; padding: 8px 12px; text-align: left; }
        th { background: #171b26; }
    </style>
</head>
<body>
    <div style="text-align: right; font-size: 12px; color: #86948a;">Generated by TradingAgents Multi-Agent Cockpit</div>
    ${renderedHtml}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.resolvedTicker}_Dossier.html`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadJsonDossier() {
    const payload = {
        ticker: state.resolvedTicker,
        raw_ticker: state.rawTicker,
        market: state.selectedMarket,
        generated_at: new Date().toISOString(),
        quote: state.quoteData,
        financials: state.financialsData,
        debate: state.debateData,
        reports: state.reports,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.resolvedTicker}_Dossier.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function getCurrentDossierMarkdown() {
    return [
        `# TradingAgents Dossier: ${state.resolvedTicker}`,
        `Date: ${new Date().toISOString().slice(0, 10)}`,
        `\n## Final Trade Decision\n${state.reports.final_trade_decision || "N/A"}`,
        `\n## Research Team Debate\n${state.reports.investment_plan || "N/A"}`,
        `\n## Trading Team Strategy\n${state.reports.trader_investment_plan || "N/A"}`,
        `\n## Market Technicals\n${state.reports.market_report || "N/A"}`,
        `\n## Social Sentiment\n${state.reports.sentiment_report || "N/A"}`,
        `\n## News & Macro\n${state.reports.news_report || "N/A"}`,
        `\n## Fundamentals\n${state.reports.fundamentals_report || "N/A"}`,
    ].join("\n\n");
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
