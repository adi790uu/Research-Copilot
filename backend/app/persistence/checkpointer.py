"""Postgres-backed LangGraph checkpointer.

`AsyncPostgresSaver.from_conn_string` holds a single long-lived psycopg
connection, which strands the whole checkpointer when the server drops it
(Neon idle-recycles, autosuspends, or a network blip). Instead we back the
saver with an `AsyncConnectionPool` that checks connection liveness on checkout
and recycles idle/old connections, so a dropped connection is transparently
replaced rather than breaking every subsequent run until a restart.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

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
    async with AsyncConnectionPool(
        conninfo=url,
        min_size=0,
        max_size=10,
        open=False,
        check=AsyncConnectionPool.check_connection,
        max_idle=30.0,
        max_lifetime=240.0,
        # Required by the saver; prepare_threshold=0 keeps us compatible with
        # Neon's transaction pooler (no server-side prepared statements).
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    ) as pool:
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
        yield saver
