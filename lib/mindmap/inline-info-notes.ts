export type InlineInfoSegment =
  | { type: "text"; value: string }
  | { type: "info"; content: string };

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: unknown };

const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "code",
  "thematicBreak",
  "footnoteDefinition",
]);

/**
 * Scan inline `((detail))` annotations while allowing balanced single
 * parentheses inside the note (e.g. `((95% CI (41–49%), n=288))`) and
 * rejecting ordinary math like `((a + b) * (c + d))`.
 */
export function splitInlineInfoNotes(text: string): InlineInfoSegment[] {
  if (!text.includes("((")) return [{ type: "text", value: text }];
  const segments: InlineInfoSegment[] = [];
  let cursor = 0;
  let index = 0;

  const pushText = (chunk: string) => {
    if (!chunk) return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.value += chunk;
    else segments.push({ type: "text", value: chunk });
  };

  while (index < text.length) {
    const start = text.indexOf("((", index);
    if (start < 0) break;
    if (start > 0 && text[start - 1] === "\\") {
      index = start + 2;
      continue;
    }
    let j = start + 2;
    let innerDepth = 0;
    let closeAt = -1;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "(") {
        innerDepth += 1;
        j += 1;
      } else if (ch === ")") {
        if (innerDepth > 0) {
          innerDepth -= 1;
          j += 1;
        } else if (text[j + 1] === ")") {
          closeAt = j;
          break;
        } else {
          // Single unmatched `)` before closing `))` — ordinary grouping like `((a + b) * c)`.
          break;
        }
      } else {
        j += 1;
      }
    }

    if (closeAt >= 0) {
      const content = text.slice(start + 2, closeAt).trim();
      if (content.length > 0) {
        pushText(text.slice(cursor, start));
        segments.push({ type: "info", content });
        cursor = closeAt + 2;
        index = cursor;
        continue;
      }
    }
    index = start + 2;
  }

  pushText(text.slice(cursor));
  return segments.length ? segments : [{ type: "text", value: text }];
}

export function hasInlineInfoNotes(text: string): boolean {
  return text.includes("((") && splitInlineInfoNotes(text).some((segment) => segment.type === "info");
}

export function stripInlineInfoNotes(text: string, replacement = ""): string {
  if (!text.includes("((")) return text;
  return splitInlineInfoNotes(text)
    .map((segment) => (segment.type === "info" ? replacement : segment.value))
    .join("");
}

function findClosingDoubleParen(
  children: readonly MarkdownNode[],
  startIndex: number,
  startOffset: number,
): { endIndex: number; endOffset: number } | null {
  let innerDepth = 0;
  for (let k = startIndex; k < children.length; k += 1) {
    const node = children[k]!;
    if (k > startIndex && BLOCK_NODE_TYPES.has(node.type)) return null;
    if (node.type !== "text") continue;
    const value = node.value || "";
    let j = k === startIndex ? startOffset : 0;
    while (j < value.length) {
      const ch = value[j];
      if (ch === "(") {
        innerDepth += 1;
        j += 1;
      } else if (ch === ")") {
        if (innerDepth > 0) {
          innerDepth -= 1;
          j += 1;
        } else if (value[j + 1] === ")") {
          return { endIndex: k, endOffset: j };
        } else {
          return null;
        }
      } else {
        j += 1;
      }
    }
  }
  return null;
}

function extractPlainText(nodes: readonly MarkdownNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "break" || node.type === "markdownLineBreak") return "\n";
      if (typeof node.value === "string") return node.value;
      if (node.children) return extractPlainText(node.children);
      return "";
    })
    .join("");
}

function trimEdgeTextNodes(nodes: MarkdownNode[]): MarkdownNode[] {
  const result = [...nodes];
  while (result.length > 0 && result[0]!.type === "text") {
    const trimmed = (result[0]!.value || "").replace(/^[ \t]+/, "");
    if (!trimmed) result.shift();
    else {
      result[0] = { ...result[0]!, value: trimmed };
      break;
    }
  }
  while (result.length > 0 && result.at(-1)!.type === "text") {
    const last = result.at(-1)!;
    const trimmed = (last.value || "").replace(/[ \t]+$/, "");
    if (!trimmed) result.pop();
    else {
      result[result.length - 1] = { ...last, value: trimmed };
      break;
    }
  }
  return result;
}

export function remarkInlineInfoNotes() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (
        !node.children
        || node.type === "code"
        || node.type === "inlineCode"
        || node.type === "link"
        || node.type === "linkReference"
        || node.type === "inlineInfoNote"
      ) {
        return;
      }

      const source = node.children;
      const out: MarkdownNode[] = [];

      for (let i = 0; i < source.length; i += 1) {
        let current = source[i]!;
        if (current.type !== "text" || !current.value || !current.value.includes("((")) {
          visit(current);
          out.push(current);
          continue;
        }

        let cursor = 0;
        let scanPos = 0;
        while (true) {
          const text = current.value || "";
          const start = text.indexOf("((", scanPos);
          if (start < 0) {
            if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
            break;
          }
          if (start > 0 && text[start - 1] === "\\") {
            scanPos = start + 2;
            continue;
          }

          const closing = findClosingDoubleParen(source, i, start + 2);
          if (!closing) {
            scanPos = start + 2;
            continue;
          }

          let innerNodes: MarkdownNode[];
          if (closing.endIndex === i) {
            const raw = text.slice(start + 2, closing.endOffset).trim();
            innerNodes = raw ? [{ type: "text", value: raw }] : [];
          } else {
            const parts: MarkdownNode[] = [];
            const head = text.slice(start + 2);
            if (head) parts.push({ type: "text", value: head });
            for (let m = i + 1; m < closing.endIndex; m += 1) {
              parts.push(source[m]!);
            }
            const tailText = (source[closing.endIndex]!.value || "").slice(0, closing.endOffset);
            if (tailText) parts.push({ type: "text", value: tailText });
            innerNodes = trimEdgeTextNodes(parts);
          }

          const label = extractPlainText(innerNodes).trim();
          if (!label) {
            scanPos = start + 2;
            continue;
          }

          if (start > cursor) {
            out.push({ type: "text", value: text.slice(cursor, start) });
          }
          out.push({
            type: "inlineInfoNote",
            data: {
              hName: "span",
              hProperties: { "data-inline-info": label },
            },
            children: innerNodes,
          });

          i = closing.endIndex;
          current = source[i]!;
          cursor = closing.endOffset + 2;
          scanPos = cursor;
        }
      }

      node.children = out;
    };
    visit(tree);
  };
}
