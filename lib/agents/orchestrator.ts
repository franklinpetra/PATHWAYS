import "server-only";
import { z } from "zod";
import { generateStructured, streamChat, type ChatMessage } from "@/lib/ai/openrouter";
import { applyMutations } from "@/lib/db/mutations";
import { listLiveContextItems, listMessages, loadGuardState } from "@/lib/db/queries";
import { WIN_EVENT_TYPES, type Action, type ContextItem, type Pathway, type ReadinessState } from "@/lib/db/types";
import {
  guardMemoryProposals,
  guardMessage,
  guardStepProposals,
  guardWinCandidates,
  isVisibleStep,
  type GuardResult,
  type GuardState,
  type Rejection,
  type UserAction,
  type WinCandidate,
} from "@/lib/validation/state-guard";
import { formatAttribution, traceClaims } from "@/lib/workspace/attribution";
import type { ChatEvent } from "@/lib/workspace/events";
import { applyUserActions, loadPanels } from "@/lib/workspace/service";
import { sanitizeTopics } from "@/lib/workspace/topics";
import { proposeContextMutations } from "./memory";
import { findFacts, type FactFindings } from "./retrieval";

/**
 * Dialogue Orchestrator.
 *
 * Runs one turn of the invisible pipeline:
 *   1. Apply explicit user actions (adopt / complete a step, save an interest, confirm a goal, record a win).
 *   2. Memory Agent and Fact-Finder run in parallel; memory proposals pass through the state guard.
 *   3. Stream a reply grounded in current context and sourced facts.
 *   4. Emit verified places cited in the reply, then extract candidate Next Steps (persisted as
 *      'suggested'), candidate Wins (returned, not persisted), and suggested follow-up topics.
 *   5. Emit the refreshed Next Steps and Recent Wins.
 * The person sees one conversation; none of the agents are named to them.
 */

export type { ChatEvent };

export interface TurnInput {
  userId: string;
  message: string | null;
  pathwayId: string | null;
  userActions: UserAction[];
  signal?: AbortSignal;
}

/** Messages of prior conversation sent with each reply. */
const HISTORY_TURNS = 12;
/** Messages of prior conversation the Memory Agent reads for context. */
const MEMORY_TURNS = 6;

export async function runTurn(input: TurnInput, emit: (event: ChatEvent) => void): Promise<void> {
  let state = await loadGuardState(input.userId);
  const pathway = input.pathwayId ? (state.pathways.find((p) => p.id === input.pathwayId) ?? null) : null;
  if (input.pathwayId && !pathway) {
    emit({ type: "error", message: "That pathway could not be found." });
    return;
  }

  if (input.userActions.length > 0) {
    await applyUserActions(input.userId, input.userActions);
    state = await loadGuardState(input.userId);
  }

  let winCandidates: WinCandidate[] = [];
  if (input.message) {
    winCandidates = await converse(input, input.message, state, pathway, emit);
  }

  const { nextSteps, recentWins } = await loadPanels(input.userId, pathway?.id ?? null);
  emit({ type: "next_steps", items: nextSteps });
  emit({ type: "wins", recent: recentWins, candidates: winCandidates });
  emit({ type: "done" });
}

