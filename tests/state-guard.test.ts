import { describe, expect, it } from "vitest";
import type { Action, ContextItem, Pathway } from "@/lib/db/types";
import {
  guardMemoryProposals,
  guardStepProposals,
  guardUserActions,
  guardWinCandidates,
  type ContextCreateProposal,
  type GuardState,
} from "@/lib/validation/state-guard";

const USER = "00000000-0000-4000-8000-000000000001";
const PATHWAY = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PATHWAY = "00000000-0000-4000-8000-0000000000ff";

function item(overrides: Partial<ContextItem> & { id: string }): ContextItem {
  return {
    user_id: USER,
    type: "circumstance",
    user_language: null,
    display_text: "Something",
    provenance: "user_authored",
    semantic_status: "confirmed_context",
    temporal_status: "current",
    confidence: null,
    superseded_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function step(overrides: Partial<Action> & { id: string }): Action {
  return {
    pathway_id: PATHWAY,
    title: "A step",
    why: null,
    how: null,
    due_at: null,
    status: "suggested",
    display_order: 0,
    created_by: "system",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const pathway: Pathway = {
  id: PATHWAY,
  user_id: USER,
  title: "Registered nursing",
  canonical_destination_id: null,
  destination_type: null,
  readiness_state: "exploring",
  status: "active",
  current_question: null,
  why_considered: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function state(overrides: Partial<GuardState> = {}): GuardState {
  return { userId: USER, contextItems: [], pathways: [pathway], actions: [], ...overrides };
}

function create(overrides: Partial<ContextCreateProposal>): ContextCreateProposal {
  return {
    type: "circumstance",
    user_language: null,
    display_text: "You work evenings.",
    provenance: "ai_inferred",
    semantic_status: "inference",
    confidence: 0.6,
    supersedes: [],
    ...overrides,
  };
}

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-1000000000${String(++n).padStart(2, "0")}`;
};

describe("memory proposals", () => {
  it("keeps a verbatim user statement as user_authored", () => {
    const r = guardMemoryProposals(state(), "I work nights at the hospital now.", {
      creates: [
        create({
          provenance: "user_authored",
          semantic_status: "confirmed_context",
          user_language: "I work nights at the hospital",
          display_text: "You work nights at the hospital.",
        }),
      ],
      stale: [],
    });
    expect(r.rejections).toEqual([]);
    expect(r.mutations[0]).toMatchObject({ op: "insert_context_item", row: { provenance: "user_authored" } });
  });

  it("downgrades a claimed user_authored item without a verbatim quote, and rejects confirmed status for it", () => {
    const r = guardMemoryProposals(state(), "Nights are rough lately.", {
      creates: [
        create({ provenance: "user_authored", semantic_status: "possibility", user_language: "I hate my job" }),
        create({
          provenance: "user_authored",
          semantic_status: "confirmed_context",
          user_language: "I hate my job",
          display_text: "You dislike your job.",
        }),
      ],
      stale: [],
    });
    expect(r.mutations).toHaveLength(1);
    expect(r.mutations[0]).toMatchObject({ row: { provenance: "ai_inferred", user_language: null } });
    expect(r.rejections[0].reason).toMatch(/ai_inferred items cannot be 'confirmed_context'/);
  });

  it("never lets the model create saved_interest or confirmed_goal", () => {
    const r = guardMemoryProposals(state(), "I want to be a nurse", {
      creates: [
        create({ provenance: "user_authored", user_language: "I want to be a nurse", semantic_status: "confirmed_goal" }),
        create({ display_text: "Interested in nursing.", semantic_status: "saved_interest" }),
      ],
      stale: [],
    });
    expect(r.mutations).toEqual([]);
    expect(r.rejections.every((x) => /explicit user action/.test(x.reason))).toBe(true);
  });

  it("lets a current user statement supersede stale context", () => {
    const old = item({ id: "old-1", display_text: "You live in Spokane.", temporal_status: "stale" });
    const r = guardMemoryProposals(
      state({ contextItems: [old] }),
      "We moved to Tacoma last month.",
      {
        creates: [
          create({
            provenance: "user_authored",
            semantic_status: "confirmed_context",
            user_language: "We moved to Tacoma",
            display_text: "You live in Tacoma.",
            supersedes: ["old-1"],
          }),
        ],
        stale: [],
      },
      ids(),
    );
    expect(r.rejections).toEqual([]);
    const [insert, update] = r.mutations;
    expect(insert.op).toBe("insert_context_item");
    expect(update).toMatchObject({
      op: "update_context_item",
      id: "old-1",
      patch: { temporal_status: "superseded", superseded_by: insert.op === "insert_context_item" && insert.row.id },
    });
  });

  it("does not let an inference supersede the person's own words", () => {
    const own = item({ id: "own-1", provenance: "user_authored" });
    const r = guardMemoryProposals(state({ contextItems: [own] }), "hmm", {
      creates: [create({ supersedes: ["own-1"] })],
      stale: [],
    });
    expect(r.mutations).toEqual([]);
    expect(r.rejections[0].reason).toMatch(/cannot supersede/);
  });

  it("does not let the model mark saved interests or goals stale", () => {
    const goal = item({ id: "goal-1", semantic_status: "confirmed_goal" });
    const r = guardMemoryProposals(state({ contextItems: [goal] }), "hi", {
      creates: [],
      stale: [{ id: "goal-1", reason: "old" }],
    });
    expect(r.mutations).toEqual([]);
  });

  it("rejects duplicates of current items", () => {
    const existing = item({ id: "x", display_text: "You work evenings." });
    const r = guardMemoryProposals(state({ contextItems: [existing] }), "x", { creates: [create({})], stale: [] });
    expect(r.rejections[0].reason).toMatch(/duplicates/);
  });
});

describe("next steps", () => {
  it("creates AI-drafted steps as 'suggested' by 'system'", () => {
    const r = guardStepProposals(state(), [{ pathway_id: PATHWAY, title: "Email the program advisor", why: null, how: null }]);
    expect(r.mutations[0]).toMatchObject({ op: "insert_action", row: { status: "suggested", created_by: "system" } });
  });

  it("rejects AI attempts to create adopted or completed steps", () => {
    const r = guardStepProposals(state(), [
      { pathway_id: PATHWAY, title: "A", why: null, how: null, status: "user_selected" },
      { pathway_id: PATHWAY, title: "B", why: null, how: null, status: "user_reported_complete" },
      { pathway_id: PATHWAY, title: "C", why: null, how: null, created_by: "user" },
    ]);
    expect(r.mutations).toEqual([]);
    expect(r.rejections).toHaveLength(3);
  });

  it("rejects steps on pathways the person does not own", () => {
    const r = guardStepProposals(state(), [{ pathway_id: OTHER_PATHWAY, title: "A", why: null, how: null }]);
    expect(r.rejections[0].reason).toBe("pathway not found");
  });

  it("only the person can adopt, then complete, a step", () => {
    const s = step({ id: "s1", title: "Visit the campus" });
    const adopt = guardUserActions(state({ actions: [s] }), [{ type: "adopt_step", actionId: "s1" }]);
    expect(adopt.mutations[0]).toMatchObject({ op: "update_action_status", from: "suggested", status: "user_selected" });

    const complete = guardUserActions(state({ actions: [{ ...s, status: "user_selected" }] }), [
      { type: "complete_step", actionId: "s1" },
    ]);
    expect(complete.mutations.map((m) => m.op)).toEqual(["update_action_status", "insert_progress_event"]);
    expect(complete.mutations[1]).toMatchObject({ row: { event_type: "action_completed", evidence_status: "user_reported" } });
  });

  it("does not adopt a step twice", () => {
    const s = step({ id: "s1", status: "user_selected" });
    const r = guardUserActions(state({ actions: [s] }), [{ type: "adopt_step", actionId: "s1" }]);
    expect(r.mutations).toEqual([]);
  });
});

describe("interests and goals", () => {
  it("saves and confirms only by explicit action, marking inferences user_approved", () => {
    const inferred = item({ id: "i1", provenance: "ai_inferred", semantic_status: "possibility" });
    const r = guardUserActions(state({ contextItems: [inferred] }), [
      { type: "save_interest", contextItemId: "i1" },
      { type: "confirm_goal", contextItemId: "i1" },
    ]);
    expect(r.rejections).toEqual([]);
    expect(r.mutations[0]).toMatchObject({ patch: { semantic_status: "saved_interest", provenance: "user_approved" } });
    expect(r.mutations[1]).toMatchObject({ patch: { semantic_status: "confirmed_goal", provenance: "user_approved" } });
  });

  it("cannot confirm a goal from a raw inference", () => {
    const inferred = item({ id: "i1", provenance: "ai_inferred", semantic_status: "inference" });
    const r = guardUserActions(state({ contextItems: [inferred] }), [{ type: "confirm_goal", contextItemId: "i1" }]);
    expect(r.mutations).toEqual([]);
  });
});

describe("wins", () => {
  it("blocks logins, sessions, and chat counts", () => {
    const { candidates, rejections } = guardWinCandidates(state(), [
      { pathway_id: PATHWAY, event_type: "login", title: "Logged in", learning: null },
      { pathway_id: PATHWAY, event_type: "research_completed", title: "Sent 20 messages", learning: null },
      { pathway_id: PATHWAY, event_type: "decision_made", title: "Logged in three days in a row", learning: null },
      { pathway_id: PATHWAY, event_type: "conversation_held", title: "Kept a 5 day streak", learning: null },
    ]);
    expect(candidates).toEqual([]);
    expect(rejections).toHaveLength(4);
  });

  it("requires a pathway the person owns", () => {
    const { candidates } = guardWinCandidates(state(), [
      { pathway_id: null, event_type: "application_submitted", title: "Submitted application", learning: null },
      { pathway_id: OTHER_PATHWAY, event_type: "application_submitted", title: "Submitted application", learning: null },
    ]);
    expect(candidates).toEqual([]);
  });

  it("accepts meaningful pathway actions, including conversations with people", () => {
    const { candidates } = guardWinCandidates(state(), [
      { pathway_id: PATHWAY, event_type: "conversation_held", title: "Chatted with a nurse about night shifts", learning: null },
    ]);
    expect(candidates).toHaveLength(1);
  });

  it("does not accept non-user-reported evidence from conversation", () => {
    const { candidates } = guardWinCandidates(state(), [
      {
        pathway_id: PATHWAY,
        event_type: "application_submitted",
        title: "Submitted application",
        learning: null,
        evidence_status: "system_verified",
      },
    ]);
    expect(candidates).toEqual([]);
  });

  it("records a win only through the person's explicit action, as user_reported", () => {
    const r = guardUserActions(state(), [
      { type: "record_win", win: { pathwayId: PATHWAY, eventType: "event_attended", title: "Went to the info session" } },
    ]);
    expect(r.mutations[0]).toMatchObject({
      op: "insert_progress_event",
      row: { evidence_status: "user_reported", source: "user_recorded", user_id: USER },
    });
  });
});
