"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageText } from "@/components/chat/MessageText";
import { MessageToolbar, PlaceActions } from "@/components/chat/PlaceToolbar";
import { SourceList, citationAnchor } from "@/components/chat/SourceList";
import { SuggestedTopics } from "@/components/chat/SuggestedTopics";
import { VoiceBar } from "@/components/chat/VoiceBar";
import { useVoiceConversation } from "@/components/chat/useVoiceConversation";
import { NextSteps } from "@/components/dashboard/NextSteps";
import { YourRoute } from "@/components/route/YourRoute";
import { postWorkspaceActions, streamChatTurn } from "@/lib/client/api";
import type { Action, Pathway, PathwayRoute, ProgressEvent } from "@/lib/db/types";
import type { UserAction, WinCandidate } from "@/lib/validation/state-guard";
import type { Citation, VerifiedPlace } from "@/lib/workspace/events";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error";
  /** A stored reply that was stopped or failed partway. */
  interrupted?: boolean;
  places?: VerifiedPlace[];
  citations?: Citation[];
  /** Figures in the reply that matched no verified source. */
  unverifiedFigures?: string[];
  /** The person spoke this message. */
  viaVoice?: boolean;
}

interface WorkspaceProps {
  pathway: Pathway;
  initialSteps: Action[];
  initialWins: ProgressEvent[];
  initialRoute: PathwayRoute | null;
  initialTopics: string[];
  /** A place sent from another device via the handoff link. */
  sharedPlace: { query: string; label: string | null } | null;
  /** The stored thread, oldest first. */
  initialMessages: Message[];
}

const WIDE = "(min-width: 1024px)";

/** Whether the sidebar layout applies; null until known on the client, so the plan renders in exactly one place. */
function useWide(): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => null,
  );
}

