"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDay } from "@/lib/client/format";
import { formatSourceDate } from "@/lib/workspace/attribution";
import type { Action, ProgressEvent, RouteBranch, RouteStop } from "@/lib/db/types";
import type { WinCandidate } from "@/lib/validation/state-guard";

/**
 * Your Route as a living map: the trunk winds from where the person has been, through
 * "you are here", to their main goal; each other goal they pursue grows from the trunk as its
 * own branch, fanning out like the goals at the end of a long road.
 *
 *  - Wins are leaves on the branch they grew on: filled when done, outlined when under way,
 *    dashed and breathing when PATHWAYS spotted one and it waits for the person's tap.
 *  - Open next steps are small points of light on the road just ahead.
 *  - Everything is drawn from the person's own route; nothing here is decided for them.
 */

export type MapItem =
  | { kind: "win"; key: string; win: ProgressEvent }
  | { kind: "candidate"; key: string; candidate: WinCandidate }
  | { kind: "light"; key: string; step: Action };

export interface MapStopRef {
  branch: string | null;
  index: number;
}

interface RouteMapProps {
  trunk: RouteStop[];
  position: number;
  branches: RouteBranch[];
  wins: ProgressEvent[];
  candidates: WinCandidate[];
  steps: Action[];
  selected: string | null;
  isNew: (key: string) => boolean;
  disabled: boolean;
  onSelectItem: (item: MapItem) => void;
  onSelectStop: (stop: MapStopRef) => void;
}

/** Column width stretches to fill the space, within these bounds. */
const COL_MIN = 104;
const COL_MAX = 176;
const PAD_X = 60;
const TOP_ROOM = 34;
/** Room under the lowest dot for a three-line label. */
const BOTTOM_ROOM = 64;
/** Room under the trunk for its two-line labels. */
const TRUNK_LABEL_ROOM = 38;
/** Room to the right of a branch's goal for its label. */
const RIGHT_LABEL_ROOM = 150;
/** Up, down, then further up and further down: the goals fan out around the trunk. */
const LANES = [-1, 1, -2, 2];
const MAX_LEAVES = 7;

type Pt = { x: number; y: number };
type Seg = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

