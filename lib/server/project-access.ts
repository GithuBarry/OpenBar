import "server-only";

import { headers } from "next/headers";
import { notFound, redirect, unauthorized } from "next/navigation";

import { callerMayAccess } from "@/lib/server/access-policy";
import { assertPublicDemoProject, isPublicDemoMode, publicDemoSlugs } from "@/lib/server/demo-mode";
import {
  cloudflareAccessConfigured,
  cloudflareAccessJwtFromHeaders,
  identityAllowed,
  verifyCloudflareAccessJwt,
} from "@/lib/server/cloudflare-access";
import { findProjectSlugIgnoringCase, getProjectMetadata } from "@/lib/store";

export class ProjectAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectAccessError";
    this.status = status;
  }
}

function accessToken(): string | undefined {
  return process.env.OPENBARRY_ACCESS_TOKEN?.trim() || undefined;
}

export async function requireWorkbenchAccess(): Promise<void> {
  const h = await headers();
  const cfRequired = cloudflareAccessConfigured();
  const identity = cfRequired
    ? await verifyCloudflareAccessJwt(cloudflareAccessJwtFromHeaders(h))
    : null;
  if (cfRequired && identity && !identityAllowed(identity)) {
    throw new ProjectAccessError("Unauthorized project access.", 401);
  }
  const allowed = callerMayAccess({
    host: h.get("x-forwarded-host") || h.get("host") || "",
    origin: h.get("origin"),
    fetchSite: h.get("sec-fetch-site"),
    authorization: h.get("authorization"),
    nodeEnv: process.env.NODE_ENV,
    token: accessToken(),
    cloudflareIdentity: identity,
    cloudflareRequired: cfRequired,
    publicDemo: isPublicDemoMode(),
    localAccess: process.env.OPENBAR_LOCAL_ACCESS === "1",
  });
  if (!allowed) throw new ProjectAccessError("Unauthorized project access.", 401);
}

/** RSC pages: 401 UI via `unauthorized()`, not a leaked project listing. */
export async function requireWorkbenchPage(): Promise<void> {
  try {
    await requireWorkbenchAccess();
  } catch (error) {
    if (error instanceof ProjectAccessError && error.status === 401) unauthorized();
    throw error;
  }
}

/** Confirm the slug exists and the caller may touch that project's private data. */
export async function requireProjectAccess(slug: string): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
    throw new ProjectAccessError("Invalid project slug.", 400);
  }
  await requireWorkbenchAccess();
  try {
    assertPublicDemoProject(slug);
  } catch {
    throw new ProjectAccessError(`Unknown project: ${slug}`, 404);
  }
  if (!getProjectMetadata(slug)) {
    throw new ProjectAccessError(`Unknown project: ${slug}`, 404);
  }
}

/** RSC project pages return the right status UI for both access and existence errors. */
export async function requireProjectPage(slug: string): Promise<void> {
  try {
    await requireProjectAccess(slug);
  } catch (error) {
    if (error instanceof ProjectAccessError && error.status === 401) unauthorized();
    if (error instanceof ProjectAccessError && error.status === 404) {
      await requireWorkbenchPage();
      const url = (await headers()).get("x-openbar-project-url");
      const prefix = `/p/${slug}`;
      if (url && (url === prefix || url.startsWith(prefix + "/") || url.startsWith(prefix + "?"))) {
        const canonical = findProjectSlugIgnoringCase(slug);
        if (canonical && canonical !== slug && (!isPublicDemoMode() || publicDemoSlugs().includes(canonical))) {
          redirect(`/p/${canonical}${url.slice(prefix.length)}`);
        }
      }
      notFound();
    }
    if (error instanceof ProjectAccessError && error.status === 403) notFound();
    throw error;
  }
}
