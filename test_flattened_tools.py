import requests
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

# Flattened sequential single tool calls
messages = [
    {"role": "system", "content": "You are a trading assistant."},
    {"role": "user", "content": "Get stock data for AAPL and indicators for macd."},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "get_stock_data", "arguments": "{\"ticker\": \"AAPL\"}"}}
        ]
    },
    {"role": "tool", "tool_call_id": "call_1", "content": "Stock data for AAPL: close=230"},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_2", "type": "function", "function": {"name": "get_indicators", "arguments": "{\"indicators\": [\"macd\"]}"}}
        ]
    },
    {"role": "tool", "tool_call_id": "call_2", "content": "Indicator macd=1.5"}
]

payload = {
    "model": "meta/llama-3.2-11b-vision-instruct",
    "messages": messages,
    "max_tokens": 100
}

print("Testing flattened sequential tool calls on NVIDIA NIM...")
r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=15)
print("Status Code:", r.status_code)
print("Response:", r.text[:300])
