import type { ReactNode } from "react";

/**
 * Minimal markdown renderer for locally generated report and chat content.
 * Supports headings, bullet/numbered lists, pipe tables, fenced code blocks,
 * paragraphs and inline bold / italic / code. Content is rendered through
 * React text nodes only, so no HTML in the source can reach the DOM.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

export function MarkdownLite({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let index = 0;

  const nextKey = () => `md-${key++}`;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      index += 1;
      blocks.push(
        <pre className="md-code" key={nextKey()}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);

    if (heading) {
      const level = heading[1].length;
      const text = renderInline(heading[2], nextKey());
      blocks.push(
        level === 1 ? <h3 key={nextKey()}>{text}</h3> : level === 2 ? <h4 key={nextKey()}>{text}</h4> : <h5 key={nextKey()}>{text}</h5>
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];

      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(<li key={nextKey()}>{renderInline(lines[index].replace(/^\s*[-*]\s+/, ""), nextKey())}</li>);
        index += 1;
      }

      blocks.push(<ul key={nextKey()}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];

      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(<li key={nextKey()}>{renderInline(lines[index].replace(/^\s*\d+\.\s+/, ""), nextKey())}</li>);
        index += 1;
      }

      blocks.push(<ol key={nextKey()}>{items}</ol>);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headerCells = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div className="md-table-wrap" key={nextKey()}>
          <table className="data-table">
            <thead>
              <tr>
                {headerCells.map((cell) => (
                  <th key={nextKey()} scope="col">{renderInline(cell, nextKey())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={nextKey()}>
                  {row.map((cell) => (
                    <td key={nextKey()}>{renderInline(cell, nextKey())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;

    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }

    blocks.push(<p key={nextKey()}>{renderInline(paragraph.join(" "), nextKey())}</p>);
  }

  return <div className="markdown">{blocks}</div>;
}
