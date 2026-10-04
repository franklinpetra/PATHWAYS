"use client";

import { ChevronDown, Pencil, Plus, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { RecentWins } from "@/components/dashboard/RecentWins";
import { formatDay } from "@/lib/client/format";
import { formatSourceDate } from "@/lib/workspace/attribution";
import type { PathwayRoute, ProgressEvent, RouteStop } from "@/lib/db/types";
import type { UserAction, WinCandidate } from "@/lib/validation/state-guard";

/**
 * Your Route: one quiet line from where the person stands to where they're going, with their
 * wins as footsteps on the road.
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
  busy: boolean;
  onAction: (actions: UserAction[]) => void;
  onDismissCandidate: (candidate: WinCandidate) => void;
}

type Step =
  | { kind: "win"; key: string; win: ProgressEvent }
  | { kind: "candidate"; key: string; candidate: WinCandidate };

export function YourRoute({ pathwayId, route, wins, candidates, busy, onAction, onDismissCandidate }: YourRouteProps) {
  const [reviewing, setReviewing] = useState(false);
  const [marking, setMarking] = useState<number | null>(null);
  const [selected, setSelected] = useState<Step | null>(null);
  const [showList, setShowList] = useState(false);
  const [editing, setEditing] = useState<"confirmed" | "suggested" | null>(null);
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
    return (
      <RouteEditor
        base={(editing === "confirmed" ? confirmed : suggested)!}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={(next) => {
          onAction([{ type: "set_route_stops", pathwayId, base: editing, stops: next }]);
          setEditing(null);
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
          {confirmed && !showSuggestion && (
            <button type="button" onClick={() => setEditing("confirmed")} aria-label="Edit your route" className="btn btn-ghost btn-icon size-7">
              <Pencil className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {stops ? (
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
                disabled={busy || showSuggestion || i === position}
                onSelect={() => setMarking(i)}
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
          busy={busy}
          onClose={() => setSelected(null)}
          onConfirm={(c) => {
            onAction([
              { type: "record_win", win: { pathwayId: c.pathway_id, eventType: c.event_type, title: c.title, learning: c.learning, stage: c.stage } },
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
      ) : marking !== null && stops ? (
        <p className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="text-muted-foreground">
            You&apos;re at <span className="font-medium text-foreground">{stops[marking].label}</span> now?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onAction([{ type: "set_route_position", pathwayId, position: marking }]);
              setMarking(null);
            }}
            className="btn btn-active btn-sm"
          >
            Yes
          </button>
          <button type="button" onClick={() => setMarking(null)} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        </p>
      ) : null}

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
        aria-label={`${stop.label}${state === "here" ? ", you are here" : state === "passed" ? ", reached" : ""}${disabled ? "" : ". Mark as where you are now"}`}
        className="group flex flex-col items-center rounded-xl px-1 disabled:cursor-default"
      >
        <span className={`relative z-10 size-3.5 rounded-full border-2 transition-transform group-enabled:group-hover:scale-125 ${dot}`} aria-hidden />
        <span className={`mt-1.5 text-xs leading-tight ${state === "here" ? "font-semibold text-foreground" : "font-medium text-foreground/85"}`}>
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
  busy,
  onClose,
  onConfirm,
  onDismiss,
  onFinish,
}: {
  step: Step;
  busy: boolean;
  onClose: () => void;
  onConfirm: (c: WinCandidate) => void;
  onDismiss: (c: WinCandidate) => void;
  onFinish: (w: ProgressEvent) => void;
}) {
  return (
    <div role="group" aria-label="Win" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-dawn-tint px-3 py-2 text-sm">
      {step.kind === "candidate" ? (
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
        </>
      )}
      <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon size-7">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** The person's own version of the route: rename, remove, or add stops. */
function RouteEditor({
  base,
  busy,
  onCancel,
  onSave,
}: {
  base: RouteStop[];
  busy: boolean;
  onCancel: () => void;
  onSave: (stops: { label: string; from: number | null }[]) => void;
}) {
  const [stops, setStops] = useState(base.map((s, i) => ({ label: s.label, from: i as number | null, key: `s${i}` })));
  const canRemove = stops.length > 2;
  const canAdd = stops.length < 6;
  const add = (at: number) => setStops((all) => [...all.slice(0, at), { label: "", from: null, key: `n${Date.now()}` }, ...all.slice(at)]);
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
              <span className={`size-3 shrink-0 rounded-full border-2 ${i === 0 ? "border-dawn bg-dawn" : "border-forest/50"}`} aria-hidden />
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
            {i < stops.length - 1 && canAdd && (
              <button type="button" onClick={() => add(i + 1)} className="ml-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-forest">
                <Plus className="size-3" aria-hidden /> Add a stop here
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          disabled={busy || stops.some((s) => !s.label.trim())}
          onClick={() => onSave(stops.map(({ label, from }) => ({ label: label.trim(), from })))}
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
