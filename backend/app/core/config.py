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
    # Small/cheap model for lightweight tasks like chat-title generation.
    openai_title_model: str = Field(default="gpt-5-nano")
    openai_base_url: str = Field(default="")

    jwt_secret: str = Field(default="dev-only-change-me")
    jwt_algorithm: str = Field(default="HS256")
    jwt_issuer: str = Field(default="research-copilot")
    jwt_expires_minutes: int = Field(default=60 * 24 * 14)

    database_url: str = Field(
        default="postgresql://researchcopilot:researchcopilot@localhost:5432/research_copilot"
    )

    log_level: str = Field(default="INFO")
    cors_origins: str = Field(default="http://localhost:5173")

    workflow_allow_clarification: bool = Field(default=True)

    trigger_api_url: str = Field(default="https://api.trigger.dev")
    trigger_secret_key: str = Field(default="")
    trigger_task_id: str = Field(default="deep-research")

    pdl_api_key: str = Field(default="")
    pdl_min_likelihood: int = Field(default=6)

    frontend_base_url: str = Field(default="http://localhost:5173")

    hubspot_access_token: str = Field(default="")
    hubspot_pipeline_id: str = Field(default="")
    hubspot_deal_stage_id: str = Field(default="")
    hubspot_poll_interval_seconds: int = Field(default=300)
    hubspot_owner_email: str = Field(default="")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url.startswith("postgresql+asyncpg://"):
            return self.database_url
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
