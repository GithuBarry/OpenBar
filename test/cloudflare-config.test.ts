import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const configPath = path.join(process.cwd(), "wrangler.jsonc");

function readJsonc(): Record<string, unknown> {
  const source = fs.readFileSync(configPath, "utf8");
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

test("wrangler config routes one named Container and one Worker binding", () => {
  const config = readJsonc();
  assert.equal(config.main, "cloudflare/worker.ts");
  assert.equal(config.workers_dev, true);
  const containers = config.containers as Array<Record<string, unknown>>;
  assert.equal(containers.length, 1);
  assert.equal(containers[0]?.class_name, "OpenBarContainer");
  assert.equal(containers[0]?.image, "./deploy/openbar.Dockerfile");
  assert.equal(containers[0]?.max_instances, 1);
  const durableObjects = config.durable_objects as { bindings: Array<Record<string, unknown>> };
  assert.equal(durableObjects.bindings[0]?.name, "OPENBAR_CONTAINER");
  assert.equal(durableObjects.bindings[0]?.class_name, "OpenBarContainer");
  assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["OpenBarContainer"] }]);
});
