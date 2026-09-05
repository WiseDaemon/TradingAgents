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

test_models = [
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "mistralai/mistral-large-2-instruct",
    "writer/palmyra-fin-70b-32k",
    "openai/gpt-oss-120b",
    "google/gemma-4-31b-it",
    "minimaxai/minimax-m3",
    "deepseek-ai/deepseek-v4-flash-0731",
    "deepseek-ai/deepseek-v4-pro-0813"
]

print(f"{'Model Name':<45} | {'Status':<8} | {'Latency':<8} | {'Sample Output'}")
print("-" * 90)

for model in test_models:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Analyze stock market risk in 1 short sentence."}],
        "temperature": 0.5,
        "max_tokens": 60
    }
    t0 = time.time()
    try:
        r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=12)
        latency = f"{time.time() - t0:.2f}s"
        if r.status_code == 200:
            res = r.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip().replace("\n", " ")
            print(f"{model:<45} | 200 OK   | {latency:<8} | {res[:45]}...")
        else:
            print(f"{model:<45} | Err {r.status_code} | {latency:<8} | {r.text[:45]}")
    except Exception as e:
        latency = f"{time.time() - t0:.2f}s"
        print(f"{model:<45} | Timeout  | {latency:<8} | {str(e)[:45]}")
