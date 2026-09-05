import requests
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

# Single tool call in turn 1, single tool response
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
    {"role": "tool", "tool_call_id": "call_1", "content": "Stock data for AAPL: close=230"}
]

payload = {
    "model": "meta/llama-3.2-11b-vision-instruct",
    "messages": messages,
    "max_tokens": 100
}

print("Testing single tool-call history on NVIDIA NIM...")
r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=15)
print("Status Code:", r.status_code)
print("Response:", r.text)
