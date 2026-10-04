import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLniPrepPrograms } from "@/lib/data/washington/lni-prep-programs";
import { makeStamp } from "@/lib/data/washington/sources";

const html = readFileSync("tests/fixtures/lni-apprenticeship-preparation.html", "utf8");
const stamp = makeStamp("lni_prep", { sourceUrl: "https://lni.wa.gov/x", asOf: "2026-10-03", today: "2026-10-03" });

describe("parseLniPrepPrograms", () => {
  const { rows } = parseLniPrepPrograms(html, stamp);
  const byName = (part: string) => rows.find((r) => r.name.includes(part))!;

  it("reads every program on L&I's list as an official pre-apprenticeship", () => {
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === "pre_apprenticeship" && r.provenance === "official")).toBe(true);
  });

  it("parses address, contact, and website, preferring the link's real address", () => {
    expect(byName("Women")).toMatchObject({
      name: "Apprenticeship and Non-Traditional Employment for Women (ANEW)",
      street_address: "18338 Andover Park W",
      city: "Tukwila",
      postal_code: "98188",
      contact_name: "Megan Clark",
      contact_phone: "206-381-1384",
      contact_email: "megan@anewcareer.org",
      audiences: ["women"],
      open_enrollment: true,
    });
    expect(byName("DOC").website).toBe("https://www.ajactraining.org/apprenticeship/pre-apprenticeships/");
    expect(byName("DOC").organization).toBe("AJAC | Advanced Manufacturing Apprenticeships");
  });

  it("marks programs closed to public enrollment and keeps L&I's notes as the summary", () => {
    expect(byName("CTAP")).toMatchObject({ open_enrollment: false, city: null, contact_email: null });
    expect(byName("Yakima").summary).toMatch(/serves high school and GED students ages 16-21/);
  });

  it("tags audiences and fields from the program's own words", () => {
    expect(byName("DOC")).toMatchObject({ audiences: ["returning_citizens"], fields: ["manufacturing"] });
    expect(byName("Yakima").audiences).toContain("youth");
    expect(byName("Yakima").fields).toEqual(expect.arrayContaining(["energy", "construction"]));
  });

  it("refuses a page without the list rather than loading nothing", () => {
    expect(() => parseLniPrepPrograms("<html>moved</html>", stamp)).toThrow(/no longer has/);
  });
});
