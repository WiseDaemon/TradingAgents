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

print(f"Testing all {len(models)} NVIDIA NIM models for active chat completions...\n")
working_models = []

for model in models:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Say hello in 3 words."}],
        "temperature": 0.2,
        "max_tokens": 30
    }
    t0 = time.time()
    try:
        res = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=5)
        dur = round(time.time() - t0, 2)
        if res.status_code == 200:
            msg = res.json().get("choices", [{}])[0].get("message", {})
            content = msg.get("content")
            if content:
                print(f"[✅ WORKING] {model:<45} ({dur}s) -> {repr(content.strip())}")
                working_models.append((model, dur, content.strip()))
            else:
                reasoning = msg.get("reasoning_content") or msg.get("reasoning")
                print(f"[⚠️ 200 NO CONTENT] {model:<45} ({dur}s) -> reasoning: {repr(str(reasoning)[:40])}")
        elif res.status_code == 404:
            pass # Retired or not hosted on chat endpoint
        else:
            print(f"[❌ HTTP {res.status_code}] {model:<45} -> {res.text[:50]}")
    except Exception:
        pass # Timeout or connection error

print("\n" + "="*50)
print(f"SUMMARY: {len(working_models)} fully active models found:")
for m, dur, txt in working_models:
    print(f"  • {m} (avg latency: {dur}s)")
