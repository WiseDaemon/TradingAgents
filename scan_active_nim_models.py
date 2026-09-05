import requests
import os
import time
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

r = requests.get("https://integrate.api.nvidia.com/v1/models", headers=headers, timeout=15)
models = [m["id"] for m in r.json().get("data", [])]

# Test top chat models
candidates = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "meta/llama2-70b",
    "meta/llama-3.2-90b-vision-instruct",
    "meta/llama-3.2-11b-vision-instruct",
    "mistralai/mistral-large",
    "mistralai/mixtral-8x22b-v0.1",
    "mistralai/mistral-7b-instruct-v0.3",
    "google/gemma-3-12b-it",
    "google/gemma-3-4b-it",
    "01-ai/yi-large",
    "ai21labs/jamba-1.5-large-instruct",
    "moonshotai/kimi-k2.6",
    "moonshotai/kimi-k3",
]

print("Testing active chat models on NVIDIA NIM...")
for model in candidates:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "What is the capital of France? Answer in one word."}],
        "temperature": 0.2,
        "max_tokens": 30
    }
    t0 = time.time()
    try:
        res = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=6)
        dur = round(time.time() - t0, 2)
        if res.status_code == 200:
            content = res.json().get("choices", [{}])[0].get("message", {}).get("content")
            print(f"[ACTIVE 200 OK] {model:<38} in {dur}s -> {repr(content)}")
        else:
            print(f"[HTTP {res.status_code}] {model:<38} in {dur}s -> {res.text[:60]}")
    except Exception as e:
        print(f"[TIMEOUT/ERR] {model:<38} -> {str(e)[:40]}")
