import { describe, expect, it } from "vitest";
import { curatedRows } from "@/lib/data/washington/curated-stepping-stones";

const program = {
  id: "farestart-job-training",
  kind: "job_training",
  name: "FareStart Job Training",
  organization: "FareStart",
  summary: "Free job training.",
  audiences: ["returning_citizens"],
  fields: ["culinary"],
  paid: null,
  city: "Seattle",
  statewide: false,
  website: "https://www.farestart.org/job-training/",
  source: { name: "FareStart: Job Training Programs", url: "https://www.farestart.org/job-training/", authority: "FareStart" },
  quotes: ["FareStart’s free job training programs skill, reskill and upskill students"],
};
const reviewed = { status: "reviewed", review: { reviewed_by: "Reviewer", reviewed_on: "2026-10-03", notes: [] }, programs: [program] };
const page = "<html><body><p>FareStart&rsquo;s free job   training programs skill, reskill and upskill students so they are prepared.</p></body></html>";

describe("curatedRows", () => {
  it("loads nothing from a draft packet", async () => {
    const result = await curatedRows({ ...reviewed, status: "draft" }, async () => page, "2026-10-03");
    expect(result.rows).toEqual([]);
    expect(result.notes[0]).toMatch(/draft/);
  });

  it("loads a reviewed program whose quotes are still on its page, labeled as the program's own claim", async () => {
    const { rows, notes } = await curatedRows(reviewed, async () => page, "2026-10-03");
    expect(notes).toEqual([]);
    expect(rows[0]).toMatchObject({
      source_record_id: "curated:farestart-job-training",
      provenance: "program",
      verification_authority: "FareStart",
      source_as_of: "2026-10-03",
      paid: null,
    });
  });

  it("skips a program whose quote has left its page, or whose page can't be read", async () => {
    expect((await curatedRows(reviewed, async () => "<p>We changed our programs.</p>", "2026-10-03")).rows).toEqual([]);
    const failed = await curatedRows(reviewed, async () => {
      throw new Error("403");
    }, "2026-10-03");
    expect(failed.rows).toEqual([]);
    expect(failed.notes[0]).toMatch(/couldn't read/);
  });

  it("marks a state agency's page as official", async () => {
    const agency = { ...program, id: "workfirst", source: { ...program.source, url: "https://www.dshs.wa.gov/x", authority: "DSHS" } };
    const { rows } = await curatedRows({ ...reviewed, programs: [agency] }, async () => page, "2026-10-03");
    expect(rows[0].provenance).toBe("official");
  });

  it("rejects a malformed packet", async () => {
    await expect(curatedRows({ status: "reviewed", programs: [{ id: "Bad Id" }] }, async () => page, "2026-10-03")).rejects.toThrow();
  });
});

describe("curatedRows with quotes from more than one page", () => {
  const law = {
    ...program,
    id: "crop",
    kind: "support_service",
    source: { name: "RCW 9.97.020", url: "https://app.leg.wa.gov/a", authority: "Washington State Legislature" },
    quotes: ["a certificate of restoration of opportunity", { url: "https://app.leg.wa.gov/b", text: "Two years have passed from release" }],
  };
  const pages: Record<string, string> = {
    "https://app.leg.wa.gov/a": "<p>has obtained a certificate of restoration of opportunity and</p>",
    "https://app.leg.wa.gov/b": "<p>(iv) Two years have passed from release from total confinement</p>",
  };

  it("checks each quote against its own page", async () => {
    const { rows, notes } = await curatedRows({ ...reviewed, programs: [law] }, async (u) => pages[u], "2026-10-03");
    expect(notes).toEqual([]);
    expect(rows[0]).toMatchObject({ kind: "support_service", provenance: "official" });
  });

  it("skips the record when the second page no longer has its quote", async () => {
    const changed: Record<string, string> = { ...pages, "https://app.leg.wa.gov/b": "<p>Amended.</p>" };
    const { rows, notes } = await curatedRows({ ...reviewed, programs: [law] }, async (u) => changed[u], "2026-10-03");
    expect(rows).toEqual([]);
    expect(notes[0]).toMatch(/no longer on https:\/\/app\.leg\.wa\.gov\/b/);
  });
});