/** A small, stable wobble so the same route always draws the same way. */
function wobble(seed: string, n: number, amount: number) {
  let h = 2166136261;
  for (const ch of `${seed}:${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * amount;
}

function segment(p0: Pt, p1: Pt, seed: string): Seg {
  const dx = p1.x - p0.x;
  return {
    p0,
    c1: { x: p0.x + dx * 0.5, y: p0.y + wobble(seed, 1, 7) },
    c2: { x: p1.x - dx * 0.5, y: p1.y + wobble(seed, 2, 7) },
    p1,
  };
}

function at(s: Seg, t: number) {
  const u = 1 - t;
  const x = u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p1.x;
  const y = u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y;
  const dx = 3 * u * u * (s.c1.x - s.p0.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p1.x - s.c2.x);
  const dy = 3 * u * u * (s.c1.y - s.p0.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p1.y - s.c2.y);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

const pathOf = (s: Seg) => `M${s.p0.x},${s.p0.y} C${s.c1.x},${s.c1.y} ${s.c2.x},${s.c2.y} ${s.p1.x},${s.p1.y}`;

/** A soft closed shape around the whole map: the life the routes run through. */
function blob(minX: number, maxX: number, minY: number, maxY: number) {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const n = 12;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = 1 - Math.abs(wobble("blob", i, 0.08));
    return { x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r };
  });
  // Closed Catmull-Rom through the points, as cubic curves.
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return `${d}Z`;
}

interface Node {
  ref: MapStopRef;
  stop: RouteStop;
  at: Pt;
  state: "passed" | "here" | "ahead" | "branch";
  goal: boolean;
  /**
   * Where the label hangs: above the dot on branches rising above the trunk, below it otherwise,
   * and to the right at the end of a branch, like a sign at the end of a road.
   */
  place: "above" | "below" | "right";
}

/**
 * Each branch's lane. Goals that fork later take the inner lanes, so a branch growing from
 * further along never has to cross one that grew earlier.
 */
function lanesOf(branches: RouteBranch[]) {
  const order = branches.map((b, k) => ({ id: b.id, from: b.from, k })).sort((a, b) => b.from - a.from || a.k - b.k);
  return new Map(order.map((b, rank) => [b.id, LANES[rank % LANES.length]]));
}

/** How many columns wide the map is, before choosing a column width. */
function spanOf(trunk: RouteStop[], branches: RouteBranch[]) {
  const lanes = lanesOf(branches);
  return Math.max(
    trunk.length - 1,
    ...branches.map((b) => Math.min(b.from, trunk.length - 1) + b.stops.length * 0.92 + Math.abs(lanes.get(b.id)!) * 0.09),
    1,
  );
}

function layout(trunk: RouteStop[], position: number, branches: RouteBranch[], COL: number, LANE: number, OUTER: number) {
  const lanes = lanesOf(branches);
  const trunkPts = trunk.map((_, i) => ({ x: PAD_X + i * COL, y: wobble("trunk", i, 6) }));
  const nodes: Node[] = trunk.map((stop, i) => ({
    ref: { branch: null, index: i },
    stop,
    at: trunkPts[i],
    state: i < position ? "passed" : i === position ? "here" : "ahead",
    goal: i === trunk.length - 1,
    place: "below",
  }));
  const trunkSegs = trunkPts.slice(1).map((p, i) => segment(trunkPts[i], p, `t${i}`));

  const branchSegs = new Map<string, Seg[]>();
  branches.forEach((b) => {
    const lane = lanes.get(b.id)!;
    const root = trunkPts[Math.min(b.from, trunkPts.length - 1)];
    const pts = b.stops.map((_, j) => {
      // Rise gradually away from the trunk, then settle on the branch's own line.
      const rise = 0.55 + (0.45 * (j + 1)) / b.stops.length;
      // Branches below the trunk drop further, clearing the trunk's own labels.
      const clear = lane > 0 ? TRUNK_LABEL_ROOM : 0;
      return { x: root.x + (j + 1) * COL * 0.92 + Math.abs(lane) * 10, y: Math.sign(lane) * (LANE * rise + (Math.abs(lane) - 1) * OUTER) + clear + wobble(b.id, j, 5) };
    });
    const all = [root, ...pts];
    branchSegs.set(
      b.id,
      pts.map((p, j) => segment(all[j], p, `${b.id}${j}`)),
    );
    b.stops.forEach((stop, j) =>
      nodes.push({ ref: { branch: b.id, index: j }, stop, at: pts[j], state: "branch", goal: j === b.stops.length - 1,
        place: j === b.stops.length - 1 ? "right" : lane < 0 ? "above" : "below",
      }),
    );
  });

  const ys = nodes.map((n) => n.at.y);
  // Labels above a dot can run to three lines.
  const minY = Math.min(...ys) - (nodes.some((n) => n.place === "above") ? BOTTOM_ROOM : TOP_ROOM);
  const maxY = Math.max(...ys) + BOTTOM_ROOM;
  const width = Math.max(...nodes.map((n) => n.at.x + (n.place === "right" ? RIGHT_LABEL_ROOM : PAD_X)));
  return { nodes, trunkSegs, branchSegs, minY, maxY, width };
}

/** Spread n items along a segment between t = from and t = to. */
const spread = (n: number, from: number, to: number) => Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / (n + 1));

export function RouteMap({ trunk, position, branches, wins, candidates, steps, selected, isNew, disabled, onSelectItem, onSelectStop }: RouteMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ key: string; text: string; x: number; y: number } | null>(null);
  // The map fills the width it's given; on a phone it keeps a readable size and scrolls sideways.
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = avail > 0 && avail < 640;
  const col = Math.min(COL_MAX, Math.max(COL_MIN, avail ? (avail - 2 * PAD_X) / spanOf(trunk, branches) : COL_MIN));
  const { nodes, trunkSegs, branchSegs, minY, maxY, width } = layout(trunk, position, branches, col, narrow ? 50 : 60, narrow ? 62 : 70);
  const height = maxY - minY;
  const Y = (y: number) => y - minY;
  const last = trunk.length - 1;
  const known = new Set(branches.map((b) => b.id));

  // On a narrow screen the map scrolls sideways; keep "you are here" in view.
  const hereX = nodes.find((n) => n.state === "here")?.at.x ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = hereX - el.clientWidth / 2;
  }, [hereX]);

  // Leaves, by the path they grew on.
  const onTrunk = (stop: number | null) => Math.min(Math.max(stop ?? 0, 0), Math.max(last - 1, 0));
  const leafItems = new Map<string, MapItem[]>();
  const put = (path: string, item: MapItem) => leafItems.set(path, [...(leafItems.get(path) ?? []), item]);
  for (const win of [...wins].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (win.route_branch && known.has(win.route_branch)) put(win.route_branch, { kind: "win", key: win.id, win });
    else put(`t${onTrunk(win.route_stop)}`, { kind: "win", key: win.id, win });
  }
  for (const c of candidates) {
    put(c.branch && known.has(c.branch) ? c.branch : `t${onTrunk(position)}`, { kind: "candidate", key: c.title, candidate: c });
  }
  const herePath = `t${onTrunk(position)}`;
  const lights = steps.filter((s) => s.status === "suggested" || s.status === "user_selected").slice(0, 5);

  type Placed = { item: MapItem; x: number; y: number; angle: number; side: number };
  const placed: Placed[] = [];
  const hidden: { path: string; count: number; x: number; y: number }[] = [];
  const pathSegs = (path: string) => (path.startsWith("t") ? [trunkSegs[Number(path.slice(1))]].filter(Boolean) : (branchSegs.get(path) ?? []));
  for (const [path, items] of leafItems) {
    const segs = pathSegs(path);
    if (!segs.length) continue;
    const visible = items.slice(-MAX_LEAVES);
    // On the stretch "you are here" sits on, leaves keep to the first part; lights shine ahead.
    const end = path === herePath && lights.length ? 0.5 : 0.88;
    // Leaves spread along the whole branch, stopping short of its goal; reaching it is the person's call.
    const reach = segs.length > 1 ? segs.length - 0.25 : end;
    spread(visible.length, 0.1, reach).forEach((t, k) => {
      const seg = Math.min(Math.floor(t), segs.length - 1);
      const p = at(segs[seg], t - seg);
      placed.push({ item: visible[k], ...p, side: k % 2 === 0 ? -1 : 1 });
    });
    if (items.length > visible.length) {
      const p = at(segs[0], 0.06);
      hidden.push({ path, count: items.length - visible.length, x: p.x, y: p.y });
    }
  }
  if (trunkSegs.length) {
    const seg = trunkSegs[onTrunk(position)];
    const hasLeaves = (leafItems.get(herePath)?.length ?? 0) > 0;
    spread(lights.length, hasLeaves ? 0.5 : 0.2, 0.98).forEach((t, k) => {
      const p = at(seg, t);
      placed.push({ item: { kind: "light", key: `step-${lights[k].id}`, step: lights[k] }, ...p, side: 0 });
    });
  }

  // Faint, unlabeled glints along the roads not yet travelled: the many small moments to come.
  const glints: Pt[] = [];
  trunkSegs.forEach((s, i) => {
    if (i <= position) return;
    for (const t of [0.3, 0.7]) glints.push(at(s, t + wobble(`g${i}`, t, 0.08)));
  });
  for (const [id, segs] of branchSegs) segs.forEach((s, j) => glints.push(at(s, 0.5 + wobble(`${id}g`, j, 0.15))));

  const show = (key: string, text: string, x: number, y: number) => setTip({ key, text, x, y });
  const hide = (key: string) => setTip((t) => (t?.key === key ? null : t));

  return (
    <div
      ref={scroller}
      className="-mx-gutter overflow-x-auto overflow-y-hidden px-gutter [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
    >
      <div role="group" aria-label="Your route map" className="relative mx-auto" style={{ width, height }}>
        <svg aria-hidden width={width} height={height} viewBox={`0 ${minY} ${width} ${height}`} className="absolute inset-0 overflow-visible">
          <defs>
            <radialGradient id="route-life" cx="35%" cy="50%" r="75%">
              <stop offset="0%" stopColor="var(--color-leaf)" stopOpacity="0.10" />
              <stop offset="70%" stopColor="var(--color-leaf)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--color-dawn)" stopOpacity="0.03" />
            </radialGradient>
          </defs>
          <path d={blob(8, width - 8, minY + 6, maxY - 4)} fill="url(#route-life)" />

          {[...branchSegs.values()].flat().map((s, i) => (
            <path key={`b${i}`} d={pathOf(s)} fill="none" stroke="var(--color-forest)" strokeOpacity="0.38" strokeWidth="1.75" strokeLinecap="round" />
          ))}
          {trunkSegs.map((s, i) => (
            <path
              key={`t${i}`}
              d={pathOf(s)}
              fill="none"
              stroke="var(--color-forest)"
              strokeOpacity={i < position ? 1 : 0.4}
              strokeWidth={i < position ? 2.5 : 2}
              strokeDasharray={i < position ? undefined : "5 5"}
              strokeLinecap="round"
            />
          ))}
          {glints.map((g, i) => (
            <circle key={i} cx={g.x} cy={g.y} r="1.6" fill="var(--color-leaf)" opacity="0.55" />
          ))}
        </svg>

        {/* Gates sit on the trunk, toward the stop they lead to. */}
        {trunkSegs.map((s, i) => {
          const gate = trunk[i + 1]?.gate;
          if (!gate) return null;
          const p = at(s, 0.78);
          return (
            <span
              key={`gate${i}`}
              aria-hidden
              style={{ left: p.x, top: Y(p.y) - 22 }}
              className="absolute -translate-x-1/2 text-[10px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
            >
              {gate}
            </span>
          );
        })}

        {nodes.map((n) => (
          <StopNode key={`${n.ref.branch ?? "t"}-${n.ref.index}`} node={n} top={Y(n.at.y)} disabled={disabled} onSelect={() => onSelectStop(n.ref)} />
        ))}

        {hidden.map((h) => (
          <span
            key={`more-${h.path}`}
            aria-hidden
            style={{ left: h.x, top: Y(h.y) - 16 }}
            className="absolute -translate-x-1/2 text-[10px] font-semibold text-forest tabular-nums"
          >
            +{h.count}
          </span>
        ))}

        {placed.map(({ item, x, y, angle, side }) => {
          const text = describe(item);
          return (
            <button
              key={item.key}
              type="button"
              aria-label={text.label}
              onClick={() => onSelectItem(item)}
              onMouseEnter={() => show(item.key, text.tip, x, Y(y))}
              onMouseLeave={() => hide(item.key)}
              onFocus={() => show(item.key, text.tip, x, Y(y))}
              onBlur={() => hide(item.key)}
              style={{ left: x, top: Y(y) }}
              className={`group absolute z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-forest ${selected === item.key ? "bg-forest/10" : ""}`}
            >
              {item.kind === "light" ? (
                <Light step={item.step} />
              ) : (
                <Leaf item={item} angle={angle + side * 52} fresh={isNew(item.key)} />
              )}
            </button>
          );
        })}

        {tip && (
          <div
            role="tooltip"
            style={{ left: Math.min(Math.max(tip.x, 110), width - 110), top: tip.y - 18 }}
            className="pointer-events-none absolute z-20 w-max max-w-[13rem] -translate-x-1/2 -translate-y-full rounded-xl bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-sm"
          >
            {tip.text}
          </div>
        )}
      </div>
    </div>
  );
}

function describe(item: MapItem): { label: string; tip: string } {
  if (item.kind === "candidate") {
    const t = item.candidate.title;
    return { label: `Spotted a win: ${t}. Tap to add it`, tip: `${item.candidate.stage === "underway" ? "Sounds like you've started" : "Sounds like a win"}: ${t}. Tap to add it.` };
  }
  if (item.kind === "light") {
    const s = item.step;
    return { label: `Next step: ${s.title}`, tip: `Next step: ${s.title}${s.due_at ? ` (by ${formatDay(s.due_at)})` : ""}` };
  }
  const w = item.win;
  const when = w.stage === "underway" ? "Under way" : formatDay(w.occurred_at);
  return { label: `${w.stage === "underway" ? "Under way" : "Win"}: ${w.title}`, tip: `${when}: ${w.title}` };
}

function StopNode({ node, top, disabled, onSelect }: { node: Node; top: number; disabled: boolean; onSelect: () => void }) {
  const { stop, state, goal, place } = node;
  const dot = {
    passed: "border-forest bg-forest",
    here: "border-dawn bg-dawn shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-dawn)_18%,transparent)]",
    ahead: "border-forest/55 bg-surface",
    branch: "border-forest/50 bg-surface",
  }[state];
  const ring = goal && state !== "here" ? "outline-2 outline-offset-2 outline-forest/25" : "";
  const source = stop.paySource
    ? `${stop.paySource.name}, ${stop.paySource.verificationAuthority}, as of ${formatSourceDate(stop.paySource.asOf)}`
    : undefined;
  const label = (
    <span className={`flex flex-col ${place === "right" ? "items-start" : "items-center"}`}>
      <span
        className={`${place === "right" ? "max-w-[8.5rem] text-left" : "max-w-[6.5rem] text-center"} text-xs leading-tight [text-wrap:balance] ${state === "here" ? "font-semibold text-foreground" : goal ? "font-semibold text-forest" : "font-medium text-foreground/85"} ${stop.note ? "underline decoration-dawn/50 decoration-dotted underline-offset-[3px]" : ""}`}
      >
        {stop.label}
      </span>
      {stop.pay && (
        <span title={source} className="mt-0.5 text-[11px] text-forest tabular-nums">
          {stop.pay}
          {source && <span className="sr-only"> (source: {source})</span>}
        </span>
      )}
    </span>
  );
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-current={state === "here" ? "step" : undefined}
      aria-label={`${stop.label}${state === "here" ? ", you are here" : state === "passed" ? ", reached" : ""}${goal ? ", a goal" : ""}${stop.note ? `. Note: ${stop.note}` : ""}`}
      style={{ left: node.at.x, top }}
      // The dot (14px, after 4px of padding) sits exactly on its point on the map; the label hangs off it.
      className={`group absolute z-10 flex items-center gap-1.5 rounded-xl px-1 disabled:cursor-default ${
        place === "right"
          ? "-translate-x-[11px] -translate-y-1/2 flex-row"
          : place === "above"
            ? "-translate-x-1/2 -translate-y-[calc(100%-7px)] flex-col-reverse"
            : "-translate-x-1/2 -translate-y-[7px] flex-col"
      }`}
    >
      <span className={`relative size-3.5 shrink-0 rounded-full border-2 transition-transform group-enabled:group-hover:scale-125 ${dot} ${ring}`} aria-hidden />
      <span className="[text-shadow:0_0_3px_var(--color-background),0_0_6px_var(--color-background),0_0_10px_var(--color-background)]">{label}</span>
    </button>
  );
}

function Leaf({ item, angle, fresh }: { item: Exclude<MapItem, { kind: "light" }>; angle: number; fresh: boolean }) {
  const look =
    item.kind === "candidate"
      ? { fill: "var(--color-surface)", stroke: "var(--color-dawn)", dash: "2 1.6", vein: "var(--color-dawn)" }
      : item.win.stage === "underway"
        ? { fill: "var(--color-surface)", stroke: "var(--color-forest)", dash: undefined, vein: "var(--color-forest)" }
        : { fill: "var(--color-leaf)", stroke: "var(--color-forest)", dash: undefined, vein: "var(--color-forest)" };
  return (
    <svg
      viewBox="-12 -12 24 24"
      aria-hidden
      className={`size-6 overflow-visible transition-transform group-hover:scale-125 ${fresh ? "motion-safe:animate-leaf-in" : ""} ${item.kind === "candidate" ? "motion-safe:animate-pulse" : ""}`}
    >
      {/* The leaf grows from the vine at the center, turned off the branch's direction. */}
      <g transform={`rotate(${angle.toFixed(1)})`}>
        <path d="M0 0 L2.2 0" stroke="var(--color-forest)" strokeOpacity="0.6" strokeWidth="1" />
        <path d="M1.6 0 C4 -4.6 8.6 -5 11.4 0 C8.6 5 4 4.6 1.6 0Z" fill={look.fill} stroke={look.stroke} strokeWidth="1.1" strokeDasharray={look.dash} strokeLinejoin="round" />
        <path d="M2.6 0 Q6.5 -0.6 10 0" fill="none" stroke={look.vein} strokeOpacity="0.55" strokeWidth="0.7" />
      </g>
    </svg>
  );
}

function Light({ step }: { step: Action }) {
  const chosen = step.status === "user_selected";
  return (
    <span
      aria-hidden
      style={{ "--glow": chosen ? "45%" : "28%" } as CSSProperties}
      className={`block size-[7px] rounded-full border border-dawn/70 shadow-[0_0_7px_3px_color-mix(in_srgb,var(--color-dawn)_var(--glow),transparent)] transition-transform group-hover:scale-150 motion-safe:animate-glimmer ${chosen ? "bg-dawn" : "bg-surface"}`}
    />
  );
}