export function Workspace({ pathway, initialSteps, initialWins, initialRoute, initialTopics, sharedPlace, initialMessages }: WorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [topics, setTopics] = useState(initialTopics);
  const [steps, setSteps] = useState(initialSteps);
  const [wins, setWins] = useState(initialWins);
  const [route, setRoute] = useState(initialRoute);
  const [candidates, setCandidates] = useState<WinCandidate[]>([]);
  const [panelBusy, setPanelBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const wide = useWide();
  const abortRef = useRef<AbortController | null>(null);

  const streaming = messages.some((m) => m.status === "streaming");

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateMessage = useCallback((id: string, update: (m: Message) => Message) => {
    setMessages((all) => all.map((m) => (m.id === id ? update(m) : m)));
  }, []);

  async function send(text: string, viaVoice = false) {
    if (streaming) return;
    const assistantId = crypto.randomUUID();
    setMessages((all) => [
      ...all,
      { id: crypto.randomUUID(), role: "user", content: text, status: "done", viaVoice },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);
    setTopics([]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChatTurn(
        { message: text, pathwayId: pathway.id, voice: viaVoice },
        (event) => {
          switch (event.type) {
            case "text":
              updateMessage(assistantId, (m) => ({ ...m, content: m.content + event.delta }));
              break;
            case "citations":
              updateMessage(assistantId, (m) => ({ ...m, citations: event.items }));
              break;
            case "grounding":
              updateMessage(assistantId, (m) => ({ ...m, unverifiedFigures: event.unverifiedFigures }));
              break;
            case "places":
              updateMessage(assistantId, (m) => ({ ...m, places: event.items }));
              break;
            case "topics":
              setTopics(event.items);
              break;
            case "next_steps":
              setSteps(event.items);
              break;
            case "wins":
              setWins(event.recent);
              setCandidates(event.candidates);
              break;
            case "spoken":
              voice.say(event.text);
              break;
            case "route":
              setRoute(event.route);
              break;
            case "error":
              updateMessage(assistantId, (m) => ({ ...m, status: "error", content: m.content || event.message }));
              break;
            case "done":
              updateMessage(assistantId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
              break;
          }
        },
        controller.signal,
      );
      updateMessage(assistantId, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
    } catch (err) {
      const aborted = controller.signal.aborted;
      updateMessage(assistantId, (m) => ({
        ...m,
        status: aborted && m.content ? "done" : "error",
        content: m.content || (aborted ? "Stopped." : (err as Error).message),
      }));
    } finally {
      abortRef.current = null;
    }
  }

  async function runActions(actions: UserAction[], optimistic?: Action[]) {
    const previous = steps;
    if (optimistic) setSteps(optimistic);
    setPanelBusy(true);
    setNotice(null);
    try {
      const result = await postWorkspaceActions(pathway.id, actions);
      setSteps(result.nextSteps);
      setWins(result.recentWins);
      setRoute(result.route);
      if (result.rejected > 0) setNotice("That change couldn't be saved. Try rephrasing or refreshing.");
    } catch (err) {
      setSteps(previous);
      setNotice((err as Error).message);
    } finally {
      setPanelBusy(false);
    }
  }

  const voice = useVoiceConversation({ pathwayId: pathway.id, send: (text) => send(text, true) });

  const empty = messages.length === 0 && !sharedPlace;

  // One plan, shown in the sidebar on wide screens and in a fold-out panel on phones.
  const plan = (
    <>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <NextSteps pathwayId={pathway.id} steps={steps} busy={panelBusy} onAction={runActions} />
    </>
  );

  // Your Route with its footsteps: the big picture, kept at the top on every screen.
  const journey = (
    <div className="mb-4 border-b border-border pb-3">
      <YourRoute
        pathwayId={pathway.id}
        route={route}
        wins={wins}
        candidates={candidates}
        steps={steps}
        busy={panelBusy}
        onAction={(actions) => runActions(actions)}
        onDismissCandidate={(c) => setCandidates((all) => all.filter((x) => x !== c))}
      />
    </div>
  );
  const hasJourney = !!(route?.confirmed_stops?.length || route?.suggested_stops?.length || wins.some((w) => w.pathway_id === pathway.id) || candidates.length);

  const planCount = steps.length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-gutter pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <section aria-label="Conversation" className="flex flex-col lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)]">
        <div className="flex items-end justify-between gap-3 pt-5 pb-4 lg:pt-8 lg:pb-5">
          <div className="min-w-0">
            <h1 className="display-xs">{pathway.title}</h1>
            {pathway.current_question && <p className="mt-0.5 text-sm text-muted-foreground">{pathway.current_question}</p>}
          </div>
          {/* Phones: the plan folds into one button here instead of trailing the whole conversation. */}
          <button
            type="button"
            onClick={() => setPlanOpen((o) => !o)}
            aria-expanded={planOpen}
            aria-controls="your-plan"
            className={`btn btn-sm shrink-0 lg:hidden ${planOpen ? "btn-active" : "btn-secondary"}`}
          >
            Your plan
            {planCount > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-dawn text-[11px] font-semibold text-white">{planCount}</span>
            )}
          </button>
        </div>

        {hasJourney && journey}

        <aside
          id="your-plan"
          aria-label="Your plan"
          hidden={!planOpen}
          className="mb-4 space-y-3 lg:hidden"
        >
          {wide === false && plan}
        </aside>

        {/* An empty conversation centers the prompt and composer; once it starts, the composer docks below. */}
        <div className={empty ? "space-y-6 lg:my-auto lg:pb-24" : "contents"}>
          <Thread messages={messages} pathwayId={pathway.id} sharedPlace={sharedPlace} pathwayTitle={pathway.title} />

          <div
            className={
              empty
                ? "space-y-3"
                : "sticky bottom-0 -mx-gutter space-y-3 bg-background px-gutter pt-3 pb-4 lg:static lg:mx-0 lg:px-0"
            }
          >
            <SuggestedTopics topics={topics} disabled={streaming} onPick={(topic) => send(topic)} />
            <VoiceBar state={voice.state} notice={voice.notice} onFinishTurn={voice.finishTurn} onEnd={voice.end} />
            <Composer
              streaming={streaming}
              onSend={(text) => send(text)}
              onStop={() => abortRef.current?.abort()}
              voice={{ supported: voice.supported, active: voice.state !== "off", onStart: () => void voice.start() }}
            />
          </div>
        </div>
      </section>

      <aside aria-label="Your plan" className="hidden space-y-4 lg:block lg:pt-8 lg:pb-8">
        {wide && plan}
      </aside>
    </main>
  );
}

function Thread({
  messages,
  pathwayId,
  pathwayTitle,
  sharedPlace,
}: {
  messages: Message[];
  pathwayId: string;
  pathwayTitle: string;
  sharedPlace: WorkspaceProps["sharedPlace"];
}) {
  // Each exchange starts at the top: the person's latest message is scrolled to the top edge and the
  // reply grows below it, so nothing half-hidden sits at the edge and the answer reads from its start.
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;
  useEffect(() => {
    if (!lastUserId) return;
    document.querySelector(`[data-message-id="${lastUserId}"]`)?.scrollIntoView({ block: "start" });
  }, [lastUserId]);

  const last = messages[messages.length - 1];

  return (
    <div className={messages.length || sharedPlace
          ? "flex-1 space-y-6 lg:overflow-y-auto lg:pt-4 lg:pr-2 lg:[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]"
          : ""} aria-busy={last?.status === "streaming"}>
      {sharedPlace && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Sent from your other device</p>
          <PlaceActions place={{ label: sharedPlace.label, query: sharedPlace.query }} pathwayId={pathwayId} allowHandoff={false} />
        </div>
      )}

      {messages.length === 0 && (
        <p className="text-muted-foreground">
          What&apos;s on your mind about {pathwayTitle.toLowerCase()}? Start anywhere, or pick a suggestion below.
        </p>
      )}

      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} data-message-id={m.id} className="flex scroll-mt-24 items-end justify-end gap-1.5 lg:scroll-mt-4">
            {m.viaVoice && <Mic className="mb-2 size-3.5 shrink-0 text-muted-foreground" aria-label="Spoken" />}
            <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-person px-4 py-2.5 text-[15px] leading-relaxed text-white">
              {m.content}
            </p>
          </div>
        ) : (
          <AssistantMessage key={m.id} message={m} pathwayId={pathwayId} />
        ),
      )}
      {/* Room below the last reply so the latest exchange can scroll to the top. */}
      <div className="h-[40vh]" aria-hidden />
    </div>
  );
}

