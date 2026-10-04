import { describe, expect, it } from "vitest";
import type { Pathway, PathwayRoute, RouteStop } from "@/lib/db/types";
import { guardRouteProposal, guardUserActions, type GuardState, type RouteClaim } from "@/lib/validation/state-guard";

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
    routes: route ? [{ pathway_id: PATHWAY, confirmed_stops: null, suggested_stops: null, position: 0, updated_at: "", ...route }] : [],
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
