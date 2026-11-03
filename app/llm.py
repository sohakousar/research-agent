import os
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

PROVIDERS = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
          "default_model": "gemini-3.7-flash",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "default_model": "openai/gpt-oss-120b:free",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "key_env": "CEREBRAS_API_KEY",
        "default_model": "gpt-oss-120b",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "default_model": "openai/gpt-oss-120b",
    },
}


def get_client(provider=None, api_key=None, model=None):
    provider = (provider or os.getenv("DEFAULT_LLM_PROVIDER", "gemini")).lower()
    if provider not in PROVIDERS:
        raise ValueError(f"Unsupported provider '{provider}'. Choose from: {', '.join(PROVIDERS)}")

    cfg = PROVIDERS[provider]
    key = api_key or os.getenv(cfg["key_env"])
    if not key:
        raise ValueError(f"Missing API key: set {cfg['key_env']} in .env")

    model = model or os.getenv(f"{provider.upper()}_MODEL") or cfg["default_model"]
    return AsyncOpenAI(api_key=key, base_url=cfg["base_url"]), model