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

test_list = [
    # Meta Llama
    "meta/llama-3.2-11b-vision-instruct",
    "meta/llama-3.2-90b-vision-instruct",
    
    # DeepSeek
    "deepseek-ai/deepseek-v4-pro-0813",
    "deepseek-ai/deepseek-v4-flash-0731",
    "deepseek-ai/deepseek-coder-6.7b-instruct",
    
    # OpenAI GPT-OSS (Hosted by NVIDIA)
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    
    # Google Gemma
    "google/gemma-4-31b-it",
    
    # Moonshot Kimi
    "moonshotai/kimi-k3",
    
    # Minimax
    "minimaxai/minimax-m3"
]

print("Detailed test of prominent NVIDIA NIM models:\n", flush=True)

for model in test_list:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "What is 2+2? Answer with just the number."}],
        "temperature": 0.2,
        "max_tokens": 50
    }
    if "deepseek" in model:
        payload["extra_body"] = {"chat_template_kwargs": {"thinking": False}}

    try:
        r = requests.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload, timeout=25)
        if r.status_code == 200:
            res_data = r.json()
            msg = res_data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content")
            reasoning = msg.get("reasoning_content") or msg.get("reasoning")
            print(f"[SUCCESS] {model}")
            print(f"   Content: {content}")
            if reasoning:
                print(f"   Reasoning: {reasoning[:80]}...")
            print(f"   Usage: {res_data.get('usage', {})}\n", flush=True)
        else:
            print(f"[HTTP {r.status_code}] {model}")
            print(f"   Response: {r.text[:100]}\n", flush=True)
    except Exception as e:
        print(f"[TIMEOUT/ERROR] {model}: {e}\n", flush=True)
