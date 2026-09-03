import assert from "node:assert/strict";
import { test } from "node:test";

import { requestIsSameOrigin } from "../lib/server/request-origin";

test("demo reset accepts a same-origin browser request", () => {
  const request = new Request("https://demo.example.test/api/demo/reset", {
    method: "POST",
    headers: {
      origin: "https://demo.example.test",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(requestIsSameOrigin(request), true);
});

test("demo reset rejects cross-site and missing-origin requests", () => {
  const crossSite = new Request("https://demo.example.test/api/demo/reset", {
    method: "POST",
    headers: {
      origin: "https://evil.example.test",
      "sec-fetch-site": "cross-site",
    },
  });
  const missing = new Request("https://demo.example.test/api/demo/reset", { method: "POST" });
  assert.equal(requestIsSameOrigin(crossSite), false);
  assert.equal(requestIsSameOrigin(missing), false);
});
