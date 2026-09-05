import requests
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

print("Checking NVIDIA NIM /v1/models ...", flush=True)
try:
    r = requests.get("https://integrate.api.nvidia.com/v1/models", headers=headers, timeout=15)
    print("Status code:", r.status_code, flush=True)
    models = [m.get("id") for m in r.json().get("data", [])]
    print(f"Total models available: {len(models)}", flush=True)
    deepseek_models = [m for m in models if "deepseek" in m.lower()]
    print("DeepSeek models found:", deepseek_models, flush=True)
except Exception as e:
    print("Failed to list models:", e, flush=True)
