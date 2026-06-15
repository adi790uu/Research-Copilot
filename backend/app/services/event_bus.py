"""In-process pub/sub for workflow events.

One bus instance lives on `app.state` for the lifetime of the process. Each
in-flight session has:
  * a retained log so reconnects can replay everything that's happened so far,
  * a list of subscriber queues that receive new events live.

Single-process only — fine for the assignment. A multi-instance deployment
would swap this for Redis pub/sub or Postgres LISTEN/NOTIFY without changing
the call sites.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict
from dataclasses import dataclass, field

from app.domain.events import TERMINAL_EVENT_TYPES, WorkflowEvent


@dataclass
class _Channel:
    log: list[WorkflowEvent] = field(default_factory=list)
    subscribers: list[asyncio.Queue[WorkflowEvent | None]] = field(default_factory=list)
    terminated: bool = False


class WorkflowEventBus:
    def __init__(self) -> None:
        self._channels: dict[str, _Channel] = defaultdict(_Channel)
        self._lock = asyncio.Lock()

    async def publish(self, event: WorkflowEvent) -> None:
        async with self._lock:
            ch = self._channels[event.session_id]
            ch.log.append(event)
            for q in ch.subscribers:
                q.put_nowait(event)
            if event.type in TERMINAL_EVENT_TYPES:
                ch.terminated = True
                for q in ch.subscribers:
                    # Sentinel tells the SSE reader the stream is done.
                    q.put_nowait(None)

    async def subscribe(
        self, session_id: str
    ) -> tuple[list[WorkflowEvent], asyncio.Queue[WorkflowEvent | None], bool]:
        """Returns (replay, queue, already_terminated).

        Caller should yield each replay event first, then drain `queue` until it
        sees `None` (terminal sentinel) or the client disconnects. If
        `already_terminated` is True, the run finished before the subscriber
        joined — replay is the whole story; the queue will only ever yield
        `None` and is included for symmetry.
        """
        async with self._lock:
            ch = self._channels[session_id]
            q: asyncio.Queue[WorkflowEvent | None] = asyncio.Queue()
            if ch.terminated:
                q.put_nowait(None)
            else:
                ch.subscribers.append(q)
            return list(ch.log), q, ch.terminated

    async def unsubscribe(
        self, session_id: str, queue: asyncio.Queue[WorkflowEvent | None]
    ) -> None:
        async with self._lock:
            ch = self._channels.get(session_id)
            if ch is None:
                return
            with contextlib.suppress(ValueError):
                ch.subscribers.remove(queue)

    async def reset(self, session_id: str) -> None:
        """Drop retained state for a session so a re-run starts clean."""
        async with self._lock:
            ch = self._channels.get(session_id)
            if ch is None:
                return
            # Wake any lingering subscribers from the previous run.
            for q in ch.subscribers:
                q.put_nowait(None)
            self._channels.pop(session_id, None)
