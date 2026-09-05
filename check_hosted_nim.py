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

r = requests.get("https://integrate.api.nvidia.com/v1/models", headers=headers, timeout=15)
models = [m["id"] for m in r.json().get("data", [])]

print("Checking active hosted models on NVIDIA NIM...\n", flush=True)

active_models = []
for model in models:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 5
    }
    try:
        res = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=3)
        if res.status_code != 404:
            print(f"[{res.status_code}] {model}", flush=True)
            active_models.append((model, res.status_code))
    except Exception as e:
        # If it timed out, it is active and queued/processing!
        print(f"[QUEUED/ACTIVE] {model}", flush=True)
        active_models.append((model, "Queued"))

print("\n--- Summary of Active Hosted Models ---")
for m, s in active_models:
    print(f"  {m} ({s})")
