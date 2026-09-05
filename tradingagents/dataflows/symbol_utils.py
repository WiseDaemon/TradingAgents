"""Symbol normalization and market-data error types for vendor calls.

Yahoo Finance (the default vendor) uses specific ticker conventions that
differ from the broker / TradingView / MT5 style symbols users often type:

    user types        Yahoo wants       why
    ---------------   ---------------   -----------------------------------
    XAUUSD, XAUUSD+   GC=F              gold has no forex pair on Yahoo;
                                        it is quoted as a COMEX future
    EURUSD            EURUSD=X          spot forex pairs take a ``=X`` suffix
    BTCUSD            BTC-USD           crypto pairs use a ``-`` separator
    SPX500, US500     ^GSPC             index CFDs map to Yahoo index symbols

Passing the raw broker symbol to Yahoo returns an empty result, which the
agents previously received as free text and could hallucinate a price
around (see issue #781). Centralizing the mapping here means every yfinance
entry point resolves symbols the same way, and new instruments are added by
appending a table row rather than editing call sites.
"""

from __future__ import annotations

import logging
import re

# NoMarketDataError lives in the vendor-error taxonomy (errors.py); re-exported
# here for the many call sites that import it alongside normalize_symbol.
from .errors import NoMarketDataError as NoMarketDataError

logger = logging.getLogger(__name__)


# ISO-4217 codes common enough to appear in retail forex pairs. A bare
# six-letter symbol whose halves are BOTH in this set is treated as a spot
# forex pair and given Yahoo's ``=X`` suffix.
_FOREX_CURRENCIES = frozenset(
    {
        "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
        "CNY", "CNH", "HKD", "SGD", "SEK", "NOK", "DKK", "PLN",
        "MXN", "ZAR", "TRY", "INR", "KRW", "BRL", "RUB", "THB",
    }
)

# Crypto bases that brokers quote against USD without a separator.
_CRYPTO_BASES = frozenset(
    {"BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BCH", "DOT", "AVAX", "LINK"}
)

# Explicit aliases for instruments whose broker symbol does not map to a
# Yahoo symbol by rule. Metals/energy resolve to their front-month future;
# index CFD names resolve to the underlying Yahoo index symbol. Extend by
# adding rows — no call site changes required.
_ALIASES = {
    # Precious metals (spot names -> COMEX/NYMEX futures)
    "XAUUSD": "GC=F", "XAU": "GC=F", "GOLD": "GC=F",
    "XAGUSD": "SI=F", "XAG": "SI=F", "SILVER": "SI=F",
    "XPTUSD": "PL=F", "XPDUSD": "PA=F",
    # Energy
    "WTICOUSD": "CL=F", "USOIL": "CL=F", "WTI": "CL=F",
    "BCOUSD": "BZ=F", "UKOIL": "BZ=F", "BRENT": "BZ=F",
    "NATGAS": "NG=F", "XNGUSD": "NG=F",
    "COPPER": "HG=F", "XCUUSD": "HG=F",
    # Index CFDs -> Yahoo index symbols
    "SPX500": "^GSPC", "US500": "^GSPC", "SPX": "^GSPC",
    "NAS100": "^NDX", "US100": "^NDX", "USTEC": "^NDX",
    "US30": "^DJI", "DJI30": "^DJI", "WS30": "^DJI",
    "GER40": "^GDAXI", "GER30": "^GDAXI", "DE40": "^GDAXI",
    "UK100": "^FTSE", "JP225": "^N225", "JPN225": "^N225",
    "FRA40": "^FCHI", "EU50": "^STOXX50E", "HK50": "^HSI",
}

# Yahoo symbols may contain letters, digits, and these structural characters.
_YAHOO_SAFE = re.compile(r"^[A-Za-z0-9._\-\^=]+$")


# Crypto quote currencies that all map to Yahoo's USD pair. Yahoo lists only
# ``<BASE>-USD`` (not the USDT/USDC stablecoin pairs), so a broker symbol quoted
# in any of these resolves to ``-USD`` (#982). Longest first so ``USDT``/``USDC``
# match before the ``USD`` substring.
_CRYPTO_QUOTES = ("USDT", "USDC", "USD")


def crypto_base(raw: str) -> str | None:
    """Return the crypto base (e.g. ``BTC``) for a known USD/USDT/USDC-quoted
    crypto symbol in any form the pipeline may hold — ``BTC-USD``, ``BTCUSD``,
    ``BTC-USDT`` — or None for non-crypto symbols. Purely syntactic.
    """
    if not isinstance(raw, str):
        return None
    compact = raw.strip().upper().rstrip("+").replace("-", "")
    for quote in _CRYPTO_QUOTES:
        if compact.endswith(quote):
            base = compact[: -len(quote)]
            return base if base in _CRYPTO_BASES else None
    return None


def _normalize_crypto(s: str) -> str | None:
    """Return ``<BASE>-USD`` for a known USD/USDT/USDC-quoted crypto, else None."""
    base = crypto_base(s)
    return f"{base}-USD" if base else None


