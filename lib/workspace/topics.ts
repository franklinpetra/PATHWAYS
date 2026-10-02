import type { Pathway, ReadinessState } from "@/lib/db/types";

/** Opening topics before the conversation has produced its own, keyed to where the person is. */
const BY_READINESS: Record<ReadinessState, string[]> = {
  exploring: ["What does a typical day look like?", "What draws me to this?", "Programs near me"],
  evaluating: ["Compare my options", "What would this take, realistically?", "Who could I talk to in this field?"],
  acting: ["What's my very next move?", "Help me prepare an application", "Questions to ask an advisor"],
  returning: ["Where did I leave off?", "What's changed since last time?", "Pick up a next step"],
};

export function initialTopics(pathway: Pathway): string[] {
  const topics = [...BY_READINESS[pathway.readiness_state]];
  if (pathway.current_question) topics.unshift(pathway.current_question);
  return topics.slice(0, 3);
}

export function sanitizeTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  return topics
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length <= 80 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 3);
}
