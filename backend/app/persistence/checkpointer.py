"""Postgres-backed LangGraph checkpointer.

The async saver from `langgraph-checkpoint-postgres` owns its own psycopg pool;
it doesn't share SQLAlchemy's asyncpg engine. We open the pool once at FastAPI
startup, run `setup()` to create the checkpoint tables if missing, and dispose
on shutdown.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from app.core.config import get_settings


def _normalize_url(url: str) -> str:
    """psycopg accepts `postgresql://` directly — strip any asyncpg dialect prefix."""
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


@asynccontextmanager
async def checkpointer_lifespan() -> AsyncIterator[AsyncPostgresSaver]:
    settings = get_settings()
    url = _normalize_url(settings.database_url)
    async with AsyncPostgresSaver.from_conn_string(url) as saver:
        await saver.setup()
        yield saver
