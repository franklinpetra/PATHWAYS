import { describe, expect, it } from "vitest";
import type { Pathway, PathwayRoute, RouteStop } from "@/lib/db/types";
import { buildBranches, buildEditedStops, guardRouteProposal, guardUserActions, remapIndex, type GuardState, type RouteClaim } from "@/lib/validation/state-guard";

const USER = "00000000-0000-4000-8000-000000000001";
const PATHWAY = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000ff";

const pathway = { id: PATHWAY, user_id: USER, title: "Pharmacy", status: "active" } as Pathway;
const source = { name: "ARTS", observationPeriod: null, asOf: "2026-10-01", verificationAuthority: "L&I", url: "https://data.wa.gov/d/x" };
const claims: RouteClaim[] = [
  { statement: "Pharmacy Technician apprenticeship. Starting apprentice wage: $17.48 per hour. Journey-level wage: $19.86 per hour.", source },
];

function state(route?: Partial<PathwayRoute>): GuardState {
  return {
    userId: USER,
    contextItems: [],
    archivedContextItems: [],
    pathways: [pathway],
    actions: [],
    progressEvents: [],
    routes: route
      ? [{ pathway_id: PATHWAY, confirmed_stops: null, suggested_stops: null, position: 0, person_edited: false, branches: [], updated_at: "", ...route }]
      : [],
  };
}

const proposal = [
  { label: "Art degree", pay: null, pay_source_number: null, gate_before: "Exam" },
  { label: "Pharmacy apprentice", pay: "$17.48/hr", pay_source_number: 1, gate_before: "Registration" },
  { label: "Pharmacy technician", pay: "$19.86/hr", pay_source_number: 1, gate_before: "National exam" },
];

describe("guardRouteProposal", () => {
  it("suggests a route, keeping only pay that its cited claim states, and never a gate before the first stop", () => {
    const result = guardRouteProposal(state(), PATHWAY, proposal, claims);
    expect(result.rejections).toEqual([]);
    expect(result.mutations).toHaveLength(1);
    const m = result.mutations[0];
    expect(m).toMatchObject({ op: "upsert_route", pathwayId: PATHWAY });
    const stops = (m as { patch: { suggested_stops: RouteStop[] } }).patch.suggested_stops;
    expect(stops.map((s) => [s.label, s.pay, s.gate])).toEqual([
      ["Art degree", null, null],
      ["Pharmacy apprentice", "$17.48/hr", "Registration"],
      ["Pharmacy technician", "$19.86/hr", "National exam"],
    ]);
    expect(stops[1].paySource).toEqual(source);
    // The AI never writes the confirmed route or the person's position.
    expect(Object.keys((m as { patch: object }).patch)).toEqual(["suggested_stops"]);
  });

  it("drops pay that the cited claim doesn't contain, or that cites no claim", () => {
    const result = guardRouteProposal(
      state(),
      PATHWAY,
      [
        { label: "Today", pay: null, pay_source_number: null, gate_before: null },
        { label: "Pharmacist", pay: "$150,000/yr", pay_source_number: 1, gate_before: "PharmD" },
        { label: "Lead pharmacist", pay: "$17.48/hr", pay_source_number: null, gate_before: null },
      ],
      claims,
    );
    const stops = (result.mutations[0] as { patch: { suggested_stops: RouteStop[] } }).patch.suggested_stops;
    expect(stops.map((s) => s.pay)).toEqual([null, null, null]);
    expect(stops.map((s) => s.paySource)).toEqual([null, null, null]);
  });

  it("needs at least two stops, caps at five, and ignores other people's pathways", () => {
    expect(guardRouteProposal(state(), PATHWAY, proposal.slice(0, 1), claims).rejections).toHaveLength(1);
    const long = Array.from({ length: 8 }, (_, i) => ({ label: `Stop ${i}`, pay: null, pay_source_number: null, gate_before: null }));
    const stops = (guardRouteProposal(state(), PATHWAY, long, claims).mutations[0] as { patch: { suggested_stops: RouteStop[] } }).patch
      .suggested_stops;
    expect(stops).toHaveLength(5);
    expect(guardRouteProposal(state(), OTHER, proposal, claims).mutations).toEqual([]);
  });

  it("does nothing when the proposal matches the current route or suggestion, or there is none", () => {
    const stops = (guardRouteProposal(state(), PATHWAY, proposal, claims).mutations[0] as { patch: { suggested_stops: RouteStop[] } })
      .patch.suggested_stops;
    expect(guardRouteProposal(state({ confirmed_stops: stops }), PATHWAY, proposal, claims).mutations).toEqual([]);
    expect(guardRouteProposal(state({ suggested_stops: stops }), PATHWAY, proposal, claims).mutations).toEqual([]);
    expect(guardRouteProposal(state(), PATHWAY, null, claims).mutations).toEqual([]);
  });
});

