import "server-only";
import { z } from "zod";

/**
 * OpenRouter provider client (server-side only).
 *
 * - `streamChat` streams text deltas for the Dialogue Orchestrator.
 * - `generateStructured` requests schema-constrained JSON and validates it with Zod.
 *   The validated value is a *proposal*: callers must still pass it through the
 *   application's state-transition layer before anything touches the database.
 *
 * Environment:
 *   OPENROUTER_API_KEY                    required
 *   PATHWAYS_CHAT_MODEL                   default model for streamChat
 *   PATHWAYS_STRUCTURED_MODEL             default model for generateStructured
 *   PATHWAYS_CHAT_FALLBACK_MODELS         optional, comma-separated; replaces the default chat fallbacks
 *   PATHWAYS_STRUCTURED_FALLBACK_MODELS   optional, comma-separated; replaces the default structured fallbacks
 *
 * Fallbacks keep the conversation working when a model is down, rate limited, or misconfigured.
 * OpenRouter tries them on provider errors; an invalid model ID (which OpenRouter rejects before
 * routing) is retried here with the next model and logged so the setting gets fixed.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const APP_TITLE = "PATHWAYS";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface RequestOptions {
  /** Overrides the model from the environment. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string | number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly issues?: z.core.$ZodIssue[],
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new OpenRouterError(`Missing required environment variable ${name}`);
  return value;
}

const DEFAULT_FALLBACKS = {
  PATHWAYS_CHAT_MODEL: ["anthropic/claude-sonnet-5.5"],
  PATHWAYS_STRUCTURED_MODEL: ["anthropic/claude-haiku-4.5"],
} as const;

type ModelEnv = keyof typeof DEFAULT_FALLBACKS;

/** The configured model, then its fallbacks. An explicit override is used alone. */
export function resolveModels(override: string | undefined, envName: ModelEnv): string[] {
  if (override) return [override];
  const configured = process.env[envName]?.trim();
  const fallbackEnv = process.env[envName.replace("_MODEL", "_FALLBACK_MODELS")];
  const fallbacks = fallbackEnv ? fallbackEnv.split(",").map((m) => m.trim()) : [...DEFAULT_FALLBACKS[envName]];
  const models = [...new Set([configured, ...fallbacks].filter((m): m is string => !!m))];
  if (models.length === 0) throw new OpenRouterError(`Missing required environment variable ${envName}`);
  if (!configured) console.error(`[openrouter] ${envName} is not set; using fallback ${models[0]}`);
  return models;
}

function isInvalidModel(err: unknown): boolean {
  return err instanceof OpenRouterError && err.status === 400 && /not a valid model/i.test(err.message);
}

/** Posts with the model list, dropping a model OpenRouter rejects as invalid and retrying with the rest. */
async function postWithFallback(
  models: string[],
  body: (models: string[]) => Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  for (let i = 0; ; i++) {
    const remaining = models.slice(i);
    try {
      return await post(body(remaining), signal);
    } catch (err) {
      if (!isInvalidModel(err) || remaining.length < 2) throw err;
      console.error(`[openrouter] model "${remaining[0]}" was rejected (${(err as Error).message}); falling back to "${remaining[1]}"`);
    }
  }
}

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
      "X-Title": APP_TITLE,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let message = `OpenRouter request failed with status ${res.status}`;
    let code: string | number | undefined;
    try {
      const data = await res.json();
      if (data?.error?.message) message = data.error.message;
      code = data?.error?.code;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new OpenRouterError(message, res.status, code);
  }

  return res;
}

function baseBody(models: string[], messages: ChatMessage[], opts: RequestOptions) {
  return {
    model: models[0],
    ...(models.length > 1 && { models }),
    messages,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
  };
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string; code?: string | number };
}

/** Streams assistant text deltas as they arrive. */
export async function* streamChat(
  messages: ChatMessage[],
  opts: RequestOptions = {},
): AsyncGenerator<string, void, undefined> {
  const models = resolveModels(opts.model, "PATHWAYS_CHAT_MODEL");
  const res = await postWithFallback(models, (m) => ({ ...baseBody(m, messages, opts), stream: true }), opts.signal);
  if (!res.body) throw new OpenRouterError("OpenRouter returned an empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        // Blank lines separate events; lines starting with ":" are keep-alive comments.
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;

        const data = line.slice("data:".length).trim();
        if (data === "[DONE]") return;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        if (chunk.error) {
          throw new OpenRouterError(chunk.error.message ?? "OpenRouter stream error", undefined, chunk.error.code);
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Adapts a text stream into a `ReadableStream` suitable for a Route Handler `Response`. */
export function toReadableStream(source: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = source[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

export interface StructuredRequest<T extends z.ZodType> extends RequestOptions {
  messages: ChatMessage[];
  /** Zod schema the response must satisfy. Use `.nullable()` rather than `.optional()` for strict mode. */
  schema: T;
  /** Short identifier for the schema, e.g. "context_item_proposal". */
  name: string;
  description?: string;
}

function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text.trim();
}

/** A web page the model read through OpenRouter's web plugin, with the text it extracted. */
export interface UrlCitation {
  url: string;
  title: string | null;
  content: string;
}

/** OpenRouter web plugin settings. https://openrouter.ai/docs/guides/features/plugins/web-search */
export interface WebSearchOptions {
  maxResults: number;
  includeDomains: readonly string[];
}

/** Requests JSON conforming to `schema` and returns it validated. */
export async function generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
  return (await requestStructured(req)).data;
}

/**
 * Like `generateStructured`, but lets the model search the web (restricted to `web.includeDomains`)
 * and also returns the pages it read, so callers can verify every claim against real page text.
 */
export async function generateStructuredWithWeb<T extends z.ZodType>(
  req: StructuredRequest<T> & { web: WebSearchOptions },
): Promise<{ data: z.infer<T>; citations: UrlCitation[] }> {
  const { data, message } = await requestStructured(req, {
    plugins: [{ id: "web", engine: "exa", max_results: req.web.maxResults, include_domains: req.web.includeDomains }],
  });
  const annotations: unknown[] = Array.isArray(message?.annotations) ? message.annotations : [];
  const citations = annotations.flatMap((a) => {
    const c = (a as { type?: string; url_citation?: { url?: unknown; title?: unknown; content?: unknown } }).url_citation;
    return typeof c?.url === "string" && typeof c.content === "string"
      ? [{ url: c.url, title: typeof c.title === "string" ? c.title : null, content: c.content }]
      : [];
  });
  return { data, citations };
}

async function requestStructured<T extends z.ZodType>(
  req: StructuredRequest<T>,
  extra: Record<string, unknown> = {},
): Promise<{ data: z.infer<T>; message: { annotations?: unknown } | undefined }> {
  const models = resolveModels(req.model, "PATHWAYS_STRUCTURED_MODEL");
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;

  const res = await postWithFallback(
    models,
    (m) => ({
      ...baseBody(m, req.messages, req),
      ...extra,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: req.name,
          strict: true,
          schema: jsonSchema,
          ...(req.description && { description: req.description }),
        },
      },
      // Only route to providers that honor response_format.
      provider: { require_parameters: true },
    }),
    req.signal,
  );

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  const content: unknown = message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new StructuredOutputError("Model returned no content", JSON.stringify(data));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    throw new StructuredOutputError("Model output was not valid JSON", content);
  }

  const result = req.schema.safeParse(parsed);
  if (!result.success) {
    throw new StructuredOutputError("Model output did not match schema", content, result.error.issues);
  }
  return { data: result.data, message };
}
