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
    # Optional comma-separated key pool. When set, _create_model round-robins
    # across these per LLM call instead of using openai_api_key. Used to spread
    # load across many GitHub PATs against the Models API (which rate-limits
    # aggressively per token).
    openai_api_keys: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")
    openai_base_url: str = Field(default="")
    # Cooldown applied to a key after it returns 429, in seconds. The default
    # matches typical per-minute rate-limit windows.
    openai_key_cooldown_seconds: float = Field(default=60.0)
    tavily_api_key: str = Field(default="")

    # Auth — server-issued HS256 JWTs. `jwt_secret` MUST be set in any
    # non-dev environment; the default is intentionally bad so a missing
    # secret fails loudly in code review rather than silently in prod.
    jwt_secret: str = Field(default="dev-only-change-me")
    jwt_algorithm: str = Field(default="HS256")
    jwt_issuer: str = Field(default="research-copilot")
    jwt_expires_minutes: int = Field(default=60 * 24 * 14)  # 14 days

    # Canonical Postgres URL in psycopg form (postgresql://...).
    # The LangGraph checkpointer consumes this URL directly.
    # SQLAlchemy uses `sqlalchemy_url` (asyncpg driver) below.
    database_url: str = Field(
        default="postgresql://researchcopilot:researchcopilot@localhost:5432/research_copilot"
    )

    log_level: str = Field(default="INFO")
    cors_origins: str = Field(default="http://localhost:5173")

    workflow_search_results_per_query: int = Field(default=5)
    tavily_search_depth: str = Field(default="advanced")  # "basic" | "advanced"
    workflow_allow_clarification: bool = Field(default=True)
    workflow_max_concurrent_research_units: int = Field(default=5)
    workflow_max_researcher_iterations: int = Field(default=4)
    workflow_max_react_tool_calls: int = Field(default=8)
    workflow_auto_approve_plan: bool = Field(default=False)

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
