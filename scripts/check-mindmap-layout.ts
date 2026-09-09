import assert from "node:assert/strict";

import { layoutMindmapTree, VERTICAL_GAP } from "@/lib/mindmap/layout";
import type { Mindmap, MindmapNode } from "@/lib/types";

type Dimensions = { width: number; height: number };

const nodes: MindmapNode[] = [
  { id: "root", parentId: null, text: "Root" },
  { id: "upper", parentId: "root", order: 0, text: "New datasets" },
  { id: "upper-1", parentId: "upper", order: 0, text: "Privacy only dataset" },
  { id: "upper-2", parentId: "upper", order: 1, text: "Privacy and utility dataset" },
  { id: "upper-3", parentId: "upper-2", order: 0, text: "Routing candidate" },
  { id: "upper-4", parentId: "upper-2", order: 1, text: "EnterpriseOps candidate" },
  { id: "upper-5", parentId: "upper-2", order: 2, text: "Unpromising for the main benchmark" },
  { id: "lower", parentId: "root", order: 1, text: "Better eval" },
  { id: "lower-1", parentId: "lower", order: 0, text: "Goal: define privacy beyond PII" },
  { id: "lower-2", parentId: "lower-1", order: 0, text: "Finding: the answer itself can disclose" },
];

const mindmap: Mindmap = {
  projectId: "layout-check",
  id: "layout-check",
  role: "draft",
  rootId: "root",
  updatedAt: "2026-09-09T00:00:00.000Z",
  nodes,
};

const heights: Record<string, number> = {
  root: 80,
  upper: 210,
  "upper-1": 180,
  "upper-2": 280,
  "upper-3": 340,
  "upper-4": 190,
  "upper-5": 335,
  lower: 230,
  "lower-1": 270,
  "lower-2": 300,
};
const sizes = new Map<string, Dimensions>(
  nodes.map((node) => [node.id, { width: 264, height: heights[node.id]! }]),
);
const positions = layoutMindmapTree(mindmap, sizes).positions;

function branchBounds(ids: string[]): { top: number; bottom: number } {
  return ids.reduce((bounds, id) => {
    const point = positions.get(id);
    assert.ok(point, `Expected a position for ${id}`);
    return {
      top: Math.min(bounds.top, point.y),
      bottom: Math.max(bounds.bottom, point.y + sizes.get(id)!.height),
    };
  }, { top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY });
}

const upper = branchBounds(["upper", "upper-1", "upper-2", "upper-3", "upper-4", "upper-5"]);
const lower = branchBounds(["lower", "lower-1", "lower-2"]);
assert.ok(
  upper.bottom + VERTICAL_GAP <= lower.top,
  `Expected “Unpromising for the main benchmark” to stay with the higher parent branch. Upper bottom ${upper.bottom}, lower top ${lower.top}.`,
);
const candidate = branchBounds(["upper-3"]);
const enterprise = branchBounds(["upper-4"]);
const unpromising = branchBounds(["upper-5"]);
assert.ok(candidate.bottom + VERTICAL_GAP <= enterprise.top);
assert.ok(enterprise.bottom + VERTICAL_GAP <= unpromising.top);

console.log("PASS sibling parent branches stay vertically grouped in saved order");