async function converse(
  input: TurnInput,
  message: string,
  state: GuardState,
  pathway: Pathway | null,
  emit: (event: ChatEvent) => void,
): Promise<WinCandidate[]> {
  const pathwayId = pathway?.id ?? null;
  // History comes from the stored transcript, never from the client.
  const history: ChatMessage[] = (await listMessages(state.userId, pathwayId, HISTORY_TURNS)).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  await applyMutations(acceptedOrThrow(guardMessage(state, { role: "user", content: message, pathwayId })));

  const [memory, facts] = await Promise.allSettled([
    proposeContextMutations({
      userMessage: message,
      recentMessages: history.slice(-MEMORY_TURNS),
      contextItems: state.contextItems,
      signal: input.signal,
    }),
    findFacts({ userMessage: message, contextItems: state.contextItems, signal: input.signal }),
  ]);

  // Memory: validated proposals are committed before the reply, so the reply sees current context.
  if (memory.status === "fulfilled") {
    const committed = await commitQuietly("memory", guardMemoryProposals(state, message, memory.value));
    if (committed) state = { ...state, contextItems: await listLiveContextItems(state.userId) };
  } else {
    console.error("[orchestrator] memory agent failed", memory.reason);
  }

  let findings: FactFindings;
  if (facts.status === "fulfilled") {
    findings = facts.value;
  } else {
    console.error("[orchestrator] fact-finder failed", facts.reason);
    findings = { params: null, claims: [], notes: ["Source lookup was unavailable for this message."] };
  }

  const now = new Date();
  const openSteps = pathway ? state.actions.filter((a) => a.pathway_id === pathway.id && isVisibleStep(a, now)) : [];

  const prompt = buildSystemPrompt({ contextItems: state.contextItems, pathway, openSteps, findings });
  let reply = "";
  try {
    for await (const delta of streamChat(
      [{ role: "system", content: prompt }, ...history, { role: "user", content: message }],
      { temperature: 0.6, signal: input.signal },
    )) {
      reply += delta;
      emit({ type: "text", delta });
    }
  } catch (err) {
    // Keep whatever the person already saw, with the sources it cited.
    if (reply.trim()) {
      const { citations, places } = traceClaims(reply, findings.claims);
      await commitQuietly(
        "interrupted reply",
        guardMessage(state, { role: "assistant", content: reply, pathwayId, status: "interrupted", citations, places }),
      );
    }
    throw err;
  }

  const { citations, places } = traceClaims(reply, findings.claims);
  if (citations.length > 0) emit({ type: "citations", items: citations });
  if (places.length > 0) emit({ type: "places", items: places });
  if (reply.trim()) {
    await commitQuietly("reply", guardMessage(state, { role: "assistant", content: reply, pathwayId, places, citations }));
  }

  if (!pathway || !reply.trim()) return [];

  try {
    const proposals = await proposeCandidates({ message, reply, pathway, openSteps, signal: input.signal });
    const topics = sanitizeTopics(proposals.topics);
    if (topics.length > 0) emit({ type: "topics", items: topics });
    await commitQuietly(
      "next steps",
      guardStepProposals(
        state,
        proposals.next_steps.map((s) => ({ ...s, pathway_id: pathway.id })),
      ),
    );
    const wins = guardWinCandidates(
      state,
      proposals.wins.map((w) => ({ ...w, pathway_id: pathway.id })),
    );
    logRejections("win candidate", wins.rejections);
    return wins.candidates;
  } catch (err) {
    console.error("[orchestrator] candidate extraction failed", err);
    return [];
  }
}

function acceptedOrThrow(result: GuardResult) {
  if (result.rejections.length > 0) throw new Error(`State guard rejected: ${result.rejections[0].reason}`);
  return result.mutations;
}

/** Applies guard output; a failure here degrades the turn rather than ending it. */
async function commitQuietly(label: string, result: GuardResult): Promise<boolean> {
  logRejections(label, result.rejections);
  if (result.mutations.length === 0) return false;
  try {
    await applyMutations(result.mutations);
    return true;
  } catch (err) {
    console.error(`[orchestrator] failed to apply ${label} mutations`, err);
    return false;
  }
}