describe("route user actions", () => {
  const stops: RouteStop[] = [
    { label: "Today", pay: null, paySource: null, gate: null },
    { label: "Apprentice", pay: null, paySource: null, gate: "Registration" },
  ];

  it("uses a suggested route from its first stop", () => {
    const result = guardUserActions(state({ suggested_stops: stops, position: 3 }), [{ type: "accept_route", pathwayId: PATHWAY }]);
    expect(result.mutations[0]).toMatchObject({
      op: "upsert_route",
      patch: { confirmed_stops: stops, suggested_stops: null, position: 0 },
    });
  });

  it("dismisses a suggestion without touching the confirmed route", () => {
    const result = guardUserActions(state({ confirmed_stops: stops, suggested_stops: stops }), [{ type: "dismiss_route", pathwayId: PATHWAY }]);
    expect(result.mutations[0]).toMatchObject({ patch: { suggested_stops: null } });
    expect(Object.keys((result.mutations[0] as { patch: object }).patch)).toEqual(["suggested_stops"]);
  });

  it("moves 'you are here' only to a stop on the confirmed route", () => {
    expect(guardUserActions(state({ confirmed_stops: stops }), [{ type: "set_route_position", pathwayId: PATHWAY, position: 1 }]).mutations[0]).toMatchObject({
      patch: { position: 1 },
    });
    expect(guardUserActions(state({ confirmed_stops: stops }), [{ type: "set_route_position", pathwayId: PATHWAY, position: 2 }]).rejections).toHaveLength(1);
    expect(guardUserActions(state({ suggested_stops: stops }), [{ type: "set_route_position", pathwayId: PATHWAY, position: 0 }]).rejections).toHaveLength(1);
  });

  it("refuses to use or dismiss a route that isn't there, or on someone else's pathway", () => {
    expect(guardUserActions(state(), [{ type: "accept_route", pathwayId: PATHWAY }]).rejections).toHaveLength(1);
    expect(guardUserActions(state(), [{ type: "dismiss_route", pathwayId: PATHWAY }]).rejections).toHaveLength(1);
    expect(guardUserActions(state({ suggested_stops: stops }), [{ type: "accept_route", pathwayId: OTHER }]).rejections).toHaveLength(1);
  });
});

describe("editing a route", () => {
  const base: RouteStop[] = [
    { label: "Art degree", pay: null, paySource: null, gate: null },
    { label: "Pharmacy technician", pay: "$29.11/hour", paySource: source, gate: "Credentialing" },
    { label: "Pharmacist", pay: "$79.38/hour", paySource: source, gate: "Licensure" },
  ];

  it("keeps pay and gate only on stops kept under the same name", () => {
    const built = buildEditedStops(base, [
      { label: "Art degree", from: 0 },
      { label: "Pharmacy technician", from: 1 },
      { label: "My own pharmacy", from: 2 },
    ]) as RouteStop[];
    expect(built[1]).toMatchObject({ pay: "$29.11/hour", gate: "Credentialing" });
    expect(built[2]).toMatchObject({ label: "My own pharmacy", pay: null, paySource: null, gate: null });
  });

  it("rejects blank names, reused stops, and too few stops", () => {
    expect(buildEditedStops(base, [{ label: " ", from: 0 }, { label: "x", from: null }])).toMatch(/needs a name/);
    expect(buildEditedStops(base, [{ label: "a", from: 0 }, { label: "b", from: 0 }])).toMatch(/kept once/);
    expect(buildEditedStops(base, [{ label: "only", from: 0 }])).toMatch(/at least/);
  });

  it("moves an index to its stop's new place, or the nearest earlier kept stop", () => {
    const stops = [{ from: 0 }, { from: null }, { from: 2 }];
    expect(remapIndex(2, stops)).toBe(2);
    expect(remapIndex(1, stops)).toBe(0);
  });

  it("saves the person's route, keeps 'you are here' on its stop, and walks wins along with it", () => {
    const win = { id: "00000000-0000-4000-8000-0000000000w1", pathway_id: PATHWAY, route_stop: 2 } as never;
    const s = { ...state({ confirmed_stops: base, position: 2 }), progressEvents: [win] };
    const result = guardUserActions(s, [
      {
        type: "set_route_stops",
        pathwayId: PATHWAY,
        base: "confirmed",
        stops: [
          { label: "Art degree", from: 0 },
          { label: "Pharmacy assistant", from: null },
          { label: "Pharmacy technician", from: 1 },
          { label: "Pharmacist", from: 2 },
        ],
      },
    ]);
    expect(result.rejections).toEqual([]);
    expect(result.mutations[0]).toMatchObject({ op: "upsert_route", patch: { position: 3, person_edited: true } });
    expect(result.mutations[1]).toMatchObject({ op: "update_progress_event", patch: { route_stop: 3 } });
  });

  it("can accept and edit a suggestion in one step", () => {
    const result = guardUserActions(state({ suggested_stops: base }), [
      { type: "set_route_stops", pathwayId: PATHWAY, base: "suggested", stops: [{ label: "Art degree", from: 0 }, { label: "Pharmacist", from: 2 }] },
    ]);
    expect(result.mutations[0]).toMatchObject({ patch: { position: 0, suggested_stops: null, person_edited: true } });
  });
});