def normalize_symbol(raw: str) -> str:
    """Map a user/broker symbol to its canonical Yahoo Finance symbol.

    Resolution order (first match wins):
      1. Explicit alias table (metals, energy, index CFDs).
      2. Crypto rule: a known crypto base quoted in USD/USDT/USDC (dashed or
         not) -> ``BASE-USD``.
      3. Forex rule: six letters that are two ISO currency codes -> ``PAIR=X``.
      4. Otherwise the upper-cased symbol is returned unchanged (plain
         equities, ETFs, Yahoo-native symbols like ``GC=F`` or ``^GSPC``).

    A trailing ``+`` (broker CFD marker, e.g. ``XAUUSD+``) is stripped before
    matching. The function is purely syntactic — it performs no network
    calls — so it is safe to apply on every request.
    """
    if not isinstance(raw, str) or not raw.strip():
        return raw

    s = raw.strip().upper()
    # Broker CFD/qualifier suffixes Yahoo never uses.
    s = s.rstrip("+")

    # Normalize .BOM (Bombay Stock Exchange) broker alias to Yahoo's .BO suffix
    if s.endswith(".BOM"):
        s = s[:-4] + ".BO"

    crypto = _normalize_crypto(s)
    if s in _ALIASES:
        canonical = _ALIASES[s]
    elif crypto is not None:
        canonical = crypto
    elif len(s) == 6 and s[:3] in _FOREX_CURRENCIES and s[3:] in _FOREX_CURRENCIES:
        canonical = f"{s}=X"
    else:
        canonical = s

    if canonical != raw.strip().upper():
        logger.info("Resolved symbol %r to Yahoo symbol %r", raw, canonical)
    return canonical


def is_yahoo_safe(symbol: str) -> bool:
    """True when ``symbol`` only contains characters Yahoo symbols use."""
    return bool(symbol) and _YAHOO_SAFE.fullmatch(symbol) is not None


# Known exchange suffixes across world markets supported by Yahoo Finance
EXCHANGE_SUFFIXES = (
    ".NS", ".BO", ".BOM", ".L", ".T", ".HK", ".DE", ".PA", ".TO", ".AX", ".SS", ".SZ"
)