function AssistantMessage({ message: m, pathwayId }: { message: Message; pathwayId: string }) {
  const citations = useMemo(() => m.citations ?? [], [m.citations]);
  const citable = useMemo(() => new Set(citations.map((c) => c.index)), [citations]);
  const [openSources, setOpenSources] = useState<ReadonlySet<number>>(new Set());

  function toggle(index: number, open: boolean) {
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (open) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function showSource(index: number) {
    toggle(index, true);
    requestAnimationFrame(() =>
      document.getElementById(citationAnchor(m.id, index))?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  return (
    <article className="max-w-prose text-[15px] leading-relaxed">
      {m.content ? (
        <MessageText text={m.content} citable={citable} onCite={showSource} />
      ) : (
        <Pending />
      )}
      {m.interrupted && <p className="mt-2 text-xs text-muted-foreground">This reply was cut short.</p>}
      {(m.unverifiedFigures?.length ?? 0) > 0 && (
        <p role="note" className="notice mt-3 border-dashed text-xs">
          Not verified: {m.unverifiedFigures!.join(", ")} didn&apos;t match any source Pathways checked. Treat{" "}
          {m.unverifiedFigures!.length === 1 ? "it" : "them"} as unconfirmed.
        </p>
      )}
      {m.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          Something interrupted this reply.
        </p>
      )}
      {m.status === "done" && <MessageToolbar text={m.content} verified={m.places} pathwayId={pathwayId} />}
      {m.status !== "streaming" && <SourceList messageId={m.id} citations={citations} open={openSources} onToggle={toggle} />}
    </article>
  );
}

/** Waiting copy that advances while sources are looked up, so a longer wait never looks frozen. */
const PENDING_STAGES = [
  { after: 0, text: "Thinking…" },
  { after: 3, text: "Looking into this for Washington…" },
  { after: 12, text: "Checking the details…" },
  { after: 22, text: "Putting your plan together…" },
] as const;

function Pending() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const stage = PENDING_STAGES.findLast((s) => seconds >= s.after) ?? PENDING_STAGES[0];
  return (
    <p className="text-muted-foreground" role="status" aria-live="polite">
      <span className="inline-block animate-pulse">{stage.text}</span>
    </p>
  );
}
