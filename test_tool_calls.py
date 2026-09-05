import requests
import os
import sys
from dotenv import load_dotenv

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_data",
            "description": "Fetch stock OHLCV data",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"}
                },
                "required": ["ticker"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_indicators",
            "description": "Fetch technical indicators",
            "parameters": {
                "type": "object",
                "properties": {
                    "indicators": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["indicators"]
            }
        }
    }
]

payload = {
    "model": "meta/llama-3.2-11b-vision-instruct",
    "messages": [
        {"role": "system", "content": "You are a trading assistant."},
        {"role": "user", "content": "Get stock data for AAPL and indicators for macd and rsi."}
    ],
    "tools": tools,
    "parallel_tool_calls": False,
    "max_tokens": 100
}

print("Testing tool call with parallel_tool_calls=False on NVIDIA NIM...")
r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=15)
print("Status Code:", r.status_code)
print("Response:", r.text)
