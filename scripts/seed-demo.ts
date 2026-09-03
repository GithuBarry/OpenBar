#!/usr/bin/env npx tsx
import path from "node:path";

import { seedDemoFixture } from "../lib/research/demo-fixture";

const root = process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");
const result = seedDemoFixture(root, { replace: process.argv.includes("--replace") });
console.log(result.replaced.length
  ? `Replaced demo projects ${result.replaced.join(", ")} under ${root}`
  : result.created.length
    ? `Seeded demo projects ${result.created.join(", ")} under ${root}`
    : `Demo projects ${result.slugs.join(", ")} already exist`);
