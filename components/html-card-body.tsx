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

function highlightMentions(fragment: DocumentFragment) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (AGENT_MENTION_PATTERN.test(node.data) && !node.parentElement?.closest("svg, code")) texts.push(node);
  }
  for (const node of texts) {
    const parts = node.data.split(new RegExp(`(${AGENT_MENTION_PATTERN.source})`, "gi"));
    node.replaceWith(...parts.map(part => {
      if (!AGENT_MENTION_PATTERN.test(part)) return part;
      const mark = document.createElement("mark");
      const fast = part.toLowerCase() === "@stat";
      mark.textContent = fast ? "agent STAT" : part;
      mark.className = fast ? `${styles.agentMention} ${styles.agentStat}` : styles.agentMention;
      return mark;
    }));
  }
}

export function HtmlCardBody({ text }: { text: string }) {
  const container = useRef<HTMLDivElement>(null);
  const oversized = text.length > MAX_HTML_CARD_LENGTH;
  useEffect(() => {
    const element = container.current;
    if (!element || oversized) return;
    const fragment = DOMPurify.sanitize(text, {
      ALLOWED_TAGS: tags, ALLOWED_ATTR: attributes, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
      ADD_URI_SAFE_ATTR: ["aria-label"],
      RETURN_DOM_FRAGMENT: true,
    });
    for (const shape of fragment.querySelectorAll("[fill], [stroke]")) {
      for (const name of ["fill", "stroke"]) {
        const paint = shape.getAttribute(name);
        if (paint !== null && !color.test(paint.trim())) shape.removeAttribute(name);
      }
    }
    highlightMentions(fragment);
    element.replaceChildren(fragment);
  }, [text, oversized]);

  if (oversized) return <span>Shorten this HTML body to display it on the card.</span>;
  return <div ref={container} data-html-card="" className={styles.htmlCard} onWheelCapture={event => {
    const box = event.currentTarget;
    if (box.scrollHeight > box.clientHeight) event.stopPropagation();
  }} />;
}
