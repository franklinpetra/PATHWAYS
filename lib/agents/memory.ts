import "server-only";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/openrouter";
import { CONTEXT_ITEM_TYPES, type ContextItem } from "@/lib/db/types";
import type { ContextCreateProposal, ContextStaleProposal } from "@/lib/validation/state-guard";

/**
 * Memory & State Agent.
 *
 * Reads one conversation turn against the person's live context and proposes
 * changes to the Conversational Mastery Record. It never writes: its output goes
 * to the state guard, which decides what is allowed.
 */

const memoryOutputSchema = z.object({
  creates: z.array(
    z.object({
      type: z.enum(CONTEXT_ITEM_TYPES),
      user_language: z
        .string()
        .nullable()
        .describe("Exact words from the person's latest message, copied verbatim. Null if this is your inference."),
      display_text: z.string().describe("Short, neutral, second-person summary, e.g. 'You work evenings until 9pm.'"),
      provenance: z.enum(["user_authored", "ai_inferred"]),
      semantic_status: z.enum(["thought", "inference", "possibility", "confirmed_context"]),
      confidence: z.number().nullable().describe("0 to 1 for inferences; null for the person's own statements."),
      supersedes: z.array(z.string()).describe("Refs (e.g. 'c3') of existing items this replaces."),
    }),
  ),
  stale: z.array(
    z.object({
      ref: z.string().describe("Ref of an existing item that is likely out of date."),
      reason: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You maintain a private record of what a person has shared while exploring education and career pathways. You never speak to the person.

Given their latest message and their existing context items, propose changes:

1. creates: new, durable facts about the person — goals, interests, constraints, preferences, circumstances, experience, strengths, concerns, open questions.
   - If the person said it, set provenance "user_authored" and copy their exact words into user_language. Use "thought", "possibility", or "confirmed_context" (a plain statement of fact about themselves).
   - If you are reading between the lines, set provenance "ai_inferred", user_language null, semantic_status "inference" or "possibility", and give a confidence.
   - Do not repeat anything already recorded. Skip small talk and anything about the assistant.
   - Write display_text in plain, respectful language. Never use deficit framing or label the person.

2. Corrections: when the latest message changes or contradicts an existing item (a new schedule, a changed location, a dropped interest), create the new item and list the old item's ref in supersedes. The latest statement always wins.

3. stale: existing items that are probably out of date but not directly contradicted.

Return empty arrays when nothing changes. Most turns change little.`;

export interface MemoryInput {
  userMessage: string;
  priorAssistantMessage: string | null;
  contextItems: ContextItem[];
  signal?: AbortSignal;
}

export interface MemoryProposals {
  creates: ContextCreateProposal[];
  stale: ContextStaleProposal[];
}

export async function proposeContextMutations(input: MemoryInput): Promise<MemoryProposals> {
  // Short refs are easier for the model to copy than UUIDs; map them back afterwards.
  const refs = new Map(input.contextItems.map((item, i) => [`c${i + 1}`, item.id]));
  const resolve = (ref: string) => refs.get(ref) ?? ref;

  const existing = input.contextItems.length
    ? input.contextItems
        .map(
          (item, i) =>
            `c${i + 1} [${item.type}; ${item.semantic_status}; ${item.provenance}; ${item.temporal_status}] ${item.display_text}`,
        )
        .join("\n")
    : "(none)";

  const output = await generateStructured({
    name: "context_mutations",
    schema: memoryOutputSchema,
    temperature: 0,
    signal: input.signal,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Existing context items:\n${existing}`,
          input.priorAssistantMessage ? `Assistant's previous message:\n${input.priorAssistantMessage}` : null,
          `Person's latest message:\n${input.userMessage}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  return {
    creates: output.creates.map((c) => ({ ...c, supersedes: c.supersedes.map(resolve) })),
    stale: output.stale.map((s) => ({ id: resolve(s.ref), reason: s.reason })),
  };
}
