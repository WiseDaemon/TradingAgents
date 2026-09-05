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

fast_candidates = [
    "meta/llama-3.2-11b-vision-instruct",
    "ibm/granite-3.0-8b-instruct",
    "ibm/granite-3.0-3b-a800m-instruct",
    "deepseek-ai/deepseek-coder-6.7b-instruct",
    "google/codegemma-7b",
    "nvidia/mistral-nemo-minitron-8b-8k-instruct",
    "nvidia/llama-3.1-nemotron-51b-instruct",
]

print("Testing fast response models:\n", flush=True)

for model in fast_candidates:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "What is the capital of Japan? Answer in 1 word."}],
        "temperature": 0.2,
        "max_tokens": 20
    }
    try:
        r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=10)
        if r.status_code == 200:
            res_data = r.json()
            content = res_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            print(f"[READY] {model:<45} -> {content}", flush=True)
        else:
            print(f"[HTTP {r.status_code}] {model:<45} -> {r.text[:50]}", flush=True)
    except Exception as e:
        print(f"[TIMEOUT] {model:<45}", flush=True)
