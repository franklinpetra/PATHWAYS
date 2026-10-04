import "server-only";
import { z } from "zod";
import { generateStructured, streamChat, type ChatMessage } from "@/lib/ai/openrouter";
import { applyMutations } from "@/lib/db/mutations";
import { getRoute, listLiveContextItems, listMessages, loadGuardState } from "@/lib/db/queries";
import { WIN_EVENT_TYPES, type Action, type Pathway } from "@/lib/db/types";
import {
  guardMemoryProposals,
  guardMessage,
  guardRouteProposal,
  guardStepProposals,
  guardWinCandidates,
  isVisibleStep,
  type GuardResult,
  type GuardState,
  type Rejection,
  type UserAction,
  type WinCandidate,
} from "@/lib/validation/state-guard";
import { traceClaims } from "@/lib/workspace/attribution";
import type { ChatEvent } from "@/lib/workspace/events";
import { applyUserActions, loadPanels } from "@/lib/workspace/service";
import { sanitizeTopics } from "@/lib/workspace/topics";
import { findUnsupportedFigures } from "./grounding";
import { proposeContextMutations } from "./memory";
import { buildSystemPrompt } from "./prompt";
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
    findings = { params: null, claims: [], notes: ["No Tier 1 sources for this message. Answer from Tier 2 knowledge and mark figures to confirm."] };
  }

  const now = new Date();
  const openSteps = pathway ? state.actions.filter((a) => a.pathway_id === pathway.id && isVisibleStep(a, now)) : [];

  const prompt = buildSystemPrompt({ contextItems: state.contextItems, pathway, openSteps, findings });
  // Figures the person supplied may be echoed back; anything else must come from a verified claim.
  const personText = [
    message,
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    ...state.contextItems.flatMap((i) => [i.display_text, i.user_language ?? ""]),
  ];
  const check = (text: string) => ({
    ...traceClaims(text, findings.claims),
    unverifiedFigures: findUnsupportedFigures(text, findings.claims, personText),
  });
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
      const { citations, places, unverifiedFigures } = check(reply);
      await commitQuietly(
        "interrupted reply",
        guardMessage(state, {
          role: "assistant",
          content: reply,
          pathwayId,
          status: "interrupted",
          citations,
          places,
          unverifiedFigures,
        }),
      );
    }
    throw err;
  }

  const { citations, places, unverifiedFigures } = check(reply);
  if (citations.length > 0) emit({ type: "citations", items: citations });
  if (places.length > 0) emit({ type: "places", items: places });
  if (unverifiedFigures.length > 0) {
    console.warn(`[grounding] reply contained unverified figures: ${unverifiedFigures.join(", ")}`);
    emit({ type: "grounding", unverifiedFigures });
  }
  if (reply.trim()) {
    await commitQuietly(
      "reply",
      guardMessage(state, { role: "assistant", content: reply, pathwayId, places, citations, unverifiedFigures }),
    );
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
    const route = guardRouteProposal(
      state,
      pathway.id,
      proposals.route,
      findings.claims.map((c) => ({ statement: c.statement, source: c.source })),
    );
    if (await commitQuietly("route", route)) emit({ type: "route", route: await getRoute(pathway.id) });
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
  route: z
    .array(
      z.object({
        label: z.string().describe("Two to four words, e.g. 'Bookkeeping experience', 'Pharmacy technician'."),
        pay: z.string().nullable().describe("A pay figure exactly as the reply stated it for this stop, e.g. '$21.00/hr'. Null if none."),
        pay_source_number: z.number().nullable().describe("The [n] the reply cited for that pay figure. Null if no pay."),
        gate_before: z.string().nullable().describe("The main requirement to reach this stop, one or two words, e.g. 'Exam', 'License'. Null if none or for the first stop."),
      }),
    )
    .nullable()
    .describe("The person's path as 2-5 stops, or null if the exchange doesn't make a path clear."),
});

const CANDIDATES_PROMPT = `You review one exchange between a person and their pathway thinking partner and pull out structured items. You never speak to the person.

next_steps: concrete actions the reply proposed or the person said they intend to take. At most 3. Each must be small, specific, and doable within about two weeks, and must name an employer, role, program, credential, registry, office, or form. Never generic networking, job-board, or resume steps; resume steps only for a named target role and a specific change. Skip anything that duplicates an open step. Return none if the exchange did not point to an action.

wins: only things the person says they have already done that move this pathway forward: submitting an application, talking with someone in the field, contacting a program, attending an event, preparing a document, finishing research, or making a decision. Using this app, logging in, or chatting is never a win. Return none if nothing qualifies.

topics: 2-3 natural follow-ups the person might want to explore next, phrased as they would say them (e.g. "What does the first year cost?"). Never repeat what was just answered.

route: the person's path as 2-5 stops, only when the exchange makes a path toward their goal clear. The first stop is where they stand today, in their own terms (e.g. "Art degree", "Bookkeeping experience", "Home after 5 years"); the last is the goal they named or the reply recommended; any middle stops are the rungs the reply laid out. Give a pay figure for a stop only if the reply states one for it with a [n] citation, copied exactly, with that n. gate_before names the main requirement between the previous stop and this one (e.g. "Exam", "License", "Credential review", "Apprenticeship"). Return null if no clear path was discussed.`;

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
