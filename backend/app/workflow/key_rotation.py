"""Round-robin pool of OpenAI-compatible API keys.

Built for the GitHub Models endpoint, where each PAT has a tight per-minute
rate limit but the workflow fans out many concurrent researcher calls. The
rotator gives each LLM call a fresh key; a key that returns 429 is cooled down
for `openai_key_cooldown_seconds` and skipped while cooled.

Design notes:
  * Async-safe — selection + cool-down are guarded by an asyncio.Lock.
  * Strict round-robin — next call always advances the index, even when the
    chosen key is then cooled. This avoids hot-spotting on key 0.
  * When every key is cooled, callers sleep until the soonest expiry.
  * Singleton via `get_rotator()` so the cooldown state survives between
    nodes and across concurrent researchers.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class _Lease:
    index: int
    key: str
    # Display id for logging — last 8 chars of the PAT, never the full key.
    short_id: str = field(init=False)

    def __post_init__(self) -> None:
        self.short_id = f"…{self.key[-8:]}" if len(self.key) > 8 else self.key


class KeyRotator:
    def __init__(self, keys: list[str], *, cooldown_s: float = 60.0) -> None:
        if not keys:
            raise ValueError("KeyRotator requires at least one key")
        self._keys = list(keys)
        self._cooldown_until: list[float] = [0.0] * len(keys)
        self._next_idx = 0
        self._lock = asyncio.Lock()
        self._cooldown_s = cooldown_s

    @property
    def size(self) -> int:
        return len(self._keys)

    async def acquire(self) -> _Lease:
        """Return the next non-cooled key. Sleeps if every key is cooled."""
        while True:
            async with self._lock:
                now = time.monotonic()
                n = len(self._keys)
                for _ in range(n):
                    idx = self._next_idx
                    self._next_idx = (self._next_idx + 1) % n
                    if self._cooldown_until[idx] <= now:
                        return _Lease(index=idx, key=self._keys[idx])
                # Every key is cooled — find the soonest expiry and wait outside
                # the lock so other coroutines can keep marking cooldowns.
                soonest = min(self._cooldown_until)
                wait_s = max(0.0, soonest - now)
            logger.warning("all %d keys cooled — sleeping %.1fs", n, wait_s)
            await asyncio.sleep(wait_s + 0.05)

    async def cool_down(self, lease: _Lease, *, seconds: float | None = None) -> None:
        duration = seconds if seconds is not None else self._cooldown_s
        async with self._lock:
            self._cooldown_until[lease.index] = time.monotonic() + duration
        logger.info("cooling key %s for %.1fs (idx=%d)", lease.short_id, duration, lease.index)


def _parse_keys(raw: str) -> list[str]:
    if not raw:
        return []
    # Allow either comma or newline as separator so a multi-line .env value works.
    parts = (p.strip() for p in raw.replace("\n", ",").split(","))
    return [p for p in parts if p]


_rotator: KeyRotator | None = None
_rotator_loaded = False


def get_rotator() -> KeyRotator | None:
    """Return the process-wide rotator, or None when only a single key is set."""
    global _rotator, _rotator_loaded
    if _rotator_loaded:
        return _rotator
    settings = get_settings()
    pool = _parse_keys(settings.openai_api_keys)
    if pool:
        _rotator = KeyRotator(pool, cooldown_s=settings.openai_key_cooldown_seconds)
        logger.info("key rotator initialised with %d keys", _rotator.size)
    _rotator_loaded = True
    return _rotator


def reset_rotator_for_tests() -> None:
    """Clear the singleton so tests can re-load with different env."""
    global _rotator, _rotator_loaded
    _rotator = None
    _rotator_loaded = False
