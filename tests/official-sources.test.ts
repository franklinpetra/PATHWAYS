import { describe, expect, it } from "vitest";
import { authorityFor, normalizeText, verifyOfficialFacts } from "@/lib/agents/official-sources";

const PAGE = {
  url: "https://doh.wa.gov/licensing/pharmacy-technician",
  title: "Pharmacy Technician Licensing",
  content:
    "Applicants must complete a commission‑approved training program.  The application fee is $140.\nNo formal training is required for pharmacy assistants.",
};

const fact = (overrides: Partial<{ statement: string; source_url: string; quote: string }> = {}) => ({
  statement: "A pharmacy technician license application costs $140.",
  source_url: PAGE.url,
  quote: "The application fee is $140.",
  ...overrides,
});

describe("authorityFor", () => {
  it("matches the most specific allowed domain, including subdomains", () => {
    expect(authorityFor("https://doh.wa.gov/x")).toBe("Washington State Department of Health");
    expect(authorityFor("https://apps.leg.wa.gov/wac/default.aspx?cite=246-945-200")).toBe("Washington State Legislature");
    expect(authorityFor("https://www.ofm.wa.gov/x")).toBe("State of Washington");
    expect(authorityFor("https://pharmacy.washington.edu/x")).toBe("University of Washington");
  });

  it("rejects look-alike and unlisted domains", () => {
    expect(authorityFor("https://doh.wa.gov.example.com/x")).toBeNull();
    expect(authorityFor("https://notwa.gov/x")).toBeNull();
    expect(authorityFor("https://pharmacytechacademy.com/washington")).toBeNull();
    expect(authorityFor("not a url")).toBeNull();
  });
});

describe("verifyOfficialFacts", () => {
  const today = "2026-10-02";

  it("keeps a fact whose quote appears on the retrieved page, and shows the quote with the source", () => {
    const { claims, dropped } = verifyOfficialFacts([fact()], [PAGE], today);
    expect(dropped).toBe(0);
    expect(claims[0]).toMatchObject({
      kind: "official",
      statement: 'A pharmacy technician license application costs $140. (Source text: "The application fee is $140.")',
      source: {
        name: "Pharmacy Technician Licensing",
        asOf: today,
        verificationAuthority: "Washington State Department of Health",
        url: PAGE.url,
      },
    });
  });

  it("tolerates typographic differences between the quote and the page", () => {
    const { claims } = verifyOfficialFacts(
      [fact({ statement: "Technicians need approved training.", quote: "complete a commission-approved   training program" })],
      [PAGE],
      today,
    );
    expect(claims).toHaveLength(1);
  });

  it("drops a quote that isn't on the page", () => {
    expect(verifyOfficialFacts([fact({ quote: "The application fee is $70 for everyone." })], [PAGE], today).claims).toEqual([]);
  });

  it("drops a statement with a number its quote doesn't contain", () => {
    const f = fact({ statement: "Technicians need 520 hours of training.", quote: "complete a commission-approved training program" });
    expect(verifyOfficialFacts([f], [PAGE], today).claims).toEqual([]);
  });

  it("drops a URL the search never retrieved, or one off the allowlist", () => {
    expect(verifyOfficialFacts([fact({ source_url: "https://doh.wa.gov/other-page" })], [PAGE], today).claims).toEqual([]);
    const offList = { ...PAGE, url: "https://pharmacytechacademy.com/wa" };
    expect(verifyOfficialFacts([fact({ source_url: offList.url })], [offList], today).claims).toEqual([]);
  });

  it("drops quotes too short to verify and duplicate quotes", () => {
    expect(verifyOfficialFacts([fact({ statement: "Fee.", quote: "fee is" })], [PAGE], today).claims).toEqual([]);
    expect(verifyOfficialFacts([fact(), fact()], [PAGE], today)).toMatchObject({ dropped: 1 });
  });

  it("matches URLs regardless of a trailing slash or fragment", () => {
    expect(verifyOfficialFacts([fact({ source_url: `${PAGE.url}/#fees` })], [PAGE], today).claims).toHaveLength(1);
  });
});

describe("normalizeText", () => {
  it("folds curly quotes, dashes, and whitespace", () => {
    expect(normalizeText("“Commission–approved”\n  program")).toBe('"commission-approved" program');
  });
});
