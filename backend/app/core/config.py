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
    openai_base_url: str = Field(default="")
    tavily_api_key: str = Field(default="")

    # Auth (Clerk). Without these set, every protected endpoint returns 401.
    clerk_secret_key: str = Field(default="")
    clerk_publishable_key: str = Field(default="")

    # Canonical Postgres URL in psycopg form (postgresql://...).
    # The LangGraph checkpointer consumes this URL directly.
    # SQLAlchemy uses `sqlalchemy_url` (asyncpg driver) below.
    database_url: str = Field(
        default="postgresql://researchcopilot:researchcopilot@localhost:5432/research_copilot"
    )

    log_level: str = Field(default="INFO")
    cors_origins: str = Field(default="http://localhost:5173")

    workflow_max_attempts: int = Field(default=2)
    workflow_search_results_per_query: int = Field(default=5)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        """SQLAlchemy + asyncpg dialect form derived from `database_url`."""
        if self.database_url.startswith("postgresql+asyncpg://"):
            return self.database_url
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace(
                "postgresql://", "postgresql+asyncpg://", 1
            )
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
