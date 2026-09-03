import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertAdministrativeWriteAllowed,
  assertPublicDemoProject,
  filterProjectsForPublicDemo,
} from "../lib/server/demo-mode";
import { callerMayAccess } from "../lib/server/access-policy";

describe("private published-paper demo policy", () => {
  const enabled = {
    OPENBAR_PUBLIC_DEMO: "1",
    OPENBAR_DEMO_SLUGS: "command-v,noveltybench",
  } as unknown as NodeJS.ProcessEnv;

  it("exposes the two published projects and filters every other project", () => {
    assert.deepEqual(
      filterProjectsForPublicDemo([
        { slug: "command-v" },
        { slug: "noveltybench" },
        { slug: "private-project-a" },
      ], enabled).map((project) => project.slug),
      ["command-v", "noveltybench"],
    );
  });

  it("permits both published slugs and rejects every other project", () => {
    assert.doesNotThrow(() => assertPublicDemoProject("command-v", enabled));
    assert.doesNotThrow(() => assertPublicDemoProject("noveltybench", enabled));
    assert.throws(() => assertPublicDemoProject("private-project-a", enabled), /limited to/);
  });

  it("blocks administrative writes while allowing the explicit demo mode", () => {
    assert.throws(() => assertAdministrativeWriteAllowed("createProject", enabled), /disabled/);
    assert.doesNotThrow(() => assertAdministrativeWriteAllowed("createProject", {} as NodeJS.ProcessEnv));
  });

  it("keeps the public demo request path explicit", () => {
    assert.equal(callerMayAccess({
      host: "demo.example.test",
      origin: "https://demo.example.test",
      fetchSite: "same-origin",
      authorization: null,
      nodeEnv: "production",
      token: undefined,
      publicDemo: true,
    }), true);
    assert.equal(callerMayAccess({
      host: "demo.example.test",
      origin: "https://demo.example.test",
      fetchSite: "same-origin",
      authorization: null,
      nodeEnv: "production",
      token: undefined,
      publicDemo: false,
    }), false);
  });
});
