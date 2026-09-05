"""Unit tests for the web server API endpoints."""

import unittest
from aiohttp.test_utils import AioHTTPTestCase
from tradingagents.web.server import create_app


class TestWebAPI(AioHTTPTestCase):
    async def get_application(self):
        return create_app()

    async def test_index_page(self):
        """Test GET / serves HTML."""
        resp = await self.client.get("/")
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn("TradingAgents", text)
        self.assertIn("Country & Exchange", text)

    async def test_get_markets(self):
        """Test GET /api/markets returns market list."""
        resp = await self.client.get("/api/markets")
        self.assertEqual(resp.status, 200)
        json_data = await resp.json()
        self.assertEqual(json_data["status"], "success")
        market_ids = [m["id"] for m in json_data["markets"]]
        self.assertIn("IN_NSE", market_ids)
        self.assertIn("IN_BSE", market_ids)
        self.assertIn("US", market_ids)

    async def test_normalize_ticker(self):
        """Test POST /api/normalize-ticker handles country auto-extension."""
        # India NSE
        resp = await self.client.post("/api/normalize-ticker", json={"ticker": "RELIANCE", "market": "IN_NSE"})
        data = await resp.json()
        self.assertEqual(data["resolved_ticker"], "RELIANCE.NS")
        self.assertEqual(data["benchmark"], "^NSEI")

        # India BSE with .bom typed by user
        resp2 = await self.client.post("/api/normalize-ticker", json={"ticker": "TCS.bom", "market": "IN_BSE"})
        data2 = await resp2.json()
        self.assertEqual(data2["resolved_ticker"], "TCS.BO")
        self.assertEqual(data2["benchmark"], "^BSESN")

        # US Equities
        resp3 = await self.client.post("/api/normalize-ticker", json={"ticker": "AAPL", "market": "US"})
        data3 = await resp3.json()
        self.assertEqual(data3["resolved_ticker"], "AAPL")
        self.assertEqual(data3["benchmark"], "SPY")

    async def test_get_config(self):
        """Test GET /api/config returns model registry."""
        resp = await self.client.get("/api/config")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("today", data)
        self.assertIn("providers", data)

    async def test_get_quote_fallback(self):
        """Test GET /api/quote returns quote object with chart bars."""
        resp = await self.client.get("/api/quote?ticker=RELIANCE.NS&market=IN_NSE")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("data", data)
        self.assertTrue(len(data["data"]["chart_data"]) > 0)
        self.assertGreater(data["data"]["price"], 0)


if __name__ == "__main__":
    unittest.main()
