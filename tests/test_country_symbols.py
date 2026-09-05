"""Unit tests for country symbol normalization and automatic extension application."""

import unittest
from tradingagents.dataflows.symbol_utils import (
    COUNTRY_EXCHANGES,
    format_ticker_for_country,
    normalize_symbol,
)


class TestCountrySymbolFormatting(unittest.TestCase):
    def test_bom_alias_normalizes_to_bo(self):
        """Typing .BOM or .bom (Bombay Stock Exchange) resolves to Yahoo's .BO."""
        self.assertEqual(normalize_symbol("RELIANCE.BOM"), "RELIANCE.BO")
        self.assertEqual(normalize_symbol("500325.bom"), "500325.BO")
        self.assertEqual(normalize_symbol("TCS.BOM"), "TCS.BO")

    def test_format_ticker_for_india_nse(self):
        """Bare ticker or existing suffix gets converted to .NS for India NSE."""
        self.assertEqual(format_ticker_for_country("RELIANCE", "IN_NSE"), "RELIANCE.NS")
        self.assertEqual(format_ticker_for_country("reliance", "IN_NSE"), "RELIANCE.NS")
        # Strips old .BO or .BOM and applies .NS
        self.assertEqual(format_ticker_for_country("RELIANCE.BO", "IN_NSE"), "RELIANCE.NS")
        self.assertEqual(format_ticker_for_country("RELIANCE.BOM", "IN_NSE"), "RELIANCE.NS")
        # Idempotent if .NS already present
        self.assertEqual(format_ticker_for_country("RELIANCE.NS", "IN_NSE"), "RELIANCE.NS")

    def test_format_ticker_for_india_bse(self):
        """Bare ticker or existing suffix gets converted to .BO for India BSE."""
        self.assertEqual(format_ticker_for_country("RELIANCE", "IN_BSE"), "RELIANCE.BO")
        self.assertEqual(format_ticker_for_country("500325", "IN_BSE"), "500325.BO")
        self.assertEqual(format_ticker_for_country("TCS.bom", "IN_BSE"), "TCS.BO")
        self.assertEqual(format_ticker_for_country("TCS.NS", "IN_BSE"), "TCS.BO")

    def test_format_ticker_for_us(self):
        """US equities have no dot suffix."""
        self.assertEqual(format_ticker_for_country("AAPL", "US"), "AAPL")
        self.assertEqual(format_ticker_for_country("NVDA", "US"), "NVDA")
        # Strips previous market suffix if switching from another market
        self.assertEqual(format_ticker_for_country("AAPL.NS", "US"), "AAPL")

    def test_format_ticker_for_uk_japan_etc(self):
        """Other international markets apply their correct suffixes."""
        self.assertEqual(format_ticker_for_country("SHEL", "UK"), "SHEL.L")
        self.assertEqual(format_ticker_for_country("7203", "JP"), "7203.T")
        self.assertEqual(format_ticker_for_country("0700", "HK"), "0700.HK")
        self.assertEqual(format_ticker_for_country("SAP", "DE"), "SAP.DE")
        self.assertEqual(format_ticker_for_country("SHOP", "CA"), "SHOP.TO")
        self.assertEqual(format_ticker_for_country("BHP", "AU"), "BHP.AX")

    def test_preserves_special_symbols(self):
        """Indices and commodities are preserved."""
        self.assertEqual(format_ticker_for_country("^NSEI", "IN_NSE"), "^NSEI")
        self.assertEqual(format_ticker_for_country("GC=F", "US"), "GC=F")
        self.assertEqual(format_ticker_for_country("BTCUSD", "CRYPTO"), "BTC-USD")

    def test_country_exchanges_registry_integrity(self):
        """Verify registry structure."""
        self.assertIn("IN_NSE", COUNTRY_EXCHANGES)
        self.assertIn("IN_BSE", COUNTRY_EXCHANGES)
        self.assertIn("US", COUNTRY_EXCHANGES)
        self.assertEqual(COUNTRY_EXCHANGES["IN_NSE"]["benchmark"], "^NSEI")
        self.assertEqual(COUNTRY_EXCHANGES["IN_BSE"]["benchmark"], "^BSESN")


if __name__ == "__main__":
    unittest.main()
