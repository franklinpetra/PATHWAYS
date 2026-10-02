import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe rendering for assistant text: paragraphs, bullet and numbered
 * lists, **bold**, [n] citations, and bare links. No HTML is ever interpreted.
 * Citations that match a known source become buttons that open its attribution.
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

type Block = { kind: "p" | "ul" | "ol" | "h"; lines: string[] };

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    const [kind, content]: [Block["kind"], string] = bullet
      ? ["ul", bullet[1]]
      : numbered
        ? ["ol", numbered[1]]
        : heading
          ? ["h", heading[1]]
          : ["p", line.trim()];

    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && kind !== "h" && last.lines.length > 0) last.lines.push(content);
    else blocks.push({ kind, lines: [content] });
  }
  return blocks.filter((b) => b.lines.length > 0);
}

export function MessageText({ text, citable, onCite }: { text: string } & CiteProps) {
  const cite = { citable, onCite };
  return (
    <div className="space-y-3">
      {toBlocks(text).map((block, i) => {
        switch (block.kind) {
          case "h":
            return (
              <p key={i} className="font-semibold">
                {renderInline(block.lines[0], cite)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.kind;
            return (
              <List key={i} className={`space-y-1.5 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-forest/60`}>
                {block.lines.map((line, j) => (
                  <li key={j}>{renderInline(line, cite)}</li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {renderInline(line, cite)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
