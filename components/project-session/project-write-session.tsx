"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_WRITE_SESSION_HEADER, PROJECT_WRITE_SESSION_HEARTBEAT_MS, PROJECT_WRITE_SESSION_IDLE_MS, type ProjectWriteSessionCredential as Credential, type ProjectWriteSessionStatus as Status } from "@/lib/research/project-write-session-contract";

type SessionContext = {
  writable: boolean;
  setPendingWork: (key: string, pending: boolean) => void;
  release: () => Promise<void>;
  canRelease: boolean;
  restore: () => void;
  canRestore: boolean;
  check: () => Promise<void>;
  checking: boolean;
  accessMessage: string;
  inspect: () => Promise<Status>;
  resumeEdit: (expectedOwnerGeneration: string | null) => Promise<Status>;
  pendingLocalWork: boolean;
};

const WriteSessionContext = createContext<SessionContext>({ writable: true, setPendingWork: () => {}, release: async () => {}, canRelease: false, restore: () => {}, canRestore: false, check: async () => {}, checking: false, accessMessage: "", inspect: async () => { throw new Error("Open a project to check editing access."); }, resumeEdit: async () => { throw new Error("Open a project to resume editing."); }, pendingLocalWork: false });
export function useProjectWriteSession() { return useContext(WriteSessionContext); }

// This module is scoped to one browser document. It carries an idle lease
// across client-side navigation without sharing ownership with duplicated tabs.
const navigationContinuations = new Map<string, Credential>();

export function takeProjectNavigationSession(project: string): Credential | undefined {
  const key = `openbar:write-session:${project}`;
  const saved = navigationContinuations.get(key);
  navigationContinuations.delete(key);
  return saved;
}

