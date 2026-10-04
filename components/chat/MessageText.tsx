import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe rendering for assistant text: paragraphs, bullet and numbered
 * lists, tables, **bold**, [n] citations, and bare links. No HTML is ever interpreted.
 * Citations that match a known source become buttons that open its attribution.
 *
 * Progressive disclosure: whatever precedes the first heading is the answer and is always
 * shown; each headed section after it collapses to its heading, so a reply reads in seconds
 * and the detail is one tap away.
 */

interface CiteProps {
  /** Citation numbers that have a source; others render as plain text. */
  citable?: ReadonlySet<number>;
  onCite?: (index: number) => void;
}

const INLINE = /(\*\*[^*]+\*\*|\[\d+\]|https?:\/\/[^\s)]+[^\s).,;:!?])/g;

function renderInline(text: string, cite: CiteProps): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\[\d+\]$/.test(part)) {
      const index = Number(part.slice(1, -1));
      if (cite.onCite && cite.citable?.has(index)) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => cite.onCite!(index)}
            aria-label={`Show source ${index}`}
            className="ml-0.5 rounded-full align-super text-[0.7em] font-medium text-forest hover:underline"
          >
            {part}
          </button>
        );
      }
      return (
        <span key={i} className="ml-0.5 align-super text-[0.7em] text-muted-foreground">
          {part}
        </span>
      );
    }
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-forest underline underline-offset-2">
          {part.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { kind: "p" | "ul" | "ol" | "h" | "table"; lines: string[]; level?: number };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    // Table rows ("| a | b |"); the "|---|---|" divider row is dropped.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      const last = blocks[blocks.length - 1];
      if (last?.kind === "table") last.lines.push(line.trim());
      else blocks.push({ kind: "table", lines: [line.trim()] });
      continue;
    }
    // Horizontal rules carry no content here.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const [kind, content]: [Block["kind"], string] = bullet
      ? ["ul", bullet[1]]
      : numbered
        ? ["ol", numbered[1]]
        : heading
          ? ["h", heading[2]]
          : ["p", line.trim()];

    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && kind !== "h" && last.lines.length > 0) last.lines.push(content);
    else blocks.push({ kind, lines: [content], ...(heading && { level: heading[1].length }) });
  }
  return blocks.filter((b) => b.lines.length > 0);
}

const cells = (row: string) => row.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());

function BlockView({ block, cite }: { block: Block; cite: CiteProps }) {
  switch (block.kind) {
    case "h":
      return <p className="pt-1 font-semibold">{renderInline(block.lines[0], cite)}</p>;
    case "table": {
      const [head, ...rows] = block.lines.map(cells);
      return (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full border-collapse text-left text-[14px] leading-snug">
            <thead>
              <tr className="border-b border-border-strong">
                {head.map((c, i) => (
                  <th key={i} scope="col" className="py-1.5 pr-4 align-bottom text-xs font-semibold text-muted-foreground">
                    {renderInline(c, cite)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {row.map((c, j) => (
                    <td key={j} className={`py-1.5 pr-4 align-top ${j === 0 ? "font-medium" : "tabular-nums"}`}>
                      {renderInline(c, cite)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List className={`space-y-1.5 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-forest/60`}>
          {block.lines.map((line, j) => (
            <li key={j}>{renderInline(line, cite)}</li>
          ))}
        </List>
      );
    }
    default:
      return (
        <p>
          {block.lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {renderInline(line, cite)}
            </Fragment>
          ))}
        </p>
      );
  }
}

interface Section {
  heading: string | null;
  blocks: Block[];
}

/** "1. What to sell" -> "What to sell": the sections already read in order. */
const unnumbered = (heading: string) => heading.replace(/^\s*(\d+[.)]|step\s+\d+[:.])\s+/i, "");

/**
 * The lead (before any heading), then one section per top-level heading. Headings deeper
 * than the shallowest one in the reply stay inside their section as subheadings.
 */
function toSections(blocks: Block[]): Section[] {
  const top = Math.min(...blocks.filter((b) => b.kind === "h").map((b) => b.level ?? 1));
  const sections: Section[] = [{ heading: null, blocks: [] }];
  for (const block of blocks) {
    const opensSection = block.kind === "h" && (block.level ?? 1) <= top;
    if (opensSection) sections.push({ heading: unnumbered(block.lines[0]), blocks: [] });
    else sections[sections.length - 1].blocks.push(block);
  }
  return sections.filter((s) => s.heading !== null || s.blocks.length > 0);
}

export function MessageText({ text, citable, onCite }: { text: string } & CiteProps) {
  const cite = { citable, onCite };
  const sections = toSections(toBlocks(text));
  // With no lead paragraph, the first section is the answer: keep it open.
  const leadIndex = sections[0]?.heading === null ? 0 : -1;
  return (
    <div className="space-y-3">
      {sections.map((section, i) =>
        section.heading === null ? (
          section.blocks.map((block, j) => <BlockView key={`${i}-${j}`} block={block} cite={cite} />)
        ) : (
          <details
            key={i}
            open={leadIndex === -1 && i === 0 ? true : undefined}
            className="group rounded-2xl border border-border bg-surface/70 open:bg-surface"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">{renderInline(section.heading, cite)}</span>
              <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="space-y-3 px-4 pt-0.5 pb-4">
              {section.blocks.map((block, j) => (
                <BlockView key={j} block={block} cite={cite} />
              ))}
            </div>
          </details>
        ),
      )}
    </div>
  );
}
