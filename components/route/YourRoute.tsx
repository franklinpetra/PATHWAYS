"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { formatSourceDate } from "@/lib/workspace/attribution";
import type { PathwayRoute, RouteStop } from "@/lib/db/types";
import type { UserAction } from "@/lib/validation/state-guard";

/**
 * Your Route: one quiet line from where the person stands to where they're going. Stops
 * passed are forest, "you are here" is the dawn dot, stops ahead are hollow. Pay appears
 * under a stop only when a verified source stated it; gates (exam, license) sit on the line
 * between stops. The AI only suggests a route; the person chooses to use it and moves the
 * dot themselves.
 */

interface YourRouteProps {
  pathwayId: string;
  route: PathwayRoute | null;
  busy: boolean;
  onAction: (actions: UserAction[]) => void;
}

export function YourRoute({ pathwayId, route, busy, onAction }: YourRouteProps) {
  const [reviewing, setReviewing] = useState(false);
  const [marking, setMarking] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const herePosition = route?.position ?? 0;

  // On a narrow screen the route scrolls sideways; keep "you are here" in view.
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>('[aria-current="step"]')?.closest("li");
    if (list && here && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = here.offsetLeft - list.clientWidth / 2 + here.offsetWidth / 2;
    }
  }, [herePosition, route?.confirmed_stops]);
  const confirmed = route?.confirmed_stops?.length ? route.confirmed_stops : null;
  const suggested = route?.suggested_stops?.length ? route.suggested_stops : null;
  if (!confirmed && !suggested) return null;

  // A suggestion is shown on its own until a route is chosen, or on request after that.
  const showSuggestion = !!suggested && (!confirmed || reviewing);
  const stops = showSuggestion ? suggested! : confirmed!;
  const position = showSuggestion ? -1 : Math.min(route!.position, stops.length - 1);

  return (
    <section aria-label={showSuggestion ? "Suggested route" : "Your route"} className="mb-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="eyebrow">{showSuggestion ? "Suggested route" : "Your route"}</h2>
        {confirmed && suggested && !reviewing && (
          <button type="button" onClick={() => setReviewing(true)} className="text-xs text-dawn hover:underline">
            Updated route suggested
          </button>
        )}
      </div>

      <ol
        ref={listRef}
        className="relative -mx-gutter flex items-start overflow-x-auto overflow-y-hidden px-gutter pt-3 pb-1 [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none] lg:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {stops.map((stop, i) => (
          <Fragment key={`${i}-${stop.label}`}>
            {i > 0 && <Connector gate={stop.gate} passed={i <= position} dashed={showSuggestion} />}
            <Stop
              stop={stop}
              state={showSuggestion ? "suggested" : i < position ? "passed" : i === position ? "here" : "ahead"}
              disabled={busy || showSuggestion || i === position}
              onSelect={() => setMarking(i)}
            />
          </Fragment>
        ))}
      </ol>

      {showSuggestion ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onAction([{ type: "accept_route", pathwayId }]);
              setReviewing(false);
            }}
            className="btn btn-active btn-sm"
          >
            Use this route
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmed ? setReviewing(false) : onAction([{ type: "dismiss_route", pathwayId }]))}
            className="btn btn-ghost btn-sm"
          >
            {confirmed ? "Keep my route" : "Not now"}
          </button>
          {confirmed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onAction([{ type: "dismiss_route", pathwayId }]);
                setReviewing(false);
              }}
              className="btn btn-ghost btn-sm"
            >
              Dismiss
            </button>
          )}
        </div>
      ) : marking !== null ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
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
    </section>
  );
}

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
        <span className={`relative z-10 size-3 rounded-full border-2 transition-transform group-enabled:group-hover:scale-125 ${dot}`} aria-hidden />
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

function Connector({ gate, passed, dashed }: { gate: string | null; passed: boolean; dashed: boolean }) {
  return (
    // Reaches under the neighboring stops so the line runs continuously from dot to dot.
    <li aria-hidden className="relative -mx-10 mt-[5px] min-w-[8.5rem] flex-1 sm:-mx-[3.125rem] sm:min-w-[7.5rem]">
      <span
        className={`block border-t-2 ${passed ? "border-forest" : "border-forest/30"} ${dashed || !passed ? "border-dashed" : ""}`}
      />
      {gate && (
        <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 px-1.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase">
          {gate}
        </span>
      )}
    </li>
  );
}
