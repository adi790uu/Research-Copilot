"""Async SQLAlchemy engine + sessionmaker.

The runtime does NOT manage schema — Alembic owns migrations. Startup just
verifies a connection can be opened; everything else is per-request session
management.

To create or update the schema, run:
    uv run alembic upgrade head
"""

from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            get_settings().sqlalchemy_url,
            echo=False,
            pool_pre_ping=True,
            # Disable asyncpg's per-connection prepared-statement cache. Keeps
            # us safe against schema changes that would otherwise strand stale
            # plans on pooled connections, and is required for Neon's pgbouncer
            # pooler. Cost is a tiny per-query plan; benefit is no
            # InvalidCachedStatementError surprises.
            connect_args={"statement_cache_size": 0},
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _sessionmaker


async def init_db() -> None:
    """Verify the database is reachable. Does NOT run DDL.

    Schema lives in Alembic — run `alembic upgrade head` to apply migrations.
    Calling this at startup gives a fast, clear failure if the DB is wrong
    before any request lands.
    """
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


async def dispose_db() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. One session per request; commit handled by the service."""
    async with get_sessionmaker()() as session:
        yield session
