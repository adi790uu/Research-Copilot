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

    workflow_allow_clarification: bool = Field(default=True)

    # External TypeScript deep-research worker (Trigger.dev). When
    # `trigger_secret_key` is unset, plan approval still creates the job row
    # but skips dispatch (e.g. local dev before the worker is deployed).
    trigger_api_url: str = Field(default="https://api.trigger.dev")
    trigger_secret_key: str = Field(default="")
    trigger_task_id: str = Field(default="deep-research")

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