# Registry of supported global equity markets and their parameters
COUNTRY_EXCHANGES = {
    "IN_NSE": {
        "id": "IN_NSE",
        "name": "India (NSE)",
        "country": "India",
        "exchange": "National Stock Exchange",
        "flag": "🇮🇳",
        "suffix": ".NS",
        "benchmark": "^NSEI",
        "benchmark_name": "Nifty 50",
        "currency": "INR",
        "currency_symbol": "₹",
        "sample_tickers": ["RELIANCE", "TCS", "HDFCBANK", "INFY", "TATAMOTORS", "ITC", "ICICIBANK"],
    },
    "IN_BSE": {
        "id": "IN_BSE",
        "name": "India (BSE)",
        "country": "India",
        "exchange": "Bombay Stock Exchange",
        "flag": "🇮🇳",
        "suffix": ".BO",
        "benchmark": "^BSESN",
        "benchmark_name": "BSE Sensex",
        "currency": "INR",
        "currency_symbol": "₹",
        "sample_tickers": ["500325", "RELIANCE", "TCS", "HDFCBANK", "INFY", "TATAMOTORS"],
    },
    "US": {
        "id": "US",
        "name": "United States (NYSE/NASDAQ)",
        "country": "United States",
        "exchange": "NYSE / NASDAQ",
        "flag": "🇺🇸",
        "suffix": "",
        "benchmark": "SPY",
        "benchmark_name": "S&P 500 ETF",
        "currency": "USD",
        "currency_symbol": "$",
        "sample_tickers": ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "GOOGL", "META", "SPY"],
    },
    "UK": {
        "id": "UK",
        "name": "United Kingdom (LSE)",
        "country": "United Kingdom",
        "exchange": "London Stock Exchange",
        "flag": "🇬🇧",
        "suffix": ".L",
        "benchmark": "^FTSE",
        "benchmark_name": "FTSE 100",
        "currency": "GBP",
        "currency_symbol": "£",
        "sample_tickers": ["SHEL", "AZN", "HSBA", "ULVR", "BP", "RIO"],
    },
    "JP": {
        "id": "JP",
        "name": "Japan (TSE)",
        "country": "Japan",
        "exchange": "Tokyo Stock Exchange",
        "flag": "🇯🇵",
        "suffix": ".T",
        "benchmark": "^N225",
        "benchmark_name": "Nikkei 225",
        "currency": "JPY",
        "currency_symbol": "¥",
        "sample_tickers": ["7203", "6758", "9984", "8306", "6861"],
    },
    "HK": {
        "id": "HK",
        "name": "Hong Kong (HKEX)",
        "country": "Hong Kong",
        "exchange": "Hong Kong Exchanges",
        "flag": "🇭🇰",
        "suffix": ".HK",
        "benchmark": "^HSI",
        "benchmark_name": "Hang Seng Index",
        "currency": "HKD",
        "currency_symbol": "HK$",
        "sample_tickers": ["0700", "9988", "0941", "1299", "3690"],
    },
    "DE": {
        "id": "DE",
        "name": "Germany (XETRA)",
        "country": "Germany",
        "exchange": "Frankfurt / XETRA",
        "flag": "🇩🇪",
        "suffix": ".DE",
        "benchmark": "^GDAXI",
        "benchmark_name": "DAX Performance Index",
        "currency": "EUR",
        "currency_symbol": "€",
        "sample_tickers": ["SAP", "SIE", "ALV", "VOW3", "BMW", "BAYN"],
    },
    "FR": {
        "id": "FR",
        "name": "France (Euronext Paris)",
        "country": "France",
        "exchange": "Euronext Paris",
        "flag": "🇫🇷",
        "suffix": ".PA",
        "benchmark": "^FCHI",
        "benchmark_name": "CAC 40",
        "currency": "EUR",
        "currency_symbol": "€",
        "sample_tickers": ["MC", "OR", "TTE", "SAN", "AIR", "BNP"],
    },
    "CA": {
        "id": "CA",
        "name": "Canada (TSX)",
        "country": "Canada",
        "exchange": "Toronto Stock Exchange",
        "flag": "🇨🇦",
        "suffix": ".TO",
        "benchmark": "^GSPTSE",
        "benchmark_name": "S&P/TSX Composite",
        "currency": "CAD",
        "currency_symbol": "CA$",
        "sample_tickers": ["SHOP", "RY", "TD", "ENB", "CNR", "BMO"],
    },
    "AU": {
        "id": "AU",
        "name": "Australia (ASX)",
        "country": "Australia",
        "exchange": "Australian Securities Exchange",
        "flag": "🇦🇺",
        "suffix": ".AX",
        "benchmark": "^AXJO",
        "benchmark_name": "S&P/ASX 200",
        "currency": "AUD",
        "currency_symbol": "A$",
        "sample_tickers": ["BHP", "CBA", "CSL", "NAB", "WBC", "FMG"],
    },
    "CN_SH": {
        "id": "CN_SH",
        "name": "China (Shanghai SSE)",
        "country": "China",
        "exchange": "Shanghai Stock Exchange",
        "flag": "🇨🇳",
        "suffix": ".SS",
        "benchmark": "000001.SS",
        "benchmark_name": "SSE Composite",
        "currency": "CNY",
        "currency_symbol": "¥",
        "sample_tickers": ["600519", "601398", "601857", "600036"],
    },
    "CN_SZ": {
        "id": "CN_SZ",
        "name": "China (Shenzhen SZSE)",
        "country": "China",
        "exchange": "Shenzhen Stock Exchange",
        "flag": "🇨🇳",
        "suffix": ".SZ",
        "benchmark": "399001.SZ",
        "benchmark_name": "SZSE Component",
        "currency": "CNY",
        "currency_symbol": "¥",
        "sample_tickers": ["000858", "002594", "300750", "000333"],
    },
    "CRYPTO": {
        "id": "CRYPTO",
        "name": "Crypto & Commodities",
        "country": "Global",
        "exchange": "Decentralized / COMEX",
        "flag": "🪙",
        "suffix": "",
        "benchmark": "BTC-USD",
        "benchmark_name": "Bitcoin USD",
        "currency": "USD",
        "currency_symbol": "$",
        "sample_tickers": ["BTC-USD", "ETH-USD", "SOL-USD", "GC=F", "CL=F"],
    },
}


def format_ticker_for_country(raw_ticker: str, market_id: str = "US") -> str:
    """Format and apply the correct country exchange suffix automatically.

    Strips any existing recognized exchange suffix (e.g. ``.NS``, ``.BO``, ``.BOM``)
    and applies the selected market's canonical suffix. Preserves commodities/forex
    symbols and indices (e.g. ``GC=F``, ``^NSEI``).
    """
    if not isinstance(raw_ticker, str) or not raw_ticker.strip():
        return ""

    s = raw_ticker.strip().upper()

    # Index or special symbol (e.g. ^NSEI, GC=F)
    if s.startswith("^") or "=" in s:
        return normalize_symbol(s)

    # Commodity / Forex / Crypto aliases
    if s in _ALIASES:
        return normalize_symbol(s)

    # Crypto detection
    base = crypto_base(s)
    if base is not None:
        return f"{base}-USD"

    # Strip existing exchange suffix if present
    base_sym = s
    for suffix in sorted(EXCHANGE_SUFFIXES, key=len, reverse=True):
        if base_sym.endswith(suffix):
            base_sym = base_sym[: -len(suffix)]
            break

    market_info = COUNTRY_EXCHANGES.get(market_id, COUNTRY_EXCHANGES.get("US", {}))
    target_suffix = market_info.get("suffix", "")

    if target_suffix:
        return f"{base_sym}{target_suffix}"
    return base_sym

