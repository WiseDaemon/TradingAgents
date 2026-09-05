import requests
import os
import json
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
}

payload = {
    "model": "deepseek-ai/deepseek-v4-pro-0813",
    "messages": [{"role": "user", "content": "Write a 4-line poem about stock markets."}],
    "temperature": 0.7,
    "top_p": 0.95,
    "max_tokens": 1024,
    "stream": True
}

print("Sending streaming chat request to NVIDIA NIM ...", flush=True)
try:
    response = requests.post(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        headers=headers,
        json=payload,
        stream=True,
        timeout=60
    )
    print("Status:", response.status_code, flush=True)
    full_text = ""
    for line in response.iter_lines():
        if line:
            decoded = line.decode('utf-8')
            if decoded.startswith("data: ") and not decoded.startswith("data: [DONE]"):
                try:
                    data = json.loads(decoded[6:])
                    delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    if delta:
                        print(delta, end="", flush=True)
                        full_text += delta
                except Exception:
                    pass
    print("\n\n[SUCCESS] Stream complete!", flush=True)
except Exception as e:
    print(f"\n[ERROR] Request failed: {e}", flush=True)