describe("footsteps", () => {
  const underway = { id: "00000000-0000-4000-8000-0000000000w2", pathway_id: PATHWAY, stage: "underway", route_stop: 0, title: "Setting up Upwork" } as never;

  it("finishes an under-way win", () => {
    const result = guardUserActions({ ...state(), progressEvents: [underway] }, [{ type: "finish_win", progressEventId: "00000000-0000-4000-8000-0000000000w2" }]);
    expect(result.mutations[0]).toMatchObject({ op: "update_progress_event", patch: { stage: "done" } });
  });

  it("records a win on the stretch the person is on", () => {
    const result = guardUserActions(state({ confirmed_stops: [{ label: "A", pay: null, paySource: null, gate: null }, { label: "B", pay: null, paySource: null, gate: null }], position: 1 }), [
      { type: "record_win", win: { pathwayId: PATHWAY, eventType: "work_started", title: "Started an Upwork page", stage: "underway" } },
    ]);
    expect(result.mutations[0]).toMatchObject({ row: { stage: "underway", route_stop: 1 } });
  });

  it("moves earlier wins onto the first stretch when a route is chosen", () => {
    const loose = { id: "00000000-0000-4000-8000-0000000000w3", pathway_id: PATHWAY, route_stop: null } as never;
    const result = guardUserActions({ ...state({ suggested_stops: [{ label: "A", pay: null, paySource: null, gate: null }, { label: "B", pay: null, paySource: null, gate: null }] }), progressEvents: [loose] }, [
      { type: "accept_route", pathwayId: PATHWAY },
    ]);
    expect(result.mutations[1]).toMatchObject({ op: "update_progress_event", patch: { route_stop: 0 } });
  });
});

describe("route stop notes", () => {
  const base: RouteStop[] = [
    { label: "Coder with AI", pay: null, paySource: null, gate: null },
    { label: "Full-stack engineer", pay: null, paySource: null, gate: "Portfolio", note: "Remote, $150K+" },
  ];

  it("keeps a stop's note unless the person changes it, and cleans what they write", () => {
    const kept = buildEditedStops(base, [{ label: "Coder with AI", from: 0 }, { label: "Full-stack engineer", from: 1 }]) as RouteStop[];
    expect(kept[1].note).toBe("Remote, $150K+");
    const changed = buildEditedStops(base, [
      { label: "Coder with AI", from: 0, note: "  Studio founder  " },
      { label: "Full-stack engineer", from: 1, note: null },
    ]) as RouteStop[];
    expect(changed.map((s) => s.note)).toEqual(["Studio founder", null]);
  });
});

