import fs from "node:fs";
import path from "node:path";

import { withWriteLock } from "@/lib/tex-project/codec";
import { publicDemoSlugs } from "@/lib/server/demo-mode";

export const DEMO_PROJECT_SLUGS = ["command-v", "noveltybench"] as const;
export const DEMO_PROJECT_SLUG = DEMO_PROJECT_SLUGS[0];

export function demoFixtureSource(root = process.cwd()): string {
  return process.env.OPENBAR_DEMO_FIXTURE?.trim()
    || path.join(root, "examples", "published-papers");
}

export function demoProjectDirectory(contentRoot: string, slug: string = DEMO_PROJECT_SLUG): string {
  return path.join(contentRoot, "projects", slug);
}

function assertFixtureSource(sourceRoot: string, slug: string): void {
  const projectFile = path.join(sourceRoot, slug, "manuscript", "openbarry", "project.tex");
  if (!fs.existsSync(projectFile)) throw new Error(`Demo fixture is missing ${projectFile}.`);
}

function copyFixtureAtomically(sourceRoot: string, destination: string, contentRoot: string, slug: string): void {
  assertFixtureSource(sourceRoot, slug);
  const source = path.join(sourceRoot, slug);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const lockFile = path.join(contentRoot, ".openbar-demo-reset.lock");
  withWriteLock(lockFile, () => {
    const stamp = `${process.pid}-${Date.now()}`;
    const stage = `${destination}.stage-${stamp}`;
    const backup = `${destination}.backup-${stamp}`;
    let movedLive = false;
    try {
      fs.cpSync(source, stage, { recursive: true, force: true });
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, backup);
        movedLive = true;
      }
      fs.renameSync(stage, destination);
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (movedLive) {
        if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
        if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      }
      throw error;
    } finally {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    }
  });
}

export function seedDemoFixture(
  contentRoot: string,
  options: { replace?: boolean; slugs?: readonly string[] } = {},
): { slugs: string[]; created: string[]; replaced: string[] } {
  const slugs = [...(options.slugs || publicDemoSlugs())];
  const created: string[] = [];
  const replaced: string[] = [];
  for (const slug of slugs) {
    const destination = demoProjectDirectory(contentRoot, slug);
    const existed = fs.existsSync(destination);
    if (existed && !options.replace) continue;
    copyFixtureAtomically(demoFixtureSource(), destination, contentRoot, slug);
    if (existed) replaced.push(slug);
    else created.push(slug);
  }
  return {
    slugs,
    created,
    replaced,
  };
}

export function resetDemoFixture(contentRoot: string): { slugs: string[]; reset: true } {
  const slugs = publicDemoSlugs();
  for (const slug of slugs) {
    copyFixtureAtomically(demoFixtureSource(), demoProjectDirectory(contentRoot, slug), contentRoot, slug);
  }
  return { slugs, reset: true };
}
