"use client";

import DOMPurify from "dompurify";
import { useEffect, useRef } from "react";
import { MAX_HTML_CARD_LENGTH } from "@/lib/mindmap/html-card";
import { AGENT_MENTION_PATTERN } from "@/lib/research/agent-mentions";
import styles from "./rich-text.module.css";

const tags = [
  "div", "span", "p", "br", "strong", "b", "em", "i", "small", "sub", "sup", "code",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "figure", "figcaption", "table", "caption", "thead", "tbody", "tr", "th", "td",
  "svg", "title", "desc", "g", "path", "rect", "circle", "ellipse", "line", "polyline",
  "polygon", "text", "tspan",
];
const attributes = [
  "viewBox", "preserveAspectRatio", "role", "aria-label", "scope", "colspan", "rowspan",
  "x", "y", "dx", "dy", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "d", "points", "transform", "fill", "stroke", "opacity",
  "fill-opacity", "fill-rule", "stroke-opacity", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "text-anchor", "dominant-baseline", "font-size", "font-weight",
];
// SVG paints also accept resource URLs. Cards use local color literals only.
const color = /^(?:[a-z]+|#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\))$/i;

function sanitizeCard(text: string) {
  return DOMPurify.sanitize(text, {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    ADD_URI_SAFE_ATTR: ["aria-label"],
    RETURN_DOM_FRAGMENT: true,
  });
}

function highlightMentions(fragment: DocumentFragment, workingNode?: Text, workingOffset?: number) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (AGENT_MENTION_PATTERN.test(node.data) && !node.parentElement?.closest("svg, code")) texts.push(node);
  }
  for (const node of texts) {
    const parts = node.data.split(new RegExp(`(${AGENT_MENTION_PATTERN.source})`, "gi"));
    let offset = 0;
    node.replaceWith(...parts.map((part, index) => {
      const agentWorking = node === workingNode && offset === workingOffset;
      offset += part.length;
      if (index % 2 === 0) return part;
      const mark = document.createElement("mark");
      const fast = part.toLowerCase() === "@stat";
      mark.className = `${styles.agentMention}${fast ? ` ${styles.agentStat}` : ""}${agentWorking ? ` ${styles.agentWorking}` : ""}`;
      if (fast) {
        mark.dataset.agentPriority = "fast-tracked";
        mark.title = agentWorking ? "Agent is working on this fast tracked request" : "Fast tracked agent request";
      } else if (agentWorking) {
        mark.title = "Agent is working on this request";
      }
      if (agentWorking) {
        mark.dataset.agentWorking = "true";
        const spinner = document.createElement("span");
        spinner.className = styles.agentSpinner;
        spinner.setAttribute("aria-hidden", "true");
        mark.appendChild(spinner);
        mark.appendChild(document.createTextNode(fast ? "agent STAT" : part.replace(/^@/, "")));
      } else {
        mark.textContent = fast ? "agent STAT" : part;
      }
      return mark;
    }));
  }
}

export function HtmlCardBody({ text, workingMentionAt }: { text: string; workingMentionAt?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const oversized = text.length > MAX_HTML_CARD_LENGTH;
  useEffect(() => {
    const element = container.current;
    if (!element || oversized) return;
    let fragment: DocumentFragment | undefined;
    let workingNode: Text | undefined;
    let workingOffset: number | undefined;
    if (workingMentionAt !== undefined && workingMentionAt >= 0) {
      // Track the source offset through sanitization without trusting HTML from
      // the card. If the marker was in markup or got removed, render the original.
      const token = `\uE000${crypto.getRandomValues(new Uint32Array(4)).join(".")}\uE001`;
      const marked = sanitizeCard(text.slice(0, workingMentionAt) + token + text.slice(workingMentionAt));
      const walker = document.createTreeWalker(marked, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const offset = node.data.indexOf(token);
        if (offset < 0) continue;
        node.deleteData(offset, token.length);
        workingNode = node;
        workingOffset = offset;
        fragment = marked;
        break;
      }
    }
    fragment ??= sanitizeCard(text);
    for (const shape of fragment.querySelectorAll("[fill], [stroke]")) {
      for (const name of ["fill", "stroke"]) {
        const paint = shape.getAttribute(name);
        if (paint !== null && !color.test(paint.trim())) shape.removeAttribute(name);
      }
    }
    highlightMentions(fragment, workingNode, workingOffset);
    element.replaceChildren(fragment);
  }, [text, oversized, workingMentionAt]);

  if (oversized) return <span>Shorten this HTML body to display it on the card.</span>;
  return <div ref={container} data-html-card="" className={styles.htmlCard} onWheelCapture={event => {
    if (event.ctrlKey) return;
    const box = event.currentTarget;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (horizontal ? box.scrollWidth > box.clientWidth + 1 : box.scrollHeight > box.clientHeight + 1) {
      event.stopPropagation();
    }
  }} />;
}
