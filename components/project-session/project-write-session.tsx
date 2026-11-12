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
  accessError: string | null;
  inspect: () => Promise<Status>;
  resumeEdit: (expectedOwnerGeneration: string | null) => Promise<Status>;
  pendingLocalWork: boolean;
  getDiagnostics: () => Record<string, unknown>;
};

const WriteSessionContext = createContext<SessionContext>({ writable: true, setPendingWork: () => {}, release: async () => {}, canRelease: false, restore: () => {}, canRestore: false, check: async () => {}, checking: false, accessMessage: "", accessError: null, inspect: async () => { throw new Error("Open a project to check editing access."); }, resumeEdit: async () => { throw new Error("Open a project to resume editing."); }, pendingLocalWork: false, getDiagnostics: () => ({ state: "unavailable" }) });
export function useProjectWriteSession() { return useContext(WriteSessionContext); }

type SessionResponse = { ok: boolean; status?: Status; credential?: Credential; code?: string; message?: string };
type AccessOperation = { action: string; startedAt: number; finishedAt: number | null; httpStatus: number | null; code: string | null; outcome: "pending" | "ok" | "denied" | "error"; message?: string };
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_MS = 2_000;

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
  const [accessError, setAccessError] = useState<string | null>(null);
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
  const expiryTimer = useRef<number | null>(null);
  const leaseDeadline = useRef(0);
  const lastConfirmation = useRef<{ expiresAt: number; serverTime: number; receivedAt: number; clockDeltaMs: number } | null>(null);
  const lastSuccessfulHeartbeat = useRef<number | null>(null);
  const lastOperation = useRef<AccessOperation | null>(null);
  const operationTrace = useRef<AccessOperation[]>([]);
  const storageKey = `openbar:write-session:${project}`;
  const endpoint = `/api/p/${encodeURIComponent(project)}/write-session`;

  const setPendingWork = useCallback((key: string, pending: boolean) => {
    if (pending) { pendingKeys.current.add(key); lastActivity.current = Date.now(); }
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

  const fetchSession = useCallback(async (action: string, init?: RequestInit): Promise<SessionResponse> => {
    const started = performance.now();
    const operation: AccessOperation = { action, startedAt: Date.now(), finishedAt: null, httpStatus: null, code: null, outcome: "pending" };
    lastOperation.current = operation;
    try {
      const response = await fetch(endpoint, { ...init, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      operation.httpStatus = response.status;
      const result = await response.json().catch(() => null) as SessionResponse | null;
      operation.code = result?.code || null;
      if (!result || response.status >= 500 || response.status === 408 || response.status === 429 || (action === "status" && !response.ok)) {
        throw new Error(result?.message || `Editing access returned HTTP ${response.status} ${response.statusText}.`);
      }
      operation.outcome = result.ok || (action === "status" && response.ok && result.status) ? "ok" : "denied";
      if (result.message) operation.message = result.message;
      const next = result.status;
      const generation = result.credential?.generation || credential.current?.generation;
      if (response.ok && next?.writable && next.expiresAt !== null && next.ownerGeneration === generation) {
        const receivedAt = Date.now();
        const deadline = started + Math.max(0, next.expiresAt - next.serverTime);
        leaseDeadline.current = deadline;
        lastConfirmation.current = { expiresAt: next.expiresAt, serverTime: next.serverTime, receivedAt, clockDeltaMs: next.serverTime - receivedAt };
        if (action === "heartbeat") lastSuccessfulHeartbeat.current = receivedAt;
        if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
        expiryTimer.current = window.setTimeout(() => {
          if (mounted.current && credential.current?.generation === generation && leaseDeadline.current === deadline) {
            setWritable(false);
            setAccessError("Editing access expired. Your open draft stays in this tab.");
          }
        }, Math.max(0, deadline - performance.now()));
      }
      return result;
    } catch (error) {
      operation.outcome = "error";
      operation.message = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      operation.finishedAt = Date.now();
      if (lastOperation.current === operation) lastOperation.current = { ...operation };
      operationTrace.current = [...operationTrace.current.slice(-11), { ...operation }];
    }
  }, [endpoint]);

  const request = useCallback((action: "acquire" | "resume" | "heartbeat" | "release" | "takeover", existing?: Credential, expectedOwnerGeneration?: string | null) => fetchSession(action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sessionId: existing?.sessionId || newSessionId(), credential: existing, expectedOwnerGeneration }),
  }), [fetchSession]);

  const readStatus = useCallback(async () => {
    const result = await fetchSession("status", credential.current ? { headers: { [PROJECT_WRITE_SESSION_HEADER]: JSON.stringify(credential.current) } } : undefined);
    if (!result.status) throw new Error(result.message || "Editing access returned an incomplete status.");
    return result.status;
  }, [fetchSession]);

  const record = useCallback((value: Credential | null) => {
    credential.current = value;
    if (!value) {
      leaseDeadline.current = 0;
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
    }
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify({ credential: value, continuationReady: false }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The lease still works for the lifetime of this page. */ }
  }, [storageKey]);

  const inspect = useCallback(async () => {
    const current = credential.current;
    const next = await readStatus();
    setAccessError(null);
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
    setAccessError(null);
    try { await inspect(); }
    catch (error) { if (mounted.current) setAccessError(`Access check failed. ${error instanceof Error ? error.message : String(error)}`); }
    finally { if (mounted.current) setWorking(false); }
  }, [inspect]);

  const claim = useCallback(async (resume?: Credential, refresh = true) => {
    setWorking(true);
    setMessage(null);
    setAccessError(null);
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
    } catch (error) {
      setWritable(false);
      setAccessError(`Resume edit failed. ${error instanceof Error ? error.message : String(error)}`);
    } finally { setWorking(false); }
  }, [record, request, router]);

  const release = useCallback(async (idle = false) => {
    const current = credential.current;
    if (!current || pendingKeys.current.size || pendingRequests.current || releasing.current) return;
    releasing.current = true;
    setWorking(true);
    setAccessError(null);
    try {
      const result = await request("release", current);
      if (result.status) setStatus(result.status);
      if (!result.ok) { record(null); setWritable(false); setMessage(result.message || "Editing access changed. Your open draft stays in this tab."); return; }
      record(null);
      setWritable(false);
      setIdleYielded(idle);
      setMessage(null);
    } catch (error) { setAccessError(`Release failed. ${error instanceof Error ? error.message : String(error)}`); }
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
      } catch (error) { if (!stopped) setAccessError(`Access check failed. ${error instanceof Error ? error.message : String(error)}`); }
    };
    // Deferring startup lets development-mode effect replay cancel the first
    // setup before it sends a lease request.
    const startTimer = window.setTimeout(() => void start(), 0);
    let polling = false;
    let retryTimer: number | null = null;
    const poll = async () => {
      if (stopped || polling || releasing.current) return;
      if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
      polling = true;
      const current = credential.current;
      try {
        if (current && pendingKeys.current.size === 0 && pendingRequests.current === 0 && Date.now() - lastActivity.current >= PROJECT_WRITE_SESSION_IDLE_MS) {
          await release(true);
          return;
        }
        if (current) {
          const result = await request("heartbeat", current);
          if (stopped || credential.current !== current) return;
          if (result.status) setStatus(result.status);
          if (!result.ok) { record(null); setWritable(false); setMessage(result.message || "Editing access changed. Your open draft stays in this tab."); }
          else { setWritable(true); setMessage(null); setAccessError(null); }
        } else {
          const next = await readStatus();
          if (!stopped && credential.current === current) { setStatus(next); setAccessError(null); }
        }
      } catch (error) {
        if (!stopped && credential.current === current) {
          const remaining = current ? leaseDeadline.current - performance.now() : 0;
          if (remaining <= 0) setWritable(false);
          setAccessError(`Access check failed. ${error instanceof Error ? error.message : String(error)}`);
          if (remaining > 0) retryTimer = window.setTimeout(() => { retryTimer = null; void poll(); }, Math.min(RETRY_MS, remaining));
        }
      } finally { polling = false; }
    };
    const timer = window.setInterval(() => void poll(), PROJECT_WRITE_SESSION_HEARTBEAT_MS);
    const activity = () => { lastActivity.current = Date.now(); };
    const focus = () => { activity(); void poll(); };
    const visibility = () => { if (document.visibilityState === "visible") focus(); };
    const activityEvents = ["pointerdown", "pointermove", "keydown", "input", "beforeinput", "compositionstart", "compositionend", "wheel", "touchstart"] as const;
    for (const event of activityEvents) window.addEventListener(event, activity, { passive: true, capture: true });
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
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(startTimer);
      clearInterval(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      for (const event of activityEvents) window.removeEventListener(event, activity, true);
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
    setAccessError(null);
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
      setAccessError(`Resume edit failed. ${error instanceof Error ? error.message : String(error)}`);
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
  const accessMessage = accessError || message || (working || !status ? "Checking access…" : idleYielded ? "Session idle. Editing paused." : status.state === "occupied" ? "Another session is editing." : pendingWork && heldWriterLease.current ? "Save your draft first." : "View only");
  const getDiagnostics = useCallback(() => ({
    endpoint, state: status?.state || "checking", writable: publicDemo || writable,
    reason: accessMessage, accessError, checking: working, idleYielded,
    hasSession: Boolean(credential.current), sessionIdPrefix: credential.current?.sessionId.slice(0, 8) || null,
    generation: credential.current?.generation || null, ownerGeneration: status?.ownerGeneration || null,
    expiresAt: status?.expiresAt || null, serverTime: status?.serverTime || null,
    confirmation: lastConfirmation.current, leaseRemainingMs: Math.max(0, Math.round(leaseDeadline.current - performance.now())),
    lastSuccessfulHeartbeat: lastSuccessfulHeartbeat.current,
    lastOperation: lastOperation.current, operations: operationTrace.current,
    pendingKeys: [...pendingKeys.current], pendingRequests: pendingRequests.current,
    visibility: document.visibilityState, lastActivityAt: lastActivity.current,
    idleForMs: Math.max(0, Date.now() - lastActivity.current),
    heartbeatMs: PROJECT_WRITE_SESSION_HEARTBEAT_MS, idleTimeoutMs: PROJECT_WRITE_SESSION_IDLE_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS,
  }), [endpoint, status, publicDemo, writable, accessMessage, accessError, working, idleYielded]);
  const context = useMemo(() => ({ writable: publicDemo ? true : writable, setPendingWork, release, canRelease: writable && !working && !pendingWork && pendingRequestCount === 0, restore, canRestore: !publicDemo && !working && !writable && Boolean(status) && pendingRequestCount === 0, check, checking: working, accessMessage, accessError, inspect, resumeEdit, pendingLocalWork: pendingWork, getDiagnostics }), [publicDemo, writable, setPendingWork, release, working, pendingWork, pendingRequestCount, restore, status, check, accessMessage, accessError, inspect, resumeEdit, getDiagnostics]);
  return <WriteSessionContext.Provider value={context}>
    {children}
  </WriteSessionContext.Provider>;
}
