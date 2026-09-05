import os
import sys
from dotenv import load_dotenv

load_dotenv()

print("Testing TradingAgents API Configurations...", flush=True)

print("\n--- 1. Testing FRED API ---", flush=True)
try:
    import requests
    api_key = os.getenv("FRED_API_KEY")
    url = f"https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key={api_key}&file_type=json"
    res = requests.get(url, timeout=10)
    res.raise_for_status()
    obs = res.json().get("observations", [])
    if obs:
        print(f"[SUCCESS] FRED API Connected! Latest observation: {obs[-1]}", flush=True)
    else:
        print("[SUCCESS] Connected to FRED API.", flush=True)
except Exception as e:
    print(f"[ERROR] FRED API test failed: {e}", flush=True)

print("\n--- 2. Testing Alpha Vantage API ---", flush=True)
try:
    import requests
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY")
    url = f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey={api_key}"
    res = requests.get(url, timeout=10)
    res.raise_for_status()
    data = res.json()
    if "Global Quote" in data:
        print(f"[SUCCESS] Alpha Vantage quote retrieved: {data['Global Quote']}", flush=True)
    elif "Note" in data or "Information" in data:
        print(f"[INFO] Alpha Vantage response: {data}", flush=True)
    else:
        print(f"[SUCCESS] Alpha Vantage response: {data}", flush=True)
except Exception as e:
    print(f"[ERROR] Alpha Vantage test failed: {e}", flush=True)

print("\n--- 3. Testing NVIDIA NIM DeepSeek LLM ---", flush=True)
try:
    from openai import OpenAI
    client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=os.getenv("NVIDIA_API_KEY"),
        timeout=90.0
    )
    completion = client.chat.completions.create(
        model=os.getenv("TRADINGAGENTS_DEEP_THINK_LLM", "deepseek-ai/deepseek-v4-pro-0813"),
        messages=[{"role": "user", "content": "Write a one-sentence market greeting."}],
        temperature=0.7,
        max_tokens=256,
        extra_body={"chat_template_kwargs": {"thinking": False}},
        stream=False
    )
    print(f"[SUCCESS] NVIDIA NIM Response:\n{completion.choices[0].message.content.strip()}", flush=True)
except Exception as e:
    print(f"[ERROR] NVIDIA NIM test failed: {e}", flush=True)

print("\n=== Verification Complete ===", flush=True)