function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ProjectWriteSession({ project, children, publicDemo = false }: { project: string; children: React.ReactNode; publicDemo?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [writable, setWritable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [idleYielded, setIdleYielded] = useState(false);
  const [pendingWork, setPendingWorkState] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const pendingKeys = useRef(new Set<string>());
  const pendingRequests = useRef(0);
  const releasing = useRef(false);
  const mounted = useRef(false);
  const credential = useRef<Credential | null>(null);
  const heldWriterLease = useRef(false);
  const firstCheck = useRef(true);
  const lastActivity = useRef(Date.now());
  const reloadTimer = useRef<number | null>(null);
  const storageKey = `openbar:write-session:${project}`;
  const endpoint = `/api/p/${encodeURIComponent(project)}/write-session`;

  const setPendingWork = useCallback((key: string, pending: boolean) => {
    if (pending) pendingKeys.current.add(key);
    else pendingKeys.current.delete(key);
    setPendingWorkState(pendingKeys.current.size > 0);
  }, []);

  useEffect(() => {
    if (publicDemo) return;
    const original = window.fetch;
    const wrapped: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const action = method === "POST" && headers.has("next-action");
      const projectMutation = method !== "GET" && method !== "HEAD" && url.pathname.startsWith(`/api/p/${encodeURIComponent(project)}/`) && url.pathname !== endpoint;
      if (url.origin === window.location.origin && credential.current && (action || projectMutation)) {
        if (releasing.current) return Promise.reject(new Error("Editing access is being released. Try again after starting editing."));
        headers.set(PROJECT_WRITE_SESSION_HEADER, JSON.stringify(credential.current));
        lastActivity.current = Date.now();
        pendingRequests.current++;
        if (mounted.current) setPendingRequestCount(pendingRequests.current);
        const finish = () => {
          pendingRequests.current--;
          if (mounted.current) setPendingRequestCount(pendingRequests.current);
        };
        try {
          return original(input, { ...init, headers }).finally(finish);
        } catch (error) {
          finish();
          throw error;
        }
      }
      return original(input, init);
    };
    window.fetch = wrapped;
    return () => { if (window.fetch === wrapped) window.fetch = original; };
  }, [project, endpoint, publicDemo]);

  const request = useCallback(async (action: "acquire" | "resume" | "heartbeat" | "release" | "takeover", existing?: Credential, expectedOwnerGeneration?: string | null) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sessionId: existing?.sessionId || newSessionId(), credential: existing, expectedOwnerGeneration }),
      cache: "no-store",
    });
    return response.json() as Promise<{ ok: boolean; status?: Status; credential?: Credential; message?: string }>;
  }, [endpoint]);

  const readStatus = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store", ...(credential.current ? { headers: { [PROJECT_WRITE_SESSION_HEADER]: JSON.stringify(credential.current) } } : {}) });
    const result = await response.json() as { status?: Status };
    if (!response.ok || !result.status) throw new Error("Could not check editing access.");
    return result.status;
  }, [endpoint]);

  const record = useCallback((value: Credential | null) => {
    credential.current = value;
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify({ credential: value, continuationReady: false }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The lease still works for the lifetime of this page. */ }
  }, [storageKey]);

  const inspect = useCallback(async () => {
    const current = credential.current;
    const next = await readStatus();
    if (mounted.current && credential.current === current) {
      setStatus(next);
      if (current && !next.writable) {
        record(null);
        setWritable(false);
        setMessage("Editing access changed. Your open draft stays in this tab.");
      }
    }
    return next;
  }, [readStatus, record]);

  const check = useCallback(async () => {
    setWorking(true);
    setMessage(null);
    try { await inspect(); }
    catch { if (mounted.current) setMessage("Could not check editing access. Try again."); }
    finally { if (mounted.current) setWorking(false); }
  }, [inspect]);

  const claim = useCallback(async (resume?: Credential, refresh = true) => {
    setWorking(true);
    setMessage(null);
    try {
      const result = await request(resume ? "resume" : "acquire", resume);
      if (!mounted.current) {
        if (result.ok && result.credential) {
          try { await request("release", result.credential); } catch { /* The lease expires if release cannot reach the server. */ }
        }
        return;
      }
      if (result.status) setStatus(result.status);
      if (result.ok && result.credential) {
        lastActivity.current = Date.now();
        setIdleYielded(false);
        heldWriterLease.current = true;
        record(result.credential);
        setWritable(true);
        if (refresh && pendingKeys.current.size === 0) router.refresh();
      } else {
        record(null);
        setWritable(false);
        if (result.message) setMessage(result.message);
      }
    } catch {
      setWritable(false);
      setMessage("Could not check editing access. Your open draft stays in this tab.");
    } finally { setWorking(false); }
  }, [record, request, router]);

  const release = useCallback(async (idle = false) => {
    const current = credential.current;
    if (!current || (!idle && pendingKeys.current.size) || pendingRequests.current || releasing.current) return;
    releasing.current = true;
    setWorking(true);
    try {
      const result = await request("release", current);
      if (result.status) setStatus(result.status);
      if (!result.ok) { record(null); setWritable(false); setMessage(result.message || "Editing access changed. Your open draft stays in this tab."); return; }
      record(null);
      setWritable(false);
      setIdleYielded(idle);
      setMessage(null);
    } catch { setMessage("Could not release editing access. Try again."); }
    finally { releasing.current = false; setWorking(false); }
  }, [record, request]);

  useEffect(() => {
    if (publicDemo) return;
    mounted.current = true;
    let stopped = false;
    const start = async () => {
      let saved: { credential?: Credential; continuationReady?: boolean } | null = null;
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* Start a fresh session. */ }
      const resume = navigationContinuations.get(storageKey) || (saved?.continuationReady ? saved.credential : undefined);
      navigationContinuations.delete(storageKey);
      record(null);
      if (resume) { await claim(resume, false); return; }
      try {
        const next = await readStatus();
        if (stopped) return;
        setStatus(next);
        if (firstCheck.current && next.state === "available") await claim(undefined, false);
        firstCheck.current = false;
      } catch { if (!stopped) setMessage("Could not check editing access."); }
    };
    // Deferring startup lets development-mode effect replay cancel the first
    // setup before it sends a lease request.
    const startTimer = window.setTimeout(() => void start(), 0);
    const timer = window.setInterval(async () => {
      if (releasing.current) return;
      const current = credential.current;
      if (current && pendingRequests.current === 0 && Date.now() - lastActivity.current >= PROJECT_WRITE_SESSION_IDLE_MS) {
        await release(true);
        return;
      }
      try {
        if (current) {
          const result = await request("heartbeat", current);
          if (stopped || credential.current !== current) return;
          if (result.status) setStatus(result.status);
          if (!result.ok) { record(null); setWritable(false); setMessage(result.message || "Editing access changed. Your open draft stays in this tab."); }
          else { setWritable(true); setMessage(null); }
        } else {
          const next = await readStatus();
          if (!stopped && credential.current === current) setStatus(next);
        }
      } catch { if (!stopped && credential.current === current) { setWritable(false); setMessage("Could not check editing access. Your open draft stays in this tab."); } }
    }, PROJECT_WRITE_SESSION_HEARTBEAT_MS);
    const activity = () => { lastActivity.current = Date.now(); };
    const focus = () => { void check(); };
    const activityEvents = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const event of activityEvents) window.addEventListener(event, activity, { passive: true });
    const pagehide = () => {
      const current = credential.current;
      if (!current) return;
      try { sessionStorage.setItem(storageKey, JSON.stringify({ credential: current, continuationReady: true })); } catch { /* The lease expires if this tab cannot resume. */ }
      const body = JSON.stringify({ action: "release", credential: current });
      try {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) return;
      } catch { /* Use a keepalive request when beacon delivery is unavailable. */ }
      void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setWritable(false);
      if (credential.current) void claim(credential.current);
      else void check();
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("focus", focus);
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(startTimer);
      clearInterval(timer);
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", focus);
      for (const event of activityEvents) window.removeEventListener(event, activity);
      if (credential.current && pendingKeys.current.size === 0 && pendingRequests.current === 0) {
        navigationContinuations.set(storageKey, credential.current);
      }
    };
  }, [check, claim, endpoint, publicDemo, readStatus, record, release, request, storageKey]);

  const resumeEdit = useCallback(async (expectedOwnerGeneration: string | null, replaceDraft = false): Promise<Status> => {
    if (working || releasing.current || pendingRequests.current) throw new Error("Editing access is being checked. Try again shortly.");
    if (pendingKeys.current.size && !replaceDraft) throw Object.assign(new Error("Your draft stays in this tab. Copy or download it and use Resume edit here, or open a fresh project tab."), { code: "conflict" });
    setWorking(true);
    setMessage(null);
    try {
      const result = await request("takeover", undefined, expectedOwnerGeneration);
      if (!mounted.current) {
        if (result.ok && result.credential) await request("release", result.credential).catch(() => {});
        throw new Error("The project page changed. Open the project and resume editing there.");
      }
      if (result.status) setStatus(result.status);
      if (!result.ok || !result.credential || !result.status) throw Object.assign(new Error(result.message || "Editing access changed. Check the current session and try again."), { code: "conflict" });
      heldWriterLease.current = true;
      record(result.credential);
      setIdleYielded(false);
      lastActivity.current = Date.now();
      setWritable(false);
      setMessage("Opening the latest saved project…");
      // A full reload reads the saved project before this document can edit it.
      // pagehide carries the newly acquired credential into the refreshed tab.
      reloadTimer.current = window.setTimeout(() => { reloadTimer.current = null; window.location.reload(); }, 150);
      return result.status;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Editing access could not be resumed. Try again.");
      throw error;
    } finally { setWorking(false); }
  }, [record, request, working]);

  const restore = useCallback(() => {
    if (working || !status) return;
    if (heldWriterLease.current) {
      if (pendingKeys.current.size && !window.confirm("Refreshing will replace the open draft with the saved project. Copy or download your draft first. Refresh now?")) return;
    }
    void resumeEdit(status.ownerGeneration, true).catch(() => {});
  }, [resumeEdit, status, working]);
  const accessMessage = message || (working || !status ? "Checking editing access…" : idleYielded ? `Session idled. ${status.state === "occupied" ? "Another session is editing." : "Editing lock yielded."}` : status.state === "occupied" ? "Another session is editing." : pendingWork && heldWriterLease.current ? "Copy or download your draft before restoring access" : "Viewing only");
  const context = useMemo(() => ({ writable: publicDemo ? true : writable, setPendingWork, release, canRelease: writable && !working && !pendingWork && pendingRequestCount === 0, restore, canRestore: !publicDemo && !working && !writable && Boolean(status) && pendingRequestCount === 0, check, checking: working, accessMessage, inspect, resumeEdit, pendingLocalWork: pendingWork }), [publicDemo, writable, setPendingWork, release, working, pendingWork, pendingRequestCount, restore, status, check, accessMessage, inspect, resumeEdit]);
  return <WriteSessionContext.Provider value={context}>
    {children}
  </WriteSessionContext.Provider>;
}
