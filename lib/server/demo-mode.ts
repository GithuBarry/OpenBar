export type PublicDemoConfig = {
  enabled: boolean;
  slugs: string[];
  fixture: string | undefined;
};

const PUBLIC_DEMO_VALUES = /^(?:1|true|yes)$/i;
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_PUBLIC_DEMO_SLUGS = ["command-v", "noveltybench"];

function parseDemoSlugs(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OPENBAR_DEMO_SLUGS?.trim()
    || env.OPENBAR_DEMO_SLUG?.trim()
    || DEFAULT_PUBLIC_DEMO_SLUGS.join(",");
  const slugs = [...new Set(raw.split(",").map((slug) => slug.trim()).filter(Boolean))];
  if (!slugs.length || slugs.some((slug) => !SAFE_SLUG.test(slug))) {
    throw new Error("OPENBAR_DEMO_SLUGS must contain safe project slugs.");
  }
  return slugs;
}

export function publicDemoConfig(env: NodeJS.ProcessEnv = process.env): PublicDemoConfig {
  const enabled = PUBLIC_DEMO_VALUES.test(env.OPENBAR_PUBLIC_DEMO?.trim() || "");
  return {
    enabled,
    slugs: parseDemoSlugs(env),
    fixture: env.OPENBAR_DEMO_FIXTURE?.trim() || undefined,
  };
}

export function isPublicDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return publicDemoConfig(env).enabled;
}

export function publicDemoSlug(env: NodeJS.ProcessEnv = process.env): string {
  return publicDemoConfig(env).slugs[0];
}

export function publicDemoSlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  return publicDemoConfig(env).slugs;
}

export function filterProjectsForPublicDemo<T extends { slug: string }>(
  projects: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  const config = publicDemoConfig(env);
  return config.enabled ? projects.filter((project) => config.slugs.includes(project.slug)) : [...projects];
}

export function assertPublicDemoProject(slug: string, env: NodeJS.ProcessEnv = process.env): void {
  const config = publicDemoConfig(env);
  if (config.enabled && !config.slugs.includes(slug)) {
    throw new Error(`Public demo project access is limited to: ${config.slugs.join(", ")}.`);
  }
}

export function assertAdministrativeWriteAllowed(operation: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isPublicDemoMode(env)) throw new Error(`${operation} is disabled in the public demo.`);
}
