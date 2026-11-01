import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Model text is untrusted, so it is never turned into HTML. Links and images on purpose stay plain
 * text: a manipulated model could otherwise hide user data in an address.
 */
function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${index}-${part.length}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-hover px-1 text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function Table({ lines }: { lines: string[] }) {
  const [head = "", , ...rows] = lines;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {cells(head).map((cell) => (
              <th key={cell} className="border-b border-line px-2 py-1 text-left font-bold">
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              {cells(row).map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells of a finished row never move.
                <td key={index} className="border-b border-line px-2 py-1">
                  {inline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Block =
  | { kind: "text" | "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table" | "code"; lines: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
    } else if (line.startsWith("```")) {
      const end = lines.findIndex((entry, at) => at > index && entry.startsWith("```"));
      const stop = end === -1 ? lines.length : end;
      blocks.push({ kind: "code", lines: lines.slice(index + 1, stop) });
      index = stop + 1;
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push({ kind: "heading", text: line.replace(/^#+\s+/, "") });
      index += 1;
    } else if (line.includes("|") && TABLE_RULE.test(lines[index + 1] ?? "")) {
      let stop = index + 2;
      while (stop < lines.length && (lines[stop] ?? "").includes("|")) {
        stop += 1;
      }
      blocks.push({ kind: "table", lines: lines.slice(index, stop) });
      index = stop;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (/^\s*([-*]|\d+\.)\s/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, ""));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
    } else {
      blocks.push({ kind: "text", text: line });
      index += 1;
    }
  }
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-[1.45] [overflow-wrap:anywhere]">
      {parseBlocks(text).map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "heading":
            return (
              <p key={key} className="m-0 font-bold">
                {inline(block.text)}
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={key}
                className={`m-0 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: finished list items never move.
                  <li key={at}>{inline(item)}</li>
                ))}
              </List>
            );
          }
          case "table":
            return <Table key={key} lines={block.lines} />;
          case "code":
            return (
              <pre
                key={key}
                className="m-0 overflow-x-auto rounded-control bg-hover p-2 text-[12px]"
              >
                {block.lines.join("\n")}
              </pre>
            );
          default:
            return (
              <p key={key} className="m-0">
                {inline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
