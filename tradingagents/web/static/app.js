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
    } else if (ev === "report_section") {
        state.reports[data.section] = data.content;
        renderDossierContent();
    } else if (ev === "decision") {
        updateConsensusCard(data);
    } else if (ev === "complete") {
        appendTerminalLog("System", `Analysis completed in ${data.elapsed_seconds || 0}s.`);
        resetRunButton();
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

    let mdText = "";
    const tab = state.activeTab;

    if (tab === "summary") {
        mdText = state.reports.final_trade_decision || state.reports.investment_plan || "### Executive Multi-Agent Summary\n_Analysis in progress or awaiting execution._";
    } else if (tab === "technical") {
        mdText = state.reports.market_report || "### Technical Analysis\n_Market Analyst evaluating technical patterns and indicators._";
    } else if (tab === "sentiment") {
        mdText = state.reports.sentiment_report || "### Social Sentiment\n_Sentiment Analyst scanning public discourse and sentiment volume._";
    } else if (tab === "news") {
        mdText = state.reports.news_report || "### Global News & Macroeconomics\n_News Analyst interpreting geopolitical context and central bank decisions._";
    } else if (tab === "fundamentals") {
        mdText = state.reports.fundamentals_report || "### Fundamental Health\n_Fundamentals Analyst assessing balance sheet, free cash flow, and DCF._";
    } else if (tab === "debate") {
        mdText = state.reports.investment_plan || "### Bull vs Bear Debate Log\n_Researchers formulating conflicting theses to uncover critical risks._";
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
