import requests
import os
import sys
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

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

models = [
    "deepseek-ai/deepseek-v4-flash-0731",
    "deepseek-ai/deepseek-v4-pro-0813",
    "mistralai/mistral-nemotron",
    "google/gemma-4-31b-it",
    "minimaxai/minimax-m3",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
]

print("Testing which models support multi-tool history on NVIDIA NIM...\n")

for model in models:
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": 100
    }
    if "deepseek" in model:
        payload["extra_body"] = {"chat_template_kwargs": {"thinking": False}}
    try:
        r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=20)
        if r.status_code == 200:
            print(f"✅ [SUPPORTED] {model}")
        else:
            print(f"❌ [{r.status_code}] {model} -> {r.text[:80]}")
    except Exception as e:
        print(f"⏱️ [TIMEOUT] {model}")
