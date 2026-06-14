from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")
    tavily_api_key: str = Field(default="")

    database_url: str = Field(default="sqlite+aiosqlite:///./data/app.db")
    checkpoint_db_url: str = Field(default="sqlite:///./data/checkpoints.db")

    log_level: str = Field(default="INFO")
    cors_origins: str = Field(default="http://localhost:5173")

    workflow_max_attempts: int = Field(default=2)
    workflow_search_results_per_query: int = Field(default=5)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
