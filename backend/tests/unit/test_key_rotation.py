"""Unit tests for the API-key rotator."""

from __future__ import annotations

import asyncio

import pytest

from app.workflow.key_rotation import KeyRotator


async def test_round_robin_advances_index() -> None:
    rotator = KeyRotator(["a", "b", "c"])
    leases = [await rotator.acquire() for _ in range(6)]
    assert [leases[i].key for i in range(6)] == ["a", "b", "c", "a", "b", "c"]


async def test_cool_down_skips_key_until_expiry() -> None:
    rotator = KeyRotator(["a", "b", "c"], cooldown_s=0.05)
    first = await rotator.acquire()
    assert first.key == "a"
    await rotator.cool_down(first)

    # next call must skip 'a' until cooldown expires
    second = await rotator.acquire()
    assert second.key == "b"
    third = await rotator.acquire()
    assert third.key == "c"
    fourth = await rotator.acquire()
    # 'a' is still cooled at this exact moment; expect 'b' (round robin)
    assert fourth.key == "b"

    await asyncio.sleep(0.07)
    # cooldown elapsed → 'a' rejoins the rotation on the next round
    fifth = await rotator.acquire()
    assert fifth.key in {"a", "c"}  # whichever index we land on first
    sixth = await rotator.acquire()
    assert sixth.key in {"a", "c"}
    assert {fifth.key, sixth.key} == {"a", "c"}


async def test_all_cooled_sleeps_until_one_recovers() -> None:
    rotator = KeyRotator(["a", "b"], cooldown_s=0.05)
    for _ in range(2):
        lease = await rotator.acquire()
        await rotator.cool_down(lease)

    loop = asyncio.get_event_loop()
    started = loop.time()
    lease = await rotator.acquire()  # must block ~50ms then return
    elapsed = loop.time() - started
    assert elapsed >= 0.04
    assert lease.key in {"a", "b"}


async def test_short_id_redacts_the_key() -> None:
    rotator = KeyRotator(["github_pat_1234567890_abcdefgh"])
    lease = await rotator.acquire()
    assert lease.short_id == "…abcdefgh"
    assert "github_pat" not in lease.short_id


def test_empty_pool_raises() -> None:
    with pytest.raises(ValueError):
        KeyRotator([])
