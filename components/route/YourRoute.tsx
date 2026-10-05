"use client";

import { ChevronDown, Pencil, Plus, Sprout, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { RecentWins } from "@/components/dashboard/RecentWins";
import { formatDay } from "@/lib/client/format";
import { formatSourceDate } from "@/lib/workspace/attribution";
import type { Action, PathwayRoute, ProgressEvent, RouteBranch, RouteStop } from "@/lib/db/types";
import { ROUTE_LIMITS, type UserAction, type WinCandidate } from "@/lib/validation/state-guard";
import { RouteMap, type MapItem, type MapStopRef } from "./RouteMap";

/**
 * Your Route: where the person stands and where they're going. A chosen route is drawn as a
 * living map (RouteMap): the trunk to their main goal, a branch for each other goal they pursue,
 * wins as leaves, and open next steps as points of light. A suggested route, not yet chosen,
 * stays one quiet dashed line with footsteps until the person decides.
 *
 *  - Stops are the big moves: passed (forest), "you are here" (the dawn dot), ahead (hollow).
 *    Pay shows under a stop only when a verified source stated it; gates sit on the line.
 *  - Wins are footsteps on the stretch after the stop the person had reached when they happened:
 *    filled when done, outlined when under way, dashed when PATHWAYS spotted one and it waits for a
 *    tap to confirm. Footsteps never reach the next stop on their own; reaching a stop is the
 *    person's call. When they move on, their footsteps stay on the road behind them.
 *  - The AI only suggests a route. The person uses it, edits it, and moves the dot.
 */

const MAX_VISIBLE_STEPS = 6;

interface YourRouteProps {
  pathwayId: string;
  route: PathwayRoute | null;
  /** All of the person's recent wins; only this pathway's are shown. */
  wins: ProgressEvent[];
  candidates: WinCandidate[];
  /** Open next steps, shown as points of light on the road ahead. */
  steps: Action[];
  busy: boolean;
  onAction: (actions: UserAction[]) => void;
  onDismissCandidate: (candidate: WinCandidate) => void;
}

type Step = Exclude<MapItem, { kind: "light" }>;

export function YourRoute({ pathwayId, route, wins, candidates, steps, busy, onAction, onDismissCandidate }: YourRouteProps) {
  const [reviewing, setReviewing] = useState(false);
  const [marking, setMarking] = useState<MapStopRef | null>(null);
  const [selected, setSelected] = useState<MapItem | null>(null);
  const [showList, setShowList] = useState(false);
  const [editing, setEditing] = useState<"confirmed" | "suggested" | null>(null);
  /** Open the editor with a new, empty goal ready to name. */
  const [growing, setGrowing] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // Footsteps present on first render don't animate; new ones land with a small step.
  const known = useRef<Set<string> | null>(null);

  const myWins = wins.filter((w) => w.pathway_id === pathwayId);
  const myCandidates = candidates.filter((c) => c.pathway_id === pathwayId);
  if (known.current === null) known.current = new Set([...myWins.map((w) => w.id), ...myCandidates.map((c) => c.title)]);
  const isNew = (key: string) => !known.current!.has(key);
  useEffect(() => {
    for (const w of myWins) known.current!.add(w.id);
    for (const c of myCandidates) known.current!.add(c.title);
  });

  const confirmed = route?.confirmed_stops?.length ? route.confirmed_stops : null;
  const suggested = route?.suggested_stops?.length ? route.suggested_stops : null;
  const showSuggestion = !!suggested && (!confirmed || reviewing);
  const stops = showSuggestion ? suggested : confirmed;
  const position = stops && !showSuggestion ? Math.min(route!.position, stops.length - 1) : -1;
  const branches = route?.branches ?? [];
  const markedStop = marking ? (marking.branch ? branches.find((b) => b.id === marking.branch)?.stops[marking.index] : stops?.[marking.index]) : undefined;

  // On a narrow screen the route scrolls sideways; keep "you are here" in view.
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>('[aria-current="step"]')?.closest("li");
    if (list && here && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = here.offsetLeft - list.clientWidth / 2 + here.offsetWidth / 2;
    }
  }, [position, stops]);

  const totalWins = myWins.length + myCandidates.length;
  if (!stops && totalWins === 0) return null;

  // Footsteps for the stretch after stop i (the last stop's footsteps sit on the final stretch).
  const stepsAfter = (i: number): Step[] => {
    if (!stops || showSuggestion) return [];
    const last = stops.length - 1;
    const onStretch = (stop: number | null) => (stop ?? 0) === i || (i === last - 1 && (stop ?? 0) >= last);
    const done = myWins
      .filter((w) => onStretch(w.route_stop))
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .map<Step>((win) => ({ kind: "win", key: win.id, win }));
    const pending =
      i === Math.min(position, last - 1)
        ? myCandidates.map<Step>((candidate) => ({ kind: "candidate", key: candidate.title, candidate }))
        : [];
    return [...done, ...pending];
  };

  if (editing && (editing === "confirmed" ? confirmed : suggested)) {
    const close = () => {
      setEditing(null);
      setGrowing(false);
    };
    return (
      <RouteEditor
        base={(editing === "confirmed" ? confirmed : suggested)!}
        here={editing === "confirmed" ? (route?.position ?? 0) : 0}
        branches={editing === "confirmed" ? branches : null}
        startNewGoal={growing}
        busy={busy}
        onCancel={close}
        onSave={(next, nextBranches) => {
          onAction([
            { type: "set_route_stops", pathwayId, base: editing, stops: next },
            ...(nextBranches ? [{ type: "set_route_branches" as const, pathwayId, branches: nextBranches }] : []),
          ]);
          close();
          setReviewing(false);
        }}
      />
    );
  }

  return (
    <section aria-label={showSuggestion ? "Suggested route" : "Your route"} className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow">{!stops ? "Wins along the way" : showSuggestion ? "Suggested route" : "Your route"}</h2>
        <div className="flex items-center gap-1">
          {confirmed && suggested && !reviewing && (
            <button type="button" onClick={() => setReviewing(true)} className="btn btn-ghost btn-sm text-dawn">
              Updated route suggested
            </button>
          )}
          {totalWins > 0 && (
            <button
              type="button"
              onClick={() => setShowList((v) => !v)}
              aria-expanded={showList}
              className="btn btn-ghost btn-sm gap-1 text-dawn"
            >
              {totalWins} {totalWins === 1 ? "win" : "wins"}
              <ChevronDown className={`size-3.5 transition-transform ${showList ? "rotate-180" : ""}`} aria-hidden />
            </button>
          )}
          {confirmed && !showSuggestion && branches.length < ROUTE_LIMITS.maxBranches && (
            <button
              type="button"
              onClick={() => {
                setGrowing(true);
                setEditing("confirmed");
              }}
              className="btn btn-ghost btn-sm gap-1 text-forest"
            >
              <Sprout className="size-3.5" aria-hidden />
              Add a goal
            </button>
          )}
          {confirmed && !showSuggestion && (
            <button type="button" onClick={() => setEditing("confirmed")} aria-label="Edit your route" className="btn btn-ghost btn-icon size-7">
              <Pencil className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {stops && !showSuggestion ? (
        <RouteMap
          trunk={stops}
          position={position}
          branches={branches}
          wins={myWins}
          candidates={myCandidates}
          steps={steps.filter((s) => s.pathway_id === pathwayId)}
          selected={selected?.key ?? null}
          isNew={isNew}
          disabled={busy}
          onSelectItem={(item) => setSelected((cur) => (cur?.key === item.key ? null : item))}
          onSelectStop={(ref) => setMarking((cur) => (cur && cur.branch === ref.branch && cur.index === ref.index ? null : ref))}
        />
      ) : stops ? (
        <ol
          ref={listRef}
          className="relative -mx-gutter flex items-start overflow-x-auto overflow-y-hidden px-gutter pt-7 pb-1 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none] lg:overflow-visible [&::-webkit-scrollbar]:hidden"
        >
          {stops.map((stop, i) => (
            <Fragment key={`${i}-${stop.label}`}>
              {i > 0 && (
                <Connector
                  gate={stop.gate}
                  passed={i <= position}
                  dashed={showSuggestion}
                  steps={stepsAfter(i - 1)}
                  isNew={isNew}
                  selected={selected?.key ?? null}
                  onSelect={setSelected}
                />
              )}
              <Stop
                stop={stop}
                state={showSuggestion ? "suggested" : i < position ? "passed" : i === position ? "here" : "ahead"}
                disabled={busy}
                onSelect={() => setMarking(marking?.index === i ? null : { branch: null, index: i })}
              />
            </Fragment>
          ))}
        </ol>
      ) : (
        <WinsOnly
          steps={[
            ...myWins.map<Step>((win) => ({ kind: "win", key: win.id, win })),
            ...myCandidates.map<Step>((candidate) => ({ kind: "candidate", key: candidate.title, candidate })),
          ]}
          isNew={isNew}
          selected={selected?.key ?? null}
          onSelect={setSelected}
        />
      )}

      {selected && (
        <StepDetail
          step={selected}
          branches={stops && !showSuggestion ? branches : []}
          trunkGoal={stops?.[stops.length - 1]?.label ?? null}
          busy={busy}
          onClose={() => setSelected(null)}
          onMove={(w, branch) => {
            onAction([{ type: "move_win", progressEventId: w.id, branch }]);
            setSelected(null);
          }}
          onConfirm={(c) => {
            onAction([
              {
                type: "record_win",
                win: { pathwayId: c.pathway_id, eventType: c.event_type, title: c.title, learning: c.learning, stage: c.stage, branch: c.branch },
              },
            ]);
            onDismissCandidate(c);
            setSelected(null);
          }}
          onDismiss={(c) => {
            onDismissCandidate(c);
            setSelected(null);
          }}
          onFinish={(w) => {
            onAction([{ type: "finish_win", progressEventId: w.id }]);
            setSelected(null);
          }}
        />
      )}

      {showSuggestion ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="mr-1 text-sm text-foreground">Is this where you want to go?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onAction([{ type: "accept_route", pathwayId }]);
              setReviewing(false);
            }}
            className="btn btn-active btn-sm"
          >
            Yes, use it
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing("suggested")} className="btn btn-secondary btn-sm">
            Edit it
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmed ? setReviewing(false) : onAction([{ type: "dismiss_route", pathwayId }]))}
            className="btn btn-ghost btn-sm"
          >
            {confirmed ? "Keep mine" : "Not now"}
          </button>
        </div>
      ) : null}

      {marking && markedStop && (
        <div role="group" aria-label={markedStop.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-surface px-3 py-2 text-sm">
          <span className="font-medium">{markedStop.label}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">
            {markedStop.note ?? (confirmed && !showSuggestion ? "No note yet. Use the pencil to say what this stop means to you." : "")}
          </span>
          {!showSuggestion && !marking.branch && marking.index !== position && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onAction([{ type: "set_route_position", pathwayId, position: marking.index }]);
                setMarking(null);
              }}
              className="btn btn-active btn-sm"
            >
              I&apos;m here now
            </button>
          )}
          <button type="button" onClick={() => setMarking(null)} aria-label="Close" className="btn btn-ghost btn-icon size-7">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}

      {showList && (
        <div className="pt-2">
          <RecentWins variant="inline" wins={myWins} candidates={myCandidates} busy={busy} onAction={onAction} onDismissCandidate={onDismissCandidate} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

type StopState = "passed" | "here" | "ahead" | "suggested";

function Stop({ stop, state, disabled, onSelect }: { stop: RouteStop; state: StopState; disabled: boolean; onSelect: () => void }) {
  const dot = {
    passed: "border-forest bg-forest",
    here: "border-dawn bg-dawn shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-dawn)_18%,transparent)]",
    ahead: "border-forest/50 bg-surface",
    suggested: "border-border-strong bg-surface",
  }[state];
  const source = stop.paySource
    ? `${stop.paySource.name}, ${stop.paySource.verificationAuthority}, as of ${formatSourceDate(stop.paySource.asOf)}`
    : undefined;
  return (
    <li className="flex w-[5.75rem] shrink-0 flex-col items-center text-center sm:w-28">
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-current={state === "here" ? "step" : undefined}
        aria-label={`${stop.label}${state === "here" ? ", you are here" : state === "passed" ? ", reached" : ""}${stop.note ? `. Note: ${stop.note}` : ""}`}
        className="group flex flex-col items-center rounded-xl px-1 disabled:cursor-default"
      >
        <span className={`relative z-10 size-3.5 rounded-full border-2 transition-transform group-enabled:group-hover:scale-125 ${dot}`} aria-hidden />
        <span
          className={`mt-1.5 text-xs leading-tight ${state === "here" ? "font-semibold text-foreground" : "font-medium text-foreground/85"} ${stop.note ? "underline decoration-dawn/50 decoration-dotted underline-offset-[3px]" : ""}`}
        >
          {stop.label}
        </span>
      </button>
      {stop.pay && (
        <span title={source} className="mt-0.5 text-[11px] text-forest tabular-nums">
          {stop.pay}
          {source && <span className="sr-only"> (source: {source})</span>}
        </span>
      )}
    </li>
  );
}

function Connector({
  gate,
  passed,
  dashed,
  steps,
  isNew,
  selected,
  onSelect,
}: {
  gate: string | null;
  passed: boolean;
  dashed: boolean;
  steps: Step[];
  isNew: (key: string) => boolean;
  selected: string | null;
  onSelect: (step: Step) => void;
}) {
  const visible = steps.slice(-MAX_VISIBLE_STEPS);
  const hidden = steps.length - visible.length;
  return (
    // Reaches under the neighboring stops so the line runs continuously from dot to dot.
    <li className="relative -mx-10 mt-[6px] min-w-[8.5rem] flex-1 sm:-mx-[3.125rem] sm:min-w-[7.5rem]">
      <span aria-hidden className={`block border-t-2 ${passed ? "border-forest" : "border-forest/30"} ${dashed || !passed ? "border-dashed" : ""}`} />
      {gate && (
        <span
          aria-hidden
          // Sits toward the stop it leads to, above the footsteps.
          className="absolute right-[16%] -top-[25px] px-1.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
        >
          {gate}
        </span>
      )}
      {steps.length > 0 && (
        // Footsteps walk from the stop behind toward the stop ahead, and never arrive on their own.
        <span className="absolute inset-x-[16%] -top-[5px] flex items-center justify-start gap-[7px]">
          {hidden > 0 && <span className="mr-0.5 text-[10px] font-semibold text-dawn tabular-nums">+{hidden}</span>}
          {visible.map((step, n) => (
            <Footstep key={step.key} step={step} index={n} fresh={isNew(step.key)} active={selected === step.key} onSelect={() => onSelect(step)} />
          ))}
        </span>
      )}
    </li>
  );
}

function Footstep({ step, index, fresh, active, onSelect }: { step: Step; index: number; fresh: boolean; active: boolean; onSelect: () => void }) {
  // Alternating tilt and lift, like left and right feet.
  const left = index % 2 === 0;
  const style = { "--tilt": left ? "-14deg" : "14deg", transform: `translateY(${left ? "-2px" : "2px"}) rotate(var(--tilt))` } as CSSProperties;
  const look =
    step.kind === "candidate"
      ? "border border-dashed border-dawn/70 bg-surface motion-safe:animate-pulse"
      : step.win.stage === "underway"
        ? "border-[1.5px] border-dawn bg-surface"
        : "bg-dawn";
  const label =
    step.kind === "candidate"
      ? `Spotted a win: ${step.candidate.title}. Tap to add it`
      : `${step.win.stage === "underway" ? "Under way" : "Win"}: ${step.win.title}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      title={step.kind === "candidate" ? step.candidate.title : step.win.title}
      style={style}
      className={`relative z-10 h-[9px] w-[6px] shrink-0 rounded-full ${look} ${fresh ? "motion-safe:animate-step-in" : ""} ${active ? "ring-2 ring-dawn/40 ring-offset-1" : ""} focus-visible:ring-2 focus-visible:ring-forest`}
    />
  );
}

function WinsOnly({
  steps,
  isNew,
  selected,
  onSelect,
}: {
  steps: Step[];
  isNew: (key: string) => boolean;
  selected: string | null;
  onSelect: (s: Step) => void;
}) {
  const visible = steps.slice(-12);
  return (
    <div className="flex items-center gap-[7px] py-2">
      {steps.length > visible.length && <span className="text-[10px] font-semibold text-dawn">+{steps.length - visible.length}</span>}
      {visible.map((step, n) => (
        <Footstep key={step.key} step={step} index={n} fresh={isNew(step.key)} active={selected === step.key} onSelect={() => onSelect(step)} />
      ))}
    </div>
  );
}

function StepDetail({
  step,
  branches,
  trunkGoal,
  busy,
  onClose,
  onConfirm,
  onDismiss,
  onFinish,
  onMove,
}: {
  step: MapItem;
  /** The person's other goals, so a win can be moved to the one it belongs to. */
  branches: RouteBranch[];
  trunkGoal: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (c: WinCandidate) => void;
  onDismiss: (c: WinCandidate) => void;
  onFinish: (w: ProgressEvent) => void;
  onMove: (w: ProgressEvent, branch: string | null) => void;
}) {
  const goalOf = (b: RouteBranch) => b.stops[b.stops.length - 1]?.label ?? "Another goal";
  return (
    <div role="group" aria-label={step.kind === "light" ? "Next step" : "Win"} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-dawn-tint px-3 py-2 text-sm">
      {step.kind === "light" ? (
        <>
          <span className="text-xs font-medium text-dawn">Next step</span>
          <span className="min-w-0 flex-1">
            {step.step.title}
            {step.step.why && <span className="block text-xs text-muted-foreground">{step.step.why}</span>}
          </span>
        </>
      ) : step.kind === "candidate" ? (
        <>
          <span className="text-xs font-medium text-dawn">{step.candidate.stage === "underway" ? "Sounds like you've started:" : "Sounds like a win:"}</span>
          <span className="min-w-0 flex-1">{step.candidate.title}</span>
          <button type="button" disabled={busy} onClick={() => onConfirm(step.candidate)} className="btn btn-primary btn-sm">
            Add to my road
          </button>
          <button type="button" onClick={() => onDismiss(step.candidate)} className="btn btn-ghost btn-sm">
            Not this one
          </button>
        </>
      ) : (
        <>
          <span className="text-xs font-medium text-dawn">{step.win.stage === "underway" ? "Under way" : formatDay(step.win.occurred_at)}</span>
          <span className="min-w-0 flex-1">{step.win.title}</span>
          {step.win.stage === "underway" && (
            <button type="button" disabled={busy} onClick={() => onFinish(step.win)} className="btn btn-active btn-sm">
              Mark done
            </button>
          )}
          {branches.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Grows toward
              <select
                disabled={busy}
                value={step.win.route_branch && branches.some((b) => b.id === step.win.route_branch) ? step.win.route_branch : ""}
                onChange={(e) => onMove(step.win, e.target.value || null)}
                className="field field-sm h-7 w-auto max-w-[12rem] py-0 text-xs"
              >
                <option value="">{trunkGoal ?? "Main route"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {goalOf(b)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon size-7">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

type BranchDraft = { key: string; id: string | null; fromKey: string; stops: { key: string; label: string; note: string }[] };
type BranchSave = { id: string | null; from: number; stops: { label: string; note: string | null }[] };

/** The person's own version of the route: rename, remove, or add stops, and the other goals that grow from it. */
function RouteEditor({
  base,
  here,
  branches,
  startNewGoal,
  busy,
  onCancel,
  onSave,
}: {
  base: RouteStop[];
  /** The stop the person is at, marked with the dawn dot. */
  here: number;
  /** Their other goals; null when editing a suggestion, which has none yet. */
  branches: RouteBranch[] | null;
  startNewGoal: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (stops: { label: string; from: number | null; note: string | null }[], branches: BranchSave[] | null) => void;
}) {
  const [stops, setStops] = useState(base.map((s, i) => ({ label: s.label, note: s.note ?? "", from: i as number | null, key: `s${i}` })));
  const blankGoal = (): BranchDraft => ({
    key: `g${Date.now()}`,
    id: null,
    fromKey: `s${Math.min(here, base.length - 1)}`,
    stops: [{ key: `gs${Date.now()}`, label: "", note: "" }],
  });
  const [goals, setGoals] = useState<BranchDraft[]>(() => [
    ...(branches ?? []).map((b) => ({
      key: b.id,
      id: b.id,
      fromKey: `s${Math.min(b.from, base.length - 1)}`,
      stops: b.stops.map((st, j) => ({ key: `${b.id}-${j}`, label: st.label, note: st.note ?? "" })),
    })),
    ...(branches && startNewGoal && branches.length < ROUTE_LIMITS.maxBranches ? [blankGoal()] : []),
  ]);
  const canRemove = stops.length > 2;
  const canAdd = stops.length < 6;
  const add = (at: number) => setStops((all) => [...all.slice(0, at), { label: "", note: "", from: null, key: `n${Date.now()}` }, ...all.slice(at)]);
  const setGoal = (key: string, fn: (g: BranchDraft) => BranchDraft) => setGoals((all) => all.map((g) => (g.key === key ? fn(g) : g)));
  // A goal growing from a stop the person just removed moves to where they are.
  const forkIndex = (g: BranchDraft) => {
    const i = stops.findIndex((s) => s.key === g.fromKey);
    return i >= 0 ? i : Math.max(0, Math.min(stops.findIndex((s) => s.from === here), stops.length - 1));
  };
  const incomplete = stops.some((s) => !s.label.trim()) || goals.some((g) => g.stops.some((s) => !s.label.trim()));
  return (
    <section aria-label="Edit your route" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h2 className="eyebrow">Edit your route</h2>
        <span className="text-xs text-muted-foreground">From where you are to where you want to be</span>
      </div>
      <ol className="space-y-1.5">
        {stops.map((stop, i) => (
          <li key={stop.key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`size-3 shrink-0 rounded-full border-2 ${stop.from === here ? "border-dawn bg-dawn" : "border-forest/50"}`} aria-hidden />
              <label className="sr-only" htmlFor={`stop-${stop.key}`}>
                {i === 0 ? "Where you are now" : i === stops.length - 1 ? "Where you want to be" : `Stop ${i + 1}`}
              </label>
              <input
                id={`stop-${stop.key}`}
                value={stop.label}
                maxLength={40}
                placeholder={i === 0 ? "Where you are now" : i === stops.length - 1 ? "Where you want to be" : "A step on the way"}
                onChange={(e) => setStops((all) => all.map((s) => (s.key === stop.key ? { ...s, label: e.target.value } : s)))}
                className="field field-sm flex-1"
              />
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => setStops((all) => all.filter((s) => s.key !== stop.key))}
                aria-label={`Remove ${stop.label || "this stop"}`}
                className="btn btn-ghost btn-icon size-7"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
            <label className="sr-only" htmlFor={`note-${stop.key}`}>
              Note for {stop.label || "this stop"}
            </label>
            <textarea
              id={`note-${stop.key}`}
              value={stop.note}
              maxLength={140}
              rows={1}
              placeholder="What this means to you (optional), e.g. remote, $150K+, mission-driven"
              onChange={(e) => setStops((all) => all.map((s) => (s.key === stop.key ? { ...s, note: e.target.value } : s)))}
              className="field field-sm field-multiline ml-5 w-[calc(100%-1.25rem)] resize-y text-xs text-muted-foreground"
            />
            {i < stops.length - 1 && canAdd && (
              <button type="button" onClick={() => add(i + 1)} className="ml-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-forest">
                <Plus className="size-3" aria-hidden /> Add a stop here
              </button>
            )}
          </li>
        ))}
      </ol>

      {branches && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <h3 className="eyebrow">Also aiming for</h3>
            <span className="text-xs text-muted-foreground">Other goals you&apos;re working toward at the same time</span>
          </div>
          {goals.map((g, n) => {
            const goalStop = g.stops[g.stops.length - 1];
            return (
              <div key={g.key} role="group" aria-label={`Goal ${n + 1}`} className="space-y-1.5 rounded-2xl border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Sprout className="size-3.5 text-forest" aria-hidden />
                  <label htmlFor={`from-${g.key}`}>Grows from</label>
                  <select
                    id={`from-${g.key}`}
                    value={stops[forkIndex(g)]?.key}
                    onChange={(e) => setGoal(g.key, (x) => ({ ...x, fromKey: e.target.value }))}
                    className="field field-sm h-7 max-w-[12rem] py-0 text-xs"
                  >
                    {stops.map((s, i) => (
                      <option key={s.key} value={s.key}>
                        {s.label.trim() || `Stop ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setGoals((all) => all.filter((x) => x.key !== g.key))}
                    aria-label={`Remove the goal ${goalStop.label || ""}`.trim()}
                    className="btn btn-ghost btn-icon ml-auto size-7"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
                {g.stops.map((st, j) => {
                  const isGoal = j === g.stops.length - 1;
                  return (
                    <div key={st.key} className="flex items-center gap-2">
                      <span className={`size-2.5 shrink-0 rounded-full border-2 border-forest/50 ${isGoal ? "outline-2 outline-offset-1 outline-forest/25" : ""}`} aria-hidden />
                      <label className="sr-only" htmlFor={`gstop-${st.key}`}>
                        {isGoal ? "The goal" : `Step ${j + 1} toward it`}
                      </label>
                      <input
                        id={`gstop-${st.key}`}
                        value={st.label}
                        maxLength={40}
                        placeholder={isGoal ? "The goal, e.g. Working artist" : "A step toward it"}
                        onChange={(e) =>
                          setGoal(g.key, (x) => ({ ...x, stops: x.stops.map((y) => (y.key === st.key ? { ...y, label: e.target.value } : y)) }))
                        }
                        className="field field-sm flex-1"
                      />
                      {g.stops.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setGoal(g.key, (x) => ({ ...x, stops: x.stops.filter((y) => y.key !== st.key) }))}
                          aria-label={`Remove ${st.label || "this step"}`}
                          className="btn btn-ghost btn-icon size-7"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  );
                })}
                <textarea
                  aria-label={`What ${goalStop.label || "this goal"} means to you`}
                  value={goalStop.note}
                  maxLength={140}
                  rows={1}
                  placeholder="What this goal means to you (optional)"
                  onChange={(e) =>
                    setGoal(g.key, (x) => ({ ...x, stops: x.stops.map((y) => (y.key === goalStop.key ? { ...y, note: e.target.value } : y)) }))
                  }
                  className="field field-sm field-multiline ml-4.5 w-[calc(100%-1.125rem)] resize-y text-xs text-muted-foreground"
                />
                {g.stops.length < ROUTE_LIMITS.maxBranchStops && (
                  <button
                    type="button"
                    onClick={() =>
                      setGoal(g.key, (x) => ({ ...x, stops: [...x.stops.slice(0, -1), { key: `gs${Date.now()}`, label: "", note: "" }, ...x.stops.slice(-1)] }))
                    }
                    className="ml-4.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-forest"
                  >
                    <Plus className="size-3" aria-hidden /> Add a step toward it
                  </button>
                )}
              </div>
            );
          })}
          {goals.length < ROUTE_LIMITS.maxBranches && (
            <button type="button" onClick={() => setGoals((all) => [...all, blankGoal()])} className="btn btn-secondary btn-sm gap-1">
              <Sprout className="size-3.5" aria-hidden /> Add another goal
            </button>
          )}
        </div>
      )}

      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          disabled={busy || incomplete}
          onClick={() =>
            onSave(
              stops.map(({ label, from, note }) => ({ label: label.trim(), from, note: note.trim() || null })),
              branches
                ? goals.map((g) => ({
                    id: g.id,
                    from: forkIndex(g),
                    stops: g.stops.map((st) => ({ label: st.label.trim(), note: st.note.trim() || null })),
                  }))
                : null,
            )
          }
          className="btn btn-primary btn-sm"
        >
          Save my route
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </section>
  );
}
