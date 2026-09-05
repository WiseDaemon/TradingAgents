import requests
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

def _flatten_multi_tool_calls(messages: list[dict]) -> list[dict]:
    new_messages = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.get("role") == "assistant" and len(msg.get("tool_calls") or []) > 1:
            tool_calls = msg["tool_calls"]
            tool_resps = {}
            j = i + 1
            while j < len(messages) and messages[j].get("role") == "tool":
                tid = messages[j].get("tool_call_id")
                if tid:
                    tool_resps[tid] = messages[j]
                j += 1
            
            for tc in tool_calls:
                new_msg = dict(msg)
                new_msg["tool_calls"] = [tc]
                new_messages.append(new_msg)
                if tc.get("id") in tool_resps:
                    new_messages.append(tool_resps[tc["id"]])
            
            i = j
        else:
            new_messages.append(msg)
            i += 1
    return new_messages

# Test with 2 tool calls and 2 tool results
messages = [
    {"role": "system", "content": "You are a trading assistant."},
    {"role": "user", "content": "Get stock data for AAPL and indicators for macd and rsi."},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "get_stock_data", "arguments": "{\"ticker\": \"AAPL\"}"}},
            {"id": "call_2", "type": "function", "function": {"name": "get_indicators", "arguments": "{\"indicators\": [\"macd\"]}"}}
        ]
    },
    {"role": "tool", "tool_call_id": "call_1", "content": "Stock data for AAPL: close=230"},
    {"role": "tool", "tool_call_id": "call_2", "content": "Indicator macd=1.5"}
]

flattened = _flatten_multi_tool_calls(messages)
print("Flattened message count:", len(flattened))

payload = {
    "model": "meta/llama-3.2-11b-vision-instruct",
    "messages": flattened,
    "max_tokens": 100
}

r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=15)
print("Status Code:", r.status_code)
print("Response:", r.text[:200])
