import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { fetchWithRetry } from "../scripts/smoke-http";

test("HTTP smoke retries cold-start gateway statuses", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    if (requests < 3) {
      response.statusCode = 503;
      response.end("starting");
      return;
    }
    response.statusCode = 200;
    response.end("ready");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetchWithRetry(`http://127.0.0.1:${address.port}`, undefined, { timeoutMs: 2_000, intervalMs: 5 });
    assert.equal(response.status, 200);
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("HTTP smoke returns a non-retryable response immediately", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end("missing");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetchWithRetry(`http://127.0.0.1:${address.port}`, undefined, { timeoutMs: 100, intervalMs: 5 });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