function logRejections(label: string, rejections: Rejection[]) {
  for (const r of rejections) console.warn(`[state-guard] ${label} rejected: ${r.proposal} (${r.reason})`);
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const READINESS_GUIDANCE: Record<ReadinessState, string> = {
  exploring: "They are exploring. Widen the view, surface options, and help them notice what draws them.",
  evaluating: "They are evaluating. Help them compare options against what matters to them.",
  acting: "They are acting. Be concrete and practical about the next move.",
  returning: "They are returning after time away. Briefly re-orient them before moving forward.",
};

const BASE_PROMPT = `You are Pathways, a thinking partner for a person exploring education and career pathways in Washington State.

How to respond
- Be direct and scannable: lead with the answer, then a few short bullets at most. No preamble.
- Speak to an adult making their own decisions. Never use deficit-based or juvenile language, and don't call them a student unless they do.
- You organize, compare, draft, and scaffold; the person decides. Offer options, not verdicts.
- Ask at most one question, and only when it would move things forward.
- Never mention internal systems, records, or agents, and never say you saved or noted something.

Facts
- State program, apprenticeship, occupation, deadline, eligibility, cost, completion, wage, or availability details only if they appear under "Verified sources". Put its [n] right after each such detail. The person sees the full source, period, and authority for every [n], so don't repeat them or invent your own citations.
- If something isn't in Verified sources, say you don't have verified information and suggest who would know, without inventing specifics.
- Never invent deadlines, eligibility rules, wage figures, or seat counts.

What you know about the person
- Their latest message always overrides anything recorded below.
- Items marked "unconfirmed" are earlier inferences. Hold them lightly and never present them as the person's words.`;

function buildSystemPrompt(args: {
  contextItems: ContextItem[];
  pathway: Pathway | null;
  openSteps: Action[];
  findings: FactFindings;
}): string {
  const sections = [BASE_PROMPT];

  if (args.pathway) {
    const p = args.pathway;
    sections.push(
      [
        `Current pathway: ${p.title}`,
        READINESS_GUIDANCE[p.readiness_state],
        p.why_considered ? `Why they are considering it: ${p.why_considered}` : null,
        p.current_question ? `Their open question: ${p.current_question}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (args.openSteps.length > 0) {
    sections.push(
      `Open next steps:\n${args.openSteps
        .map((s) => `- ${s.title} (${s.status === "user_selected" ? "they chose this" : "suggested"})`)
        .join("\n")}`,
    );
  }

  const context = args.contextItems.map((item) => {
    const flags = [
      item.provenance === "ai_inferred" ? "unconfirmed" : null,
      item.temporal_status === "stale" ? "may be out of date" : null,
      item.semantic_status === "confirmed_goal" ? "their confirmed goal" : null,
      item.semantic_status === "saved_interest" ? "saved interest" : null,
    ].filter(Boolean);
    return `- ${item.display_text}${flags.length ? ` (${flags.join("; ")})` : ""}`;
  });
  sections.push(`Known context:\n${context.length ? context.join("\n") : "(nothing yet)"}`);

  const sources = args.findings.claims.map(
    (c, i) => `[${i + 1}] ${c.statement} ${formatAttribution(c.source)}`,
  );
  sections.push(`Verified sources:\n${sources.length ? sources.join("\n") : "(none for this message)"}`);
  if (args.findings.notes.length > 0) {
    sections.push(`Search notes:\n${args.findings.notes.map((n) => `- ${n}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Candidate Next Steps and Wins
// ---------------------------------------------------------------------------

const candidatesSchema = z.object({
  next_steps: z.array(
    z.object({
      title: z.string().describe("Short imperative, e.g. 'Email the nursing program advisor'."),
      why: z.string().nullable().describe("One sentence tying the step to what the person said matters."),
      how: z.string().nullable().describe("One or two practical sentences. No invented dates or requirements."),
    }),
  ),
  wins: z.array(
    z.object({
      event_type: z.enum(WIN_EVENT_TYPES),
      title: z.string().describe("Past tense, e.g. 'Talked with a working electrician'."),
      learning: z.string().nullable().describe("What they learned, in their terms, if they said."),
    }),
  ),
  topics: z
    .array(z.string())
    .describe("2-3 follow-up topics the person might raise next, in their voice, under 8 words each."),
});

const CANDIDATES_PROMPT = `You review one exchange between a person and their pathway thinking partner and pull out structured items. You never speak to the person.

next_steps: concrete actions the reply proposed or the person said they intend to take. At most 3. Each must be small, specific, and doable within about two weeks. Skip anything that duplicates an open step. Return none if the exchange did not point to an action.

wins: only things the person says they have already done that move this pathway forward: submitting an application, talking with someone in the field, contacting a program, attending an event, preparing a document, finishing research, or making a decision. Using this app, logging in, or chatting is never a win. Return none if nothing qualifies.

topics: 2-3 natural follow-ups the person might want to explore next, phrased as they would say them (e.g. "What does the first year cost?"). Never repeat what was just answered.`;

async function proposeCandidates(args: {
  message: string;
  reply: string;
  pathway: Pathway;
  openSteps: Action[];
  signal?: AbortSignal;
}) {
  return generateStructured({
    name: "turn_candidates",
    schema: candidatesSchema,
    temperature: 0,
    signal: args.signal,
    messages: [
      { role: "system", content: CANDIDATES_PROMPT },
      {
        role: "user",
        content: [
          `Pathway: ${args.pathway.title}`,
          `Open steps:\n${args.openSteps.map((s) => `- ${s.title}`).join("\n") || "(none)"}`,
          `Person:\n${args.message}`,
          `Reply:\n${args.reply}`,
        ].join("\n\n"),
      },
    ],
  });
}
