import type { UserAction } from "@/lib/validation/state-guard";
import type { ChatEvent, PanelsResponse } from "@/lib/workspace/events";

export interface ChatRequest {
  message: string;
  pathwayId: string;
  /** The message was spoken; the reply also gets a short line to speak back. */
  voice?: boolean;
}

/** Posts a chat turn and calls `onEvent` for each NDJSON line as it arrives. */
export async function streamChatTurn(
  body: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "The conversation couldn't continue. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent);
}

export async function postWorkspaceActions(pathwayId: string, actions: UserAction[]): Promise<PanelsResponse> {
  const res = await fetch("/api/workspace/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathwayId, actions }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That change couldn't be saved.");
  return data as PanelsResponse;
}

export async function createHandoffLink(
  pathwayId: string,
  place: { query: string; label?: string | null } | null,
): Promise<{ url: string; expiresAt: string }> {
  const res = await fetch("/api/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathwayId, place }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Couldn't create a link.");
  return data;
}
