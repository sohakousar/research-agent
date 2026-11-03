# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-3.5-flash"
    groq_api_key: Optional[str] = None
    default_llm_provider: str = "gemini"
    groq_model: str = "openai/gpt-oss-120b"
    port: int = 8000
    host: str = "127.0.0.1"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()