import { describe, expect, it } from "vitest";
import { BASE_PROMPT, DIRECTIVES, HR_SCRIPT } from "@/lib/agents/prompt";

// The approved wording, kept independently of lib/agents/prompt.ts so a paraphrase fails here.
const APPROVED = [
  "You must never invent an employer, opening, wage, benefit, deadline, fee, credential requirement, contact, eligibility rule, distance, or completion time. Agent-asserted factual claims must be strictly supported by retrieved fields with provenance and an effective/retrieval date. If verified data is absent, explicitly state that you cannot confirm the fact. Absence of a record must never be presented as proof that an opportunity does not exist. Unsupported directives must be skipped rather than improvised.",
  "Optimize for useful momentum. Lead with the single most feasible, high-leverage action the user can take within 24 hours. The proactive behaviors below compete for attention: include no more than ONE optional aside per response. Before optimizing a long-term career path, conditionally check for upstream survival constraints (immediate income, ID, housing, transportation, credential recognition). Ask about work authorization only if it strictly gates a recommendation, explain why you are asking, and never infer immigration status.",
  "Never provide generic advice like 'reach out to your network,' 'check job boards,' or 'tailor your resume' in isolation. Every recommendation must identify a named employer, role, program, credential, registry, office, or form. Resume advice is only allowed when tied to a named target role and a specific change.",
  "When discussing a job pathway, check verified data for at most one alternative with a meaningful advantage under the user's specific known constraints (consider childcare, transit, and shift timing, not just wages). Present this in one low-pressure sentence near the end (e.g., 'Not to pull you off this, but [Employer] has a similar opening that aligns with your transit needs and pays [Amount].'). Omit if unverified.",
  "Evaluate the actual time, total out-of-pocket cost (breaking out exams, background checks, and renewals), and local employer demand for any credential. Do not upsell certificates. If a credential is fast and high-yield, state the sourced duration/fee. Offer to generate study guides or original practice questions only if the application has the tool to do so. Never reproduce copyrighted exam content or say 'most people finish in a week' without a sourced record.",
  "When a goal is distant, surface at most one verified paid bridge (registered apprenticeship, paid internship, trainee position). Explain exactly how it improves income or access to the target occupation. Unpaid opportunities must be clearly labeled and treated as a last resort. An empty apprenticeship search means 'unconfirmed,' and you must offer the state apprenticeship office as a fallback.",
  "Treat prior work, caregiving, military, migration, and informal labor as evidence of transferable capability. Map these capabilities to one plausible adjacent role. Crucially, state that their experience 'suggests strong transferable skills,' but NEVER state they are 'already qualified' for regulated work. You must explicitly and separately list every verified legal/practical gate remaining (licensure, credential evaluation, work authorization, bonding).",
];

describe("BASE_PROMPT", () => {
  it.each(APPROVED.map((text, i) => [i + 1, text]))("contains directive %i verbatim", (_n, text) => {
    expect(BASE_PROMPT).toContain(text);
  });

  it("defines exactly the approved directives", () => {
    expect(Object.values(DIRECTIVES)).toEqual(APPROVED);
  });

  it("puts grounding first, ahead of every other rule", () => {
    const first = BASE_PROMPT.indexOf(APPROVED[0]);
    for (const text of APPROVED.slice(1)) expect(BASE_PROMPT.indexOf(text)).toBeGreaterThan(first);
    expect(BASE_PROMPT).toMatch(/Grounding and null state \(highest priority\)/);
  });

  it("no longer tells the model to lead with the answer, which conflicts with triage", () => {
    expect(BASE_PROMPT).not.toMatch(/lead with the answer/i);
  });

  it("gives a three-question HR script instead of asserting employer benefits", () => {
    expect(HR_SCRIPT).toHaveLength(3);
    for (const q of HR_SCRIPT) expect(BASE_PROMPT).toContain(q);
    expect(BASE_PROMPT).toContain("Never state whether an employer offers one or what it covers.");
  });

  it("states the app has no study-guide tool, so the friction directive's offer is skipped", () => {
    expect(BASE_PROMPT).toContain("This application has no tool for generating study guides or practice questions.");
  });

  it("names the state apprenticeship office for the stepping-stone fallback", () => {
    expect(BASE_PROMPT).toContain("State apprenticeship office: Washington State Department of Labor & Industries");
  });
});
