import requests
import os
import json
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

r = requests.get("https://integrate.api.nvidia.com/v1/models", headers=headers, timeout=15)
if r.status_code == 200:
    data = r.json().get("data", [])
    model_ids = sorted([m["id"] for m in data])
    print(f"Total available NIM models: {len(model_ids)}\n")
    for m in model_ids:
        print(f"- {m}")
else:
    print("Error fetching models:", r.status_code, r.text)
