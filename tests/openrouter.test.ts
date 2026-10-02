import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured, OpenRouterError, StructuredOutputError, streamChat } from "@/lib/ai/openrouter";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
  );
}

function jsonResponse(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.PATHWAYS_CHAT_MODEL = "chat-model";
  process.env.PATHWAYS_STRUCTURED_MODEL = "structured-model";
});

afterEach(() => vi.unstubAllGlobals());

async function collect(gen: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const d of gen) out += d;
  return out;
}

describe("streamChat", () => {
  it("yields deltas across split chunks and skips keep-alive comments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": OPENROUTER PROCESSING\n\n",
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"de',
          'lta":{"content":"lo"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );
    expect(await collect(streamChat([{ role: "user", content: "hi" }]))).toBe("Hello");
  });

  it("surfaces mid-stream errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(['data: {"error":{"message":"provider down","code":502}}\n\n'])),
    );
    await expect(collect(streamChat([{ role: "user", content: "hi" }]))).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("uses the chat model from the environment", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sseResponse(["data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamChat([{ role: "user", content: "hi" }]));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ model: "chat-model", stream: true });
  });
});

describe("generateStructured", () => {
  const schema = z.object({ answer: z.string() });

  it("sends a strict json_schema and returns validated data", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse('```json\n{"answer":"yes"}\n```'));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateStructured({ name: "t", schema, messages: [{ role: "user", content: "?" }] });
    expect(result).toEqual({ answer: "yes" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe("structured-model");
    expect(body.response_format.json_schema).toMatchObject({ name: "t", strict: true });
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("rejects output that does not match the schema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse('{"answer":42}')));
    await expect(
      generateStructured({ name: "t", schema, messages: [{ role: "user", content: "?" }] }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });
});
