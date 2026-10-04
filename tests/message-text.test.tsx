import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageText } from "@/components/chat/MessageText";

const summaries = (html: string) => [...html.matchAll(/<summary[^>]*>.*?<span[^>]*>(.*?)<\/span>/g)].map((m) => m[1]);

describe("MessageText sections", () => {
  it("keeps the lead visible and collapses each top-level section under an unnumbered heading", () => {
    const html = renderToStaticMarkup(
      <MessageText text={"The answer.\n\n## 1. What to sell\nA\n\n### Upwork: use it selectively\nB\n\n## 2. What to charge\nC"} />,
    );
    expect(html.indexOf("The answer.")).toBeLessThan(html.indexOf("<details"));
    expect(summaries(html)).toEqual(["What to sell", "What to charge"]);
    // The subheading stays inside its section rather than becoming its own oval.
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>).)*Upwork: use it selectively/s);
  });

  it("renders a table instead of raw pipes", () => {
    const html = renderToStaticMarkup(<MessageText text={"| Job | Median |\n|---|---:|\n| Bookkeeper | $28.85 |"} />);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).not.toContain("|---");
  });
});

describe("MessageText quotes", () => {
  it("renders > lines as a quote instead of raw markers", () => {
    const html = renderToStaticMarkup(<MessageText text={"For your profile:\n\n> **Find your next step in Washington.**\n> Start at pathways.click."} />);
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("&gt;");
    expect(html).toContain("<strong>Find your next step in Washington.</strong>");
  });
});
