"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_WRITE_SESSION_HEADER, PROJECT_WRITE_SESSION_HEARTBEAT_MS, PROJECT_WRITE_SESSION_IDLE_MS, type ProjectWriteSessionCredential as Credential, type ProjectWriteSessionStatus as Status } from "@/lib/research/project-write-session-contract";
import { projectWriteSessionDiagnosticAccess } from "@/lib/research/project-write-session-diagnostics";
import { isBackendTransportError, markBackendTransportError } from "@/lib/backend-connection";
import type { HostResources } from "@/lib/host-resources";

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
  connectionState: "connected" | "reconnecting";
  connectionError: string | null;
  lastSuccessfulConnection: number | null;
  isBackendUnavailable: () => boolean;
  hostResources: HostResources | null;
  inboxRevision?: string;
};

const defaultSession: SessionContext = { writable: true, setPendingWork: () => {}, release: async () => {}, canRelease: false, restore: () => {}, canRestore: false, check: async () => {}, checking: false, accessMessage: "", accessError: null, inspect: async () => { throw new Error("Open a project to check editing access."); }, resumeEdit: async () => { throw new Error("Open a project to resume editing."); }, pendingLocalWork: false, getDiagnostics: () => ({ state: "unavailable" }), connectionState: "connected", connectionError: null, lastSuccessfulConnection: null, isBackendUnavailable: () => false, hostResources: null }
const WriteSessionContext = createContext<SessionContext>(defaultSession)
const viewOnlySession: SessionContext = { ...defaultSession, writable: false, accessMessage: "View only", getDiagnostics: () => ({ state: "view-only", writable: false }) }
export function useProjectWriteSession() { return useContext(WriteSessionContext); }

export function ViewOnlyProjectSession({ children }: { children: React.ReactNode }) {
  return <WriteSessionContext.Provider value={viewOnlySession}>{children}</WriteSessionContext.Provider>
}

type SessionResponse = { ok: boolean; status?: Status; credential?: Credential; code?: string; message?: string; hostResources?: HostResources | null; inboxRevision?: string };
type AccessOperation = { action: string; startedAt: number; finishedAt: number | null; httpStatus: number | null; code: string | null; outcome: "pending" | "ok" | "denied" | "error"; message?: string };
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_MS = 2_000;

