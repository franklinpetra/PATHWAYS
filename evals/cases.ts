/**
 * The multi-AI comparison set: real questions people bring to a career navigator in
 * Washington, each with what a strong answer covers. Criteria are things a reader can check
 * in the answer itself; they describe substance, not wording.
 *
 * Add a case whenever a real conversation shows a gap. Keep criteria to facts we have
 * verified against official sources.
 */

export interface EvalCase {
  id: string;
  prompt: string;
  criteria: { id: string; text: string }[];
}

export const CASES: EvalCase[] = [
  {
    id: "pharmacy",
    prompt:
      "Brainstorming. I want to eventually be a pharmacist but for now I am okay applying for anything. I just out of college with an art degree so I have no pharmacy training. But once I am working in a pharmacy at whatever their entry level is, then I can take classes to get a pharmacy degree and hopefully move up the ladder by getting certified to give vaccines or whatever the next step up is. Seems like every pharmacy has a we're hiring sign. What do I need to do in the state of Washington for this?",
    criteria: [
      { id: "assistant", text: "Says the entry rung is a Washington pharmacy assistant registration with the Department of Health, with no formal training required" },
      { id: "tech-training", text: "Says a pharmacy technician needs a Pharmacy Commission-approved training program (which can be employer-based) and a national certification exam" },
      { id: "vaccines", text: "Says pharmacy technicians can administer vaccines in Washington under pharmacist supervision with commission approval or an approved plan" },
      { id: "pharmd", text: "Explains pharmacist requires a PharmD (e.g., UW or WSU) with science prerequisites, which can be taken while working" },
      { id: "art-degree", text: "Says the art degree does not disqualify them from pharmacy school" },
      { id: "paid-training", text: "Points to a paid or employer-paid route into technician training (employer program or registered apprenticeship)" },
      { id: "pay", text: "Gives sourced pay figures for at least one rung" },
    ],
  },
  {
    id: "plumber",
    prompt: "How do I become a plumber in Washington?",
    criteria: [
      { id: "trainee-cert", text: "Says a plumber trainee certificate from Washington L&I is required to work under supervision" },
      { id: "apprenticeship", text: "Recommends a registered plumbing apprenticeship as the main earn-while-learning route and names at least one real program or sponsor" },
      { id: "journey-exam", text: "Explains journey-level certification requires documented experience and passing the state exam" },
      { id: "pay", text: "Gives sourced apprentice or journey-level wages" },
      { id: "first-steps", text: "Gives concrete first steps for this week" },
    ],
  },
  {
    id: "sell-art",
    prompt: "How do I start selling my art?",
    criteria: [
      { id: "offer", text: "Helps choose a concrete first offer (originals, commissions, or prints) rather than generic advice" },
      { id: "pricing", text: "Gives a method for pricing that covers materials, fees, and the artist's time" },
      { id: "channels", text: "Names specific sales channels" },
      { id: "wa-business", text: "Mentions Washington business registration and sales tax through the Department of Revenue" },
      { id: "first-steps", text: "Breaks the start into small, concrete steps" },
    ],
  },
  {
    id: "food-truck",
    prompt: "I want to sell ice cream from a food truck in Tacoma. What do I need to do?",
    criteria: [
      { id: "health-permit", text: "Names the Tacoma-Pierce County Health Department mobile food permit and plan review" },
      { id: "commissary", text: "Says the truck must operate from an approved commissary" },
      { id: "lni-vehicle", text: "Says L&I must approve the vehicle (insignia or plaque) before the health permit" },
      { id: "business-license", text: "Mentions state business registration (Department of Revenue) and a Tacoma city business license" },
      { id: "sealed-vs-scooped", text: "Explains how selling prepackaged versus scooped ice cream changes requirements or cost" },
    ],
  },
  {
    id: "rent-5k",
    prompt:
      "Help. I need money. What should I do? Where can I work that will pay me the most? I'm smart, fun, I get things done, I code in tandem with LLMs, I am fun to work with, and I need to make quite a lot of money as my rent is $5K per month and I have two kids.",
    criteria: [
      { id: "income-target", text: "Calculates the income needed for $5,000/month rent (about $200,000/year at the 30% guideline)" },
      { id: "wa-wages", text: "Compares specific roles against that need using Washington wage data" },
      { id: "gap-plan", text: "If no single role closes the gap, lays out a stacked plan (side work, second income, raise path) with amounts" },
      { id: "cash-now", text: "Gives a way to bring in money soon, such as packaged contract or consulting work" },
      { id: "emergency", text: "Names specific Washington emergency assistance in case rent is at risk" },
      { id: "pay-transparency", text: "Uses Washington's pay transparency law (postings must list pay ranges) to compare jobs" },
    ],
  },
  {
    id: "cdl",
    prompt:
      "I got laid off from a warehouse job in Kent. I've heard truck drivers make good money. How do I get a CDL in Washington and is it worth it?",
    criteria: [
      { id: "eldt", text: "Mentions federal Entry-Level Driver Training (ELDT) from a registered provider before the skills test" },
      { id: "clp", text: "Explains the commercial learner permit, knowledge tests, and DOT medical card through the Department of Licensing" },
      { id: "cost-paid", text: "Compares paying for CDL school with employer-paid training and warns about training-repayment contracts" },
      { id: "pay", text: "Gives sourced Washington wages for heavy truck drivers" },
      { id: "layoff-help", text: "Mentions unemployment benefits or worker retraining funds available after a layoff" },
    ],
  },
  {
    id: "foreign-nurse",
    prompt: "I was a nurse in the Philippines for 8 years and just moved to Spokane. How do I work as a nurse here?",
    criteria: [
      { id: "commission", text: "Says licensure is through the Washington State Nursing Care Quality Assurance Commission" },
      { id: "evaluation", text: "Explains foreign education must be evaluated (e.g., CGFNS) and the NCLEX-RN passed" },
      { id: "bridge-work", text: "Suggests paid healthcare work while getting licensed (e.g., nursing assistant) without saying they are already qualified as an RN" },
      { id: "pay", text: "Gives sourced registered nurse wages for Spokane or Washington" },
      { id: "respect", text: "Treats 8 years of nursing as real experience, without deficit language" },
    ],
  },
  {
    id: "reentry",
    prompt: "I just got out after 5 years. I have a felony. I need a job in Tacoma fast. What can I do?",
    criteria: [
      { id: "fair-chance", text: "Explains Washington's Fair Chance Act limits when employers can ask about criminal records" },
      { id: "fast-income", text: "Names specific fast-hire options or employers open to people with records" },
      { id: "trades", text: "Mentions construction trades or pre-apprenticeship as a higher-paying route" },
      { id: "restoration", text: "Mentions a Certificate of Restoration of Opportunity or record relief, or where to get legal help" },
      { id: "basics", text: "Checks or addresses ID, cash assistance, or other immediate needs" },
    ],
  },
  {
    id: "returning-parent",
    prompt:
      "I've been a stay-at-home parent for 10 years and want to get back to work in Olympia. I used to do bookkeeping.",
    criteria: [
      { id: "roles", text: "Names specific roles that use bookkeeping experience" },
      { id: "pay", text: "Gives sourced wages for those roles in Olympia or Washington" },
      { id: "refresh", text: "Suggests a quick, low-cost skills refresh tied to what employers ask for, without upselling credentials" },
      { id: "gap-framing", text: "Frames the 10 years respectfully and gives a concrete way to present it" },
      { id: "first-steps", text: "Breaks the restart into small steps" },
    ],
  },
  {
    id: "teacher",
    prompt: "I'm a high school teacher in Bellevue making $85K. What careers could pay me more using my skills?",
    criteria: [
      { id: "roles", text: "Names specific roles that use teaching skills (e.g., instructional designer, training and development specialist or manager)" },
      { id: "pay-compare", text: "Compares those roles' Washington wages with the current $85K" },
      { id: "transition", text: "Gives a concrete transition plan (portfolio, titles to search, a bridge)" },
      { id: "tradeoffs", text: "Names trade-offs such as pension, schedule, or job security" },
    ],
  },
  {
    id: "foreign-doctor",
    prompt:
      "I'm a physician trained in Nigeria with 10 years of practice. I just moved to Seattle with a green card. How can I practice medicine here, and what can I do for work in the meantime?",
    criteria: [
      {
        id: "img-license",
        text: "Explains the Washington Medical Commission's International Medical Graduates Clinical Experience license, which requires ECFMG certification, passing USMLE Step 1 and Step 2, and an approved practice agreement with a supervising physician",
      },
      { id: "full-license", text: "Explains that full, unrestricted licensure generally runs through U.S. residency, without implying the person can practice independently now" },
      { id: "bridge", text: "Suggests paid bridge roles that use medical training without a physician license (e.g., medical assistant, clinical research coordinator, medical scribe) and names their gates" },
      { id: "navigation", text: "Points to the Puget Sound Welcome Back Center at Highline College or a similar navigation service for internationally trained professionals" },
      { id: "pay", text: "Gives sourced Washington wages for at least one bridge role" },
      { id: "respect", text: "Treats 10 years of practice as real expertise, without deficit language" },
    ],
  },
  {
    id: "returning-engineer",
    prompt: "I'm a mom who left software engineering 6 years ago to raise my kids. I live in Bellevue. How do I get back into tech?",
    criteria: [
      { id: "returnship", text: "Explains returnships and names a way to find them, such as Path Forward's returnship directory" },
      { id: "wa-wages", text: "Gives sourced Washington wages for software roles" },
      { id: "refresh", text: "Recommends a targeted, low-cost skills refresh tied to current roles, without upselling a degree or bootcamp" },
      { id: "gap", text: "Gives a concrete, respectful way to present the six-year gap" },
      { id: "first-steps", text: "Breaks the restart into small steps for this week" },
    ],
  },
  {
    id: "high-schooler",
    prompt: "I'm 16 and a junior in high school in Spokane. I want to get into the trades and start earning money. What can I do now?",
    criteria: [
      {
        id: "now-vs-later",
        text: "Separates what a 16-year-old can do now (high-school pre-apprenticeship, skills center, part-time job) from registered apprenticeship, without promising apprenticeship entry before 18 unless a source says a program accepts 16- and 17-year-olds",
      },
      { id: "local-program", text: "Names a specific Spokane-area program open to high school students, such as NEWTech Skills Center or a pre-apprenticeship on L&I's recognized list" },
      { id: "teen-rules", text: "Covers Washington work rules for 16- and 17-year-olds, such as parent/school authorization or school-week hour limits" },
      { id: "pay", text: "Gives sourced wages for apprentices or the target trade" },
      { id: "first-steps", text: "Gives concrete first steps, such as talking to a school counselor or contacting a named program" },
    ],
  },
];
