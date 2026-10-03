/**
 * Multi-AI comparison: answers each case in evals/cases.ts with PATHWAYS and with general
 * assistants, then has judges from two different labs grade the answers blind.
 *
 *   npm run eval [-- --case pharmacy --case cdl]
 *
 * PATHWAYS runs its real first-turn pipeline (Fact-Finder, system prompt, chat model from
 * PATHWAYS_CHAT_MODEL). The other assistants run through OpenRouter with web search on, an
 * approximation of their consumer apps. Judges see answers labeled A-D in shuffled order,
 * never which system wrote them. Judges are Claude and Gemini, so any self-preference
 * favors a competitor, never PATHWAYS.
 *
 * Writes evals/results/<timestamp>/report.md, results.json, and every answer. Needs
 * OPENROUTER_API_KEY and database access (.env.local). Costs a few dollars per full run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CASES, type EvalCase } from "../evals/cases";
import { generateStructured, streamChat } from "../lib/ai/openrouter";
import { buildSystemPrompt } from "../lib/agents/prompt";
import { findFacts } from "../lib/agents/retrieval";
import { traceClaims } from "../lib/workspace/attribution";

const COMPETITORS = [
  { name: "Claude", model: "anthropic/claude-opus-5.5" },
  { name: "ChatGPT", model: "openai/gpt-6-sol" },
  { name: "Gemini", model: "google/gemini-3.1-pro-preview" },
];
const JUDGES = ["anthropic/claude-opus-5.5", "google/gemini-3.1-pro-preview"];
const DIMENSIONS = ["specificity", "actionability", "washington", "mobility", "trust"] as const;

const { values } = parseArgs({ options: { case: { type: "string", multiple: true } } });
const cases = values.case?.length ? CASES.filter((c) => values.case!.includes(c.id)) : CASES;
if (cases.length === 0) throw new Error(`No cases match ${values.case?.join(", ")}. Known: ${CASES.map((c) => c.id).join(", ")}`);

interface Answer {
  system: string;
  text: string;
  seconds: number;
  error?: string;
}

async function pathways(prompt: string): Promise<Answer> {
  const started = Date.now();
  const findings = await findFacts({ userMessage: prompt, contextItems: [] });
  const system = buildSystemPrompt({ contextItems: [], pathway: null, openSteps: [], findings });
  let reply = "";
  for await (const delta of streamChat([{ role: "system", content: system }, { role: "user", content: prompt }], { temperature: 0.6 })) {
    reply += delta;
  }
  // The person sees each cited source under the reply, so the judges do too.
  const { citations } = traceClaims(reply, findings.claims);
  const sources = citations.map((c) => `[${c.index}] ${c.source.name}, ${c.source.verificationAuthority}, as of ${c.source.asOf}: ${c.source.url}`);
  return { system: "PATHWAYS", text: sources.length ? `${reply}\n\nSources:\n${sources.join("\n")}` : reply, seconds: (Date.now() - started) / 1000 };
}

async function competitor(name: string, model: string, prompt: string): Promise<Answer> {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "PATHWAYS eval" },
    body: JSON.stringify({ model, plugins: [{ id: "web" }], messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  const message = data.choices?.[0]?.message;
  const urls = [...new Set(((message?.annotations ?? []) as { url_citation?: { url?: string } }[]).map((a) => a.url_citation?.url).filter(Boolean))];
  const text = String(message?.content ?? "");
  return { system: name, text: urls.length ? `${text}\n\nSources:\n${urls.join("\n")}` : text, seconds: (Date.now() - started) / 1000 };
}

async function settle(system: string, run: () => Promise<Answer>): Promise<Answer> {
  try {
    return await run();
  } catch (err) {
    return { system, text: "", seconds: 0, error: (err as Error).message };
  }
}

const gradeSchema = z.object({
  answers: z.array(
    z.object({
      label: z.string(),
      criteria_met: z.array(z.string()).describe("Ids of the criteria this answer clearly satisfies."),
      specificity: z.number().describe("1-5: names real employers, programs, offices, forms, titles, figures."),
      actionability: z.number().describe("1-5: the person knows exactly what to do next, in small steps."),
      washington: z.number().describe("1-5: accurate, Washington-specific rules, agencies, and data."),
      mobility: z.number().describe("1-5: improves the person's income and path upward, now and later."),
      trust: z.number().describe("1-5: claims are accurate and sourced; nothing likely wrong or invented."),
      likely_errors: z.array(z.string()).describe("Statements you are confident are factually wrong or invented. Empty if none."),
      summary: z.string().describe("One sentence on this answer's biggest strength and weakness."),
    }),
  ),
  best: z.string().describe("Label of the most useful answer for this person."),
});
type Grade = z.infer<typeof gradeSchema>;

const JUDGE_PROMPT = `You are an expert Washington State career counselor grading answers to a real person's question.
Grade each answer independently against the criteria and the five 1-5 dimensions. Judge substance, not length or tone.
Count a criterion as met only if the answer clearly covers it. List a likely error only when you are confident it is wrong.`;

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function judge(model: string, c: EvalCase, labeled: { label: string; answer: Answer }[]): Promise<Grade> {
  const answers = labeled.map(({ label, answer }) => `=== Answer ${label} ===\n${answer.text || "(no answer)"}`).join("\n\n");
  return generateStructured({
    model,
    name: "grades",
    schema: gradeSchema,
    temperature: 0,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: `Question:\n${c.prompt}\n\nCriteria:\n${c.criteria.map((k) => `- ${k.id}: ${k.text}`).join("\n")}\n\n${answers}`,
      },
    ],
  });
}

interface Score {
  system: string;
  criteria: number;
  dimensions: Record<(typeof DIMENSIONS)[number], number>;
  bestVotes: number;
  errors: string[];
  summaries: string[];
  seconds: number;
}

function score(c: EvalCase, labeled: { label: string; answer: Answer }[], grades: Grade[]): Score[] {
  return labeled.map(({ label, answer }) => {
    const mine = grades.map((g) => g.answers.find((a) => a.label.trim().toUpperCase() === label)).filter((a) => a !== undefined);
    const valid = new Set(c.criteria.map((k) => k.id));
    const avg = (f: (a: (typeof mine)[number]) => number) => (mine.length ? mine.reduce((s, a) => s + f(a), 0) / mine.length : 0);
    return {
      system: answer.system,
      criteria: avg((a) => a.criteria_met.filter((id) => valid.has(id)).length / c.criteria.length),
      dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, avg((a) => Math.min(5, Math.max(1, a[d])))])) as Score["dimensions"],
      bestVotes: grades.filter((g) => g.best.trim().toUpperCase() === label).length,
      errors: [...new Set(mine.flatMap((a) => a.likely_errors))],
      summaries: mine.map((a) => a.summary),
      seconds: answer.seconds,
    };
  });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => n.toFixed(1);

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = `evals/results/${stamp}`;
  mkdirSync(`${dir}/answers`, { recursive: true });
  const results: { case: string; scores: Score[] }[] = [];

  for (const c of cases) {
    console.log(`\n${c.id}: answering…`);
    const answers = await Promise.all([
      settle("PATHWAYS", () => pathways(c.prompt)),
      ...COMPETITORS.map((m) => settle(m.name, () => competitor(m.name, m.model, c.prompt))),
    ]);
    for (const a of answers) {
      writeFileSync(`${dir}/answers/${c.id}--${a.system}.md`, a.error ? `ERROR: ${a.error}` : a.text);
      console.log(`  ${a.system}: ${a.error ? `error (${a.error})` : `${a.seconds.toFixed(0)}s`}`);
    }
    const labeled = shuffle(answers).map((answer, i) => ({ label: String.fromCharCode(65 + i), answer }));
    console.log(`${c.id}: judging…`);
    const grades = (await Promise.allSettled(JUDGES.map((m) => judge(m, c, labeled))))
      .map((r, i) => (r.status === "fulfilled" ? r.value : (console.log(`  judge ${JUDGES[i]} failed: ${r.reason}`), null)))
      .filter((g): g is Grade => g !== null);
    const scores = score(c, labeled, grades);
    results.push({ case: c.id, scores });
    for (const s of scores) console.log(`  ${s.system}: criteria ${pct(s.criteria)}, best votes ${s.bestVotes}`);
  }

  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
  writeFileSync(`${dir}/report.md`, report(results));
  console.log(`\nReport: ${dir}/report.md`);
}

function report(results: { case: string; scores: Score[] }[]): string {
  const systems = ["PATHWAYS", ...COMPETITORS.map((m) => m.name)];
  const all = (system: string) => results.flatMap((r) => r.scores.filter((s) => s.system === system));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const lines = [
    `# PATHWAYS vs. general assistants`,
    ``,
    `${results.length} cases, judged blind by ${JUDGES.join(" and ")}. Criteria = share of each case's checklist met. Dimensions are 1-5.`,
    ``,
    `| System | Criteria | Specific | Actionable | Washington | Mobility | Trust | Best votes | Likely errors |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...systems.map((sys) => {
      const s = all(sys);
      return `| ${sys} | ${pct(mean(s.map((x) => x.criteria)))} | ${DIMENSIONS.map((d) => one(mean(s.map((x) => x.dimensions[d])))).join(" | ")} | ${s.reduce((n, x) => n + x.bestVotes, 0)} | ${s.reduce((n, x) => n + x.errors.length, 0)} |`;
    }),
  ];
  for (const r of results) {
    lines.push(``, `## ${r.case}`, ``, `| System | Criteria | Trust | Best votes | Seconds |`, `|---|---:|---:|---:|---:|`);
    for (const s of r.scores) lines.push(`| ${s.system} | ${pct(s.criteria)} | ${one(s.dimensions.trust)} | ${s.bestVotes} | ${s.seconds.toFixed(0)} |`);
    for (const s of r.scores) {
      lines.push(``, `**${s.system}:** ${s.summaries.join(" / ")}`);
      for (const e of s.errors) lines.push(`- Likely error: ${e}`);
    }
  }
  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