function validStatus(value: unknown): value is Status {
  if (!value || typeof value !== "object") return false;
  const status = value as Status;
  return (status.state === "available" || status.state === "occupied") && typeof status.writable === "boolean"
    && Number.isFinite(status.serverTime) && (status.expiresAt === null || Number.isFinite(status.expiresAt))
    && (status.ownerGeneration === null || typeof status.ownerGeneration === "string")
    && (status.ownerLabel === null || typeof status.ownerLabel === "string")
    && (!status.writable || (status.state === "occupied" && typeof status.ownerGeneration === "string" && status.expiresAt !== null && status.expiresAt > status.serverTime));
}

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
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting">("connected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastSuccessfulConnection, setLastSuccessfulConnection] = useState<number | null>(null);
  const [hostResources, setHostResources] = useState<HostResources | null>(null);
  const [inboxRevision, setInboxRevision] = useState<string>();
  const lastInboxRevisionOrder = useRef(0);
  const backendUnavailable = useRef(false);
  const connectionSequence = useRef(0);
  const lastConnectionResult = useRef(0);
  const wakePolling = useRef<(() => void) | null>(null);
  const transportAccessError = useRef(false);
  const pendingKeys = useRef(new Set<string>());
  const pendingRequests = useRef(0);
  const releasing = useRef(false);
  const manuallyReleased = useRef(false);
  const mounted = useRef(false);
  const credential = useRef<Credential | null>(null);
  const heldWriterLease = useRef(false);
  const firstCheck = useRef(true);
  const lastActivity = useRef(Date.now());
  const reloadTimer = useRef<number | null>(null);
  const expiryTimer = useRef<number | null>(null);
  const leaseDeadline = useRef(0);
  const lastLeaseConfirmationOrder = useRef(0);
  const lastConfirmation = useRef<{ expiresAt: number; serverTime: number; receivedAt: number; clockDeltaMs: number } | null>(null);
  const lastSuccessfulHeartbeat = useRef<number | null>(null);
  const lastOperation = useRef<AccessOperation | null>(null);
  const operationTrace = useRef<AccessOperation[]>([]);
  const lastHostSampleRequest = useRef(-Infinity);
  const storageKey = `openbar:write-session:${project}`;
  const endpoint = `/api/p/${encodeURIComponent(project)}/write-session`;

  const isBackendUnavailable = useCallback(() => backendUnavailable.current, []);
  const requestError = useCallback((prefix: string, error: unknown) => {
    if (isBackendTransportError(error) && !backendUnavailable.current) return;
    transportAccessError.current = isBackendTransportError(error);
    setAccessError(`${prefix} ${error instanceof Error ? error.message : String(error)}`);
  }, []);
  const connectionSucceeded = useCallback((sequence: number) => {
    if (sequence < lastConnectionResult.current) return;
    lastConnectionResult.current = sequence;
    backendUnavailable.current = false;
    if (mounted.current) {
      setConnectionState("connected");
      setConnectionError(null);
      setLastSuccessfulConnection(Date.now());
    }
  }, []);
  const connectionFailed = useCallback((sequence: number, error: Error) => {
    if (sequence < lastConnectionResult.current || !mounted.current) return;
    lastConnectionResult.current = sequence;
    backendUnavailable.current = true;
    setConnectionState("reconnecting");
    setConnectionError(error.message);
    wakePolling.current?.();
  }, []);

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
      const sameOrigin = url.origin === window.location.origin;
      const admitted = sameOrigin && Boolean(credential.current) && (action || projectMutation);
      if (admitted) {
        if (releasing.current) return Promise.reject(new Error("Editing access is being released. Try again after starting editing."));
        headers.set(PROJECT_WRITE_SESSION_HEADER, JSON.stringify(credential.current));
        lastActivity.current = Date.now();
        pendingRequests.current++;
        if (mounted.current) setPendingRequestCount(pendingRequests.current);
      }
      const observed = sameOrigin && (url.pathname.startsWith("/api/") || action);
      const sequence = observed ? ++connectionSequence.current : 0;
      const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
      let pending: Promise<Response>;
      try { pending = original(input, admitted ? { ...init, headers } : init); }
      catch (error) { pending = Promise.reject(error); }
      return pending.then(response => {
        if (observed) {
          if ([502, 503, 504].includes(response.status) && !response.headers.get("content-type")?.includes("application/json")) {
            throw markBackendTransportError(Object.assign(new Error(`OpenBar returned HTTP ${response.status}. Reconnecting…`), { httpStatus: response.status }));
          }
          if (url.pathname !== endpoint) connectionSucceeded(sequence);
        }
        return response;
      }).catch(error => {
        const name = error && typeof error === "object" && "name" in error ? error.name : "";
        const timeout = name === "TimeoutError" || signal?.reason?.name === "TimeoutError";
        if (observed && (timeout || (name !== "AbortError" && !signal?.aborted))) {
          const transportError = markBackendTransportError(error);
          connectionFailed(sequence, transportError);
          throw transportError;
        }
        throw error;
      }).finally(() => {
        if (admitted) {
          pendingRequests.current--;
          if (mounted.current) setPendingRequestCount(pendingRequests.current);
        }
      });
    };
    window.fetch = wrapped;
    return () => { if (window.fetch === wrapped) window.fetch = original; };
  }, [project, endpoint, publicDemo, connectionSucceeded, connectionFailed]);

  const fetchSession = useCallback(async (action: string, init?: RequestInit): Promise<SessionResponse> => {
    const started = performance.now();
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let connectionOrder = 0;
    const operation: AccessOperation = { action, startedAt: Date.now(), finishedAt: null, httpStatus: null, code: null, outcome: "pending" };
    lastOperation.current = operation;
    try {
      const pending = fetch(endpoint, { ...init, cache: "no-store", signal });
      connectionOrder = connectionSequence.current;
      const response = await pending;
      operation.httpStatus = response.status;
      const result = await response.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }) as SessionResponse | null;
      operation.code = result?.code || null;
      const expectedDenial = [401, 403, 409, 423].includes(response.status);
      if (!expectedDenial && (!result || typeof result !== "object" || Array.isArray(result) || (response.ok && !validStatus(result.status)))) {
        const error = markBackendTransportError(new Error("OpenBar returned an incomplete editing-session response. Reconnecting…"));
        connectionFailed(connectionOrder, error);
        throw error;
      }
      connectionSucceeded(connectionOrder);
      if (!backendUnavailable.current && transportAccessError.current) { transportAccessError.current = false; setAccessError(null); }
      if (!result || response.status >= 500 || response.status === 408 || response.status === 429 || (action === "status" && !response.ok)) {
        throw new Error(result?.message || `Editing access returned HTTP ${response.status} ${response.statusText}.`);
      }
      operation.outcome = result.ok || (action === "status" && response.ok && result.status) ? "ok" : "denied";
      if (result.message) operation.message = result.message;
      const next = result.status;
      if (response.ok && next && typeof result.inboxRevision === "string" && connectionOrder >= lastInboxRevisionOrder.current) {
        lastInboxRevisionOrder.current = connectionOrder;
        setInboxRevision(result.inboxRevision);
      }
      if (response.ok && next && Number.isFinite(next.serverTime) && result.hostResources !== undefined && started >= lastHostSampleRequest.current && mounted.current && !backendUnavailable.current) {
        lastHostSampleRequest.current = started;
        const sample = result.hostResources;
        // Preserve sample age across host/client clock differences and network delay.
        setHostResources(sample ? { ...sample, sampledAt: Date.now() - Math.max(0, next.serverTime - sample.sampledAt) - (performance.now() - started) } : null);
      }
      const generation = result.credential?.generation || credential.current?.generation;
      if (response.ok && next?.writable && next.expiresAt !== null && next.ownerGeneration === generation && connectionOrder >= lastLeaseConfirmationOrder.current) {
        lastLeaseConfirmationOrder.current = connectionOrder;
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
      if (error && typeof error === "object" && "httpStatus" in error && typeof error.httpStatus === "number") operation.httpStatus = error.httpStatus;
      if (error instanceof TypeError || (signal.aborted && signal.reason?.name === "TimeoutError")) {
        const transportError = markBackendTransportError(error);
        connectionFailed(connectionOrder, transportError);
        throw transportError;
      }
      throw error;
    } finally {
      operation.finishedAt = Date.now();
      if (lastOperation.current === operation) lastOperation.current = { ...operation };
      operationTrace.current = [...operationTrace.current.slice(-11), { ...operation }];
    }
  }, [endpoint, connectionFailed, connectionSucceeded]);

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
    catch (error) { if (mounted.current) requestError("Access check failed.", error); }
    finally { if (mounted.current) setWorking(false); }
  }, [inspect, requestError]);

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
        manuallyReleased.current = false;
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
      requestError("Resume edit failed.", error);
    } finally { setWorking(false); }
  }, [record, request, router, requestError]);

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
      manuallyReleased.current = !idle;
      setIdleYielded(idle);
      setMessage(null);
    } catch (error) { requestError("Release failed.", error); }
    finally { releasing.current = false; setWorking(false); }
  }, [record, request, requestError]);

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
      } catch (error) { if (!stopped) requestError("Access check failed.", error); }
    };
    // Deferring startup lets development-mode effect replay cancel the first
    // setup before it sends a lease request.
    const startTimer = window.setTimeout(() => void start(), 0);
    let polling = false;
    let retryTimer: number | null = null;
    let lastPollStarted = -Infinity;
    const poll = async () => {
      if (stopped || polling || releasing.current) return;
      const wait = backendUnavailable.current ? RETRY_MS - (performance.now() - lastPollStarted) : 0;
      if (wait > 0) {
        if (retryTimer === null) retryTimer = window.setTimeout(() => { retryTimer = null; void poll(); }, wait);
        return;
      }
      if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
      polling = true;
      lastPollStarted = performance.now();
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
          if (!stopped && credential.current === current) {
            setStatus(next);
            setAccessError(null);
            if (!manuallyReleased.current && next.state === "available" && document.visibilityState === "visible" && Date.now() - lastActivity.current < PROJECT_WRITE_SESSION_IDLE_MS) {
              await claim(undefined, false);
            }
          }
        }
      } catch (error) {
        if (!stopped && credential.current === current) {
          const remaining = current ? leaseDeadline.current - performance.now() : 0;
          if (remaining <= 0) setWritable(false);
          requestError("Access check failed.", error);
          if (remaining > 0 || backendUnavailable.current) retryTimer = window.setTimeout(() => { retryTimer = null; void poll(); }, remaining > 0 ? Math.min(RETRY_MS, remaining) : RETRY_MS);
        }
      } finally { polling = false; }
    };
    const wake = () => { void poll(); };
    wakePolling.current = wake;
    const timer = window.setInterval(wake, PROJECT_WRITE_SESSION_HEARTBEAT_MS);
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
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(startTimer);
      clearInterval(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (wakePolling.current === wake) wakePolling.current = null;
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", visibility);
      for (const event of activityEvents) window.removeEventListener(event, activity, true);
      if (credential.current && pendingKeys.current.size === 0 && pendingRequests.current === 0) {
        navigationContinuations.set(storageKey, credential.current);
      }
    };
  }, [check, claim, endpoint, publicDemo, readStatus, record, release, request, requestError, storageKey]);

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
      requestError("Resume edit failed.", error);
      throw error;
    } finally { setWorking(false); }
  }, [record, request, requestError, working]);

  const restore = useCallback(() => {
    if (working || !status) return;
    if (heldWriterLease.current) {
      if (pendingKeys.current.size && !window.confirm("Refreshing will replace the open draft with the saved project. Copy or download your draft first. Refresh now?")) return;
    }
    void resumeEdit(status.ownerGeneration, true).catch(() => {});
  }, [resumeEdit, status, working]);
  const accessMessage = connectionState === "reconnecting" ? "Reconnecting to OpenBar. Your draft stays in this tab." : accessError || message || (working || !status ? "Checking access…" : idleYielded ? "Session idle. Editing paused." : status.state === "occupied" ? "Another session is editing." : pendingWork && heldWriterLease.current ? "Save your draft first." : "View only");
  const getDiagnostics = useCallback(() => ({
    endpoint, ...projectWriteSessionDiagnosticAccess({ status, credential: credential.current, writable, publicDemo, reason: accessMessage }), writable: publicDemo || writable,
    accessError, checking: working, idleYielded,
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
    connection: { state: backendUnavailable.current ? "reconnecting" : "connected", error: connectionError, lastSuccessfulConnection }, hostResources,
    hostResourcesAgeMs: hostResources ? Math.max(0, Date.now() - hostResources.sampledAt) : null,
    inboxRevision,
  }), [endpoint, status, publicDemo, writable, accessMessage, accessError, working, idleYielded, connectionError, lastSuccessfulConnection, hostResources, inboxRevision]);
  const context = useMemo(() => ({ writable: publicDemo ? true : writable, setPendingWork, release, canRelease: writable && !working && !pendingWork && pendingRequestCount === 0, restore, canRestore: !publicDemo && !working && !writable && Boolean(status) && pendingRequestCount === 0, check, checking: working, accessMessage, accessError, inspect, resumeEdit, pendingLocalWork: pendingWork, getDiagnostics, connectionState, connectionError, lastSuccessfulConnection, isBackendUnavailable, hostResources, inboxRevision }), [publicDemo, writable, setPendingWork, release, working, pendingWork, pendingRequestCount, restore, status, check, accessMessage, accessError, inspect, resumeEdit, getDiagnostics, connectionState, connectionError, lastSuccessfulConnection, isBackendUnavailable, hostResources, inboxRevision]);
  return <WriteSessionContext.Provider value={context}>
    {children}
  </WriteSessionContext.Provider>;
}