describe("branches", () => {
  const s = (label: string): RouteStop => ({ label, pay: null, paySource: null, gate: null });
  const trunk = [s("Coder with AI"), s("Freelance developer"), s("Full-stack engineer")];
  const branch = { id: "bart", from: 0, stops: [s("Gallery show"), s("Working artist")] };
  const W = "00000000-0000-4000-8000-0000000000w4";

  it("adds other goals that grow from stops on the trunk", () => {
    const result = guardUserActions(state({ confirmed_stops: trunk, position: 1 }), [
      { type: "set_route_branches", pathwayId: PATHWAY, branches: [{ id: null, from: 1, stops: [{ label: "  Teach a workshop " }, { label: "Studio founder", note: "Mine by 2029" }] }] },
    ]);
    expect(result.rejections).toEqual([]);
    const branches = (result.mutations[0] as unknown as { patch: { branches: { from: number; stops: RouteStop[] }[] } }).patch.branches;
    expect(branches[0].from).toBe(1);
    expect(branches[0].stops.map((x) => [x.label, x.note])).toEqual([["Teach a workshop", null], ["Studio founder", "Mine by 2029"]]);
  });

  it("refuses a branch without a trunk, or forking off the end of it", () => {
    expect(guardUserActions(state(), [{ type: "set_route_branches", pathwayId: PATHWAY, branches: [] }]).rejections).toHaveLength(1);
    expect(buildBranches([], [{ id: null, from: 3, stops: [{ label: "X" }] }], 3)).toBeTypeOf("string");
    expect(buildBranches([], [{ id: null, from: 0, stops: [{ label: "   " }] }], 3)).toBeTypeOf("string");
  });

  it("keeps a branch's id, and a stop's pay, when the name is unchanged", () => {
    const priced = { ...branch, stops: [{ ...s("Gallery show"), pay: "$40/hr" }, s("Working artist")] };
    const built = buildBranches([priced], [{ id: "bart", from: 0, stops: [{ label: "Gallery show" }, { label: "Muralist" }] }], 3);
    expect(built).toMatchObject([{ id: "bart", stops: [{ pay: "$40/hr" }, { pay: null, label: "Muralist" }] }]);
  });

  it("records a win on a branch, and moves it home when the branch goes", () => {
    const st = state({ confirmed_stops: trunk, position: 2, branches: [branch] });
    const rec = guardUserActions(st, [{ type: "record_win", win: { pathwayId: PATHWAY, eventType: "milestone_reached", title: "Sold a print", branch: "bart" } }]);
    expect(rec.mutations[0]).toMatchObject({ row: { route_branch: "bart", route_stop: 0 } });
    const stray = guardUserActions(st, [{ type: "record_win", win: { pathwayId: PATHWAY, eventType: "milestone_reached", title: "Sold a print", branch: "nope" } }]);
    expect(stray.mutations[0]).toMatchObject({ row: { route_branch: null, route_stop: 2 } });

    const onBranch = { id: W, pathway_id: PATHWAY, route_branch: "bart", route_stop: 0, title: "Sold a print" } as never;
    const removed = guardUserActions({ ...st, progressEvents: [onBranch] }, [{ type: "set_route_branches", pathwayId: PATHWAY, branches: [] }]);
    expect(removed.mutations[1]).toMatchObject({ op: "update_progress_event", patch: { route_branch: null, route_stop: 0 } });
  });

  it("moves a win between branches the route has", () => {
    const st = { ...state({ confirmed_stops: trunk, position: 1, branches: [branch] }), progressEvents: [{ id: W, pathway_id: PATHWAY, route_branch: null, route_stop: 1 } as never] };
    expect(guardUserActions(st, [{ type: "move_win", progressEventId: W, branch: "bart" }]).mutations[0]).toMatchObject({ patch: { route_branch: "bart" } });
    expect(guardUserActions(st, [{ type: "move_win", progressEventId: W, branch: "zzz" }]).rejections).toHaveLength(1);
  });

  it("re-roots branches when the trunk is edited or a new route is chosen", () => {
    const edited = guardUserActions(state({ confirmed_stops: trunk, position: 0, branches: [{ ...branch, from: 2 }] }), [
      { type: "set_route_stops", pathwayId: PATHWAY, base: "confirmed", stops: [{ label: "Coder with AI", from: 0 }, { label: "Full-stack engineer", from: 2 }] },
    ]);
    expect(edited.mutations[0]).toMatchObject({ patch: { branches: [{ from: 1 }] } });
    const accepted = guardUserActions(state({ confirmed_stops: trunk, suggested_stops: [s("A"), s("B")], branches: [{ ...branch, from: 2 }] }), [
      { type: "accept_route", pathwayId: PATHWAY },
    ]);
    expect(accepted.mutations[0]).toMatchObject({ patch: { branches: [{ from: 0 }] } });
  });
});

describe("saving trunk and branches together", () => {
  it("checks branch forks against the trunk saved just before", () => {
    const s = (label: string): RouteStop => ({ label, pay: null, paySource: null, gate: null });
    const result = guardUserActions(state({ confirmed_stops: [s("A"), s("B")] }), [
      { type: "set_route_stops", pathwayId: PATHWAY, base: "confirmed", stops: [{ label: "A", from: 0 }, { label: "B", from: 1 }, { label: "C", from: null }] },
      { type: "set_route_branches", pathwayId: PATHWAY, branches: [{ id: null, from: 2, stops: [{ label: "D" }] }] },
    ]);
    expect(result.rejections).toEqual([]);
  });
});
