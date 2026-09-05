import os
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from tradingagents.llm_clients.factory import create_llm_client

load_dotenv()

client_wrapper = create_llm_client(
    provider="nvidia",
    model="meta/llama-3.2-11b-vision-instruct",
    base_url="https://integrate.api.nvidia.com/v1",
)
llm = client_wrapper.get_llm()

# Create a conversation with multiple tool calls in 1 turn
ai_msg = AIMessage(
    content="",
    tool_calls=[
        {"id": "call_1", "name": "get_stock_data", "args": {"ticker": "AAPL"}},
        {"id": "call_2", "name": "get_indicators", "args": {"indicators": ["macd"]}},
    ]
)
tool_msg_1 = ToolMessage(content="AAPL data retrieved.", tool_call_id="call_1")
tool_msg_2 = ToolMessage(content="MACD: 1.5", tool_call_id="call_2")

messages = [
    HumanMessage(content="Analyze AAPL."),
    ai_msg,
    tool_msg_1,
    tool_msg_2
]

print("Invoking LLM with multi-tool history through LangChain ...")
try:
    res = llm.invoke(messages)
    print("SUCCESS! Model response:")
    print(res.content[:200])
except Exception as e:
    print("FAILED:", e)
