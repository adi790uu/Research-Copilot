// Minimal Server-Sent Events reader for our streaming endpoints. The backend
// emits `event: token` (partial text), `event: done`, and `event: error`
// frames separated by blank lines; multi-line payloads arrive as repeated
// `data:` lines that we rejoin with newlines (per the SSE spec).

import type { WorkflowEvent } from "./types";

export interface SSEHandlers {
  onToken: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

function parseFrame(raw: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // Strip exactly one leading space after the colon, per spec.
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return { event, data: dataLines.join("\n") };
}

/** Read an SSE Response to completion, dispatching frames to `handlers`.
 * Resolves when the stream ends (or a `done`/`error` frame arrives). */
export async function readSSE(response: Response, handlers: SSEHandlers): Promise<void> {
  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // ignore — fall back to status
    }
    handlers.onError?.(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const { event, data } = parseFrame(frame);
        if (event === "token") {
          handlers.onToken(data);
        } else if (event === "done") {
          handlers.onDone?.();
          return;
        } else if (event === "error") {
          handlers.onError?.(data);
          return;
        }
      }
    }
    handlers.onDone?.();
  } finally {
    reader.releaseLock();
  }
}

/** Read the phase-1 workflow SSE stream (`POST /briefs/{id}/chat`). Each frame's
 * `data:` payload is a JSON-encoded `WorkflowEvent` (the `event:` name mirrors
 * `ev.type`). Dispatches every parsed event to `onEvent`; resolves when the
 * stream ends. Non-ok responses surface as a synthetic `run_failed` event. */
export async function readWorkflowSSE(
  response: Response,
  onEvent: (ev: WorkflowEvent) => void,
): Promise<void> {
  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // ignore — fall back to status
    }
    onEvent({ type: "run_failed", brief_id: "", at: "", message } as WorkflowEvent);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const { data } = parseFrame(frame);
        if (!data) continue;
        try {
          onEvent(JSON.parse(data) as WorkflowEvent);
        } catch {
          // ignore malformed frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
