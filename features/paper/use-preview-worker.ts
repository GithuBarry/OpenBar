"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BibEntry } from "@/lib/bibtex";
import type { PaperPreviewResult, PreviewBatch, PreviewChange, PreviewWorkerIn, PreviewWorkerOut } from "./preview.worker";

const PREVIEW_DEBOUNCE_MS = 150;
const PREVIEW_MAX_WAIT_MS = 500;
const WORKER_RESPONSE_TIMEOUT_MS = 30_000;
const MAX_PENDING_BYTES = 256 * 1024;
const MAX_PENDING_BATCHES = 1_000;
const PROGRESS_MESSAGES: Record<NonNullable<PreviewWorkerOut["stage"]>, string> = {
  includes: "Collecting included files…",
  parsing: "Reading LaTeX…",
  formatting: "Formatting the document…",
  math: "Rendering equations and references…",
  assembling: "Assembling the preview…",
  recovering: "Recovering the preview by section…",
  counting: "Counting words…",
};

export function usePreviewWorker(options: {
  bibliography?: BibEntry[];
  assetBaseUrl?: string;
  getLiveSource?: () => string;
}): {
  result: PaperPreviewResult | null;
  revision: number;
  workerError: string | null;
  progress: string;
  reset: (source: string) => void;
  applyChanges: (changes: PreviewChange[], length: number) => void;
  dispose: () => void;
} {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PreviewWorkerIn | null>(null);
  const pendingBytesRef = useRef(0);
  const busyRef = useRef(false);
  const revisionRef = useRef(0);
  const renderedRevisionRef = useRef(0);
  const generationRef = useRef(0);
  const disposedRef = useRef(false);
  const recoveryAttemptsRef = useRef(0);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createWorkerRef = useRef<(() => void) | null>(null);
  const recoverWorkerRef = useRef<((message: string) => void) | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bibliographyRef = useRef(options.bibliography);
  const assetBaseUrlRef = useRef(options.assetBaseUrl);
  const getLiveSourceRef = useRef(options.getLiveSource);
  const hasResultRef = useRef(false);
  const [result, setResult] = useState<PaperPreviewResult | null>(null);
  const [revision, setRevision] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [progress, setProgress] = useState("Starting document preview…");
  bibliographyRef.current = options.bibliography;
  assetBaseUrlRef.current = options.assetBaseUrl;
  getLiveSourceRef.current = options.getLiveSource;

  const clearDispatchTimers = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    debounceTimerRef.current = null;
    maxWaitTimerRef.current = null;
  }, []);

  const clearResponseTimer = useCallback(() => {
    if (responseTimerRef.current) clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
  }, []);

  const queue = useCallback((message: PreviewWorkerIn) => {
    const pending = pendingRef.current;
    if (!pending || message.type === "reset") {
      pendingRef.current = message;
      pendingBytesRef.current = message.type === "changes"
        ? message.batches.reduce((total, batch) => total + JSON.stringify(batch).length, 0)
        : 0;
      return;
    }
    if (pending.type === "reset") {
      const live = getLiveSourceRef.current?.();
      if (live != null) pending.source = live;
      if (message.type === "changes") {
        // A caller can omit getLiveSource. Fold the queued transactions into
        // the reset snapshot so its revision still describes its contents.
        if (live == null) {
          for (const batch of message.batches) {
            for (const change of [...batch.changes].sort((a, b) => b.from - a.from)) {
              pending.source = `${pending.source.slice(0, change.from)}${change.insert}${pending.source.slice(change.to)}`;
            }
          }
        }
        pending.revision = message.batches.at(-1)?.revision || pending.revision;
      }
      return;
    }
    if (message.type !== "changes") return;
    const incomingBytes = message.batches.reduce((total, batch) => total + JSON.stringify(batch).length, 0);
    const bytes = pendingBytesRef.current + incomingBytes;
    if (bytes > MAX_PENDING_BYTES || pending.batches.length + message.batches.length > MAX_PENDING_BATCHES) {
      const live = getLiveSourceRef.current?.();
      if (live != null) {
        pendingRef.current = {
          type: "reset",
          generation: message.generation,
          revision: message.batches.at(-1)?.revision || pending.batches.at(-1)?.revision || revisionRef.current,
          source: live,
          bibliography: bibliographyRef.current,
          assetBaseUrl: assetBaseUrlRef.current,
        };
        pendingBytesRef.current = 0;
        return;
      }
    }
    pending.batches.push(...message.batches);
    pendingBytesRef.current = bytes;
  }, []);

  const sendNow = useCallback((message: PreviewWorkerIn) => {
    const worker = workerRef.current;
    if (!worker || busyRef.current) {
      queue(message);
      if (!worker && !disposedRef.current) createWorkerRef.current?.();
      return;
    }
    busyRef.current = true;
    clearResponseTimer();
    responseTimerRef.current = setTimeout(() => {
      if (workerRef.current === worker) recoverWorkerRef.current?.("Preview worker timed out; rebuilding the current document.");
    }, WORKER_RESPONSE_TIMEOUT_MS);
    try {
      worker.postMessage(message);
    } catch (error) {
      queue(message);
      recoverWorkerRef.current?.(error instanceof Error ? error.message : "Preview worker could not receive the update.");
    }
  }, [clearResponseTimer, queue]);

  const flushPending = useCallback(() => {
    clearDispatchTimers();
    const pending = pendingRef.current;
    if (!pending || busyRef.current || !workerRef.current) return;
    pendingRef.current = null;
    pendingBytesRef.current = 0;
    sendNow(pending);
  }, [clearDispatchTimers, sendNow]);

  const scheduleFlush = useCallback(() => {
    if (!debounceTimerRef.current) maxWaitTimerRef.current = setTimeout(flushPending, PREVIEW_MAX_WAIT_MS);
    else clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(flushPending, PREVIEW_DEBOUNCE_MS);
  }, [flushPending]);

  useEffect(() => {
    disposedRef.current = false;

    const resetFromLive = () => {
      const live = getLiveSourceRef.current?.();
      if (live == null) return;
      generationRef.current += 1;
      pendingRef.current = {
        type: "reset",
        generation: generationRef.current,
        revision: revisionRef.current,
        source: live,
        bibliography: bibliographyRef.current,
        assetBaseUrl: assetBaseUrlRef.current,
      };
      pendingBytesRef.current = 0;
    };

    const recoverWorker = (message: string) => {
      if (disposedRef.current) return;
      clearResponseTimer();
      busyRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      setWorkerError(message);
      resetFromLive();
      if (recoveryAttemptsRef.current >= 1) {
        setWorkerError(`${message} Retry by changing the document or reopening the paper.`);
        return;
      }
      recoveryAttemptsRef.current += 1;
      createWorkerRef.current?.();
      flushPending();
    };
    recoverWorkerRef.current = recoverWorker;

    const createWorker = () => {
      if (disposedRef.current || workerRef.current) return;
      const worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<PreviewWorkerOut>) => {
        if (workerRef.current !== worker) return;
        const payload = event.data;
        if (payload.type === "progress") {
          if (!hasResultRef.current && payload.generation === generationRef.current && payload.stage) {
            setProgress(PROGRESS_MESSAGES[payload.stage]);
          }
          return;
        }
        clearResponseTimer();
        busyRef.current = false;
        if (payload.generation !== generationRef.current) {
          flushPending();
          return;
        }
        if (payload.type === "desync") {
          const live = getLiveSourceRef.current?.();
          setWorkerError("Preview worker lost synchronization; rebuilding the current document.");
          if (live != null) {
            generationRef.current += 1;
            pendingRef.current = {
              type: "reset",
              generation: generationRef.current,
              revision: revisionRef.current,
              source: live,
              bibliography: bibliographyRef.current,
              assetBaseUrl: assetBaseUrlRef.current,
            };
            pendingBytesRef.current = 0;
          }
          flushPending();
          return;
        }
        if (payload.revision < renderedRevisionRef.current) {
          flushPending();
          return;
        }
        if (payload.result) {
          hasResultRef.current = true;
          renderedRevisionRef.current = payload.revision;
          setRevision(payload.revision);
          setResult(payload.result);
          setWorkerError(null);
          recoveryAttemptsRef.current = 0;
        }
        flushPending();
      };
      worker.onerror = () => {
        if (workerRef.current === worker) recoverWorker("Preview worker failed; rebuilding the current document.");
      };
      flushPending();
    };
    createWorkerRef.current = createWorker;
    createWorker();

    return () => {
      disposedRef.current = true;
      clearDispatchTimers();
      clearResponseTimer();
      recoverWorkerRef.current = null;
      createWorkerRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      busyRef.current = false;
      pendingRef.current = null;
      pendingBytesRef.current = 0;
    };
  }, [clearDispatchTimers, clearResponseTimer, flushPending]);

  const reset = useCallback((source: string) => {
    clearDispatchTimers();
    generationRef.current += 1;
    revisionRef.current += 1;
    pendingRef.current = {
      type: "reset",
      generation: generationRef.current,
      revision: revisionRef.current,
      source,
      bibliography: bibliographyRef.current,
      assetBaseUrl: assetBaseUrlRef.current,
    };
    pendingBytesRef.current = 0;
    if (!workerRef.current && !disposedRef.current) createWorkerRef.current?.();
    flushPending();
  }, [clearDispatchTimers, flushPending]);

  const applyChanges = useCallback((changes: PreviewChange[], length: number) => {
    if (!changes.length) return;
    const baseRevision = revisionRef.current;
    const nextRevision = baseRevision + 1;
    revisionRef.current = nextRevision;
    const batch: PreviewBatch = { baseRevision, revision: nextRevision, changes, length };
    queue({ type: "changes", generation: generationRef.current, batches: [batch] });
    if (!workerRef.current && !disposedRef.current) createWorkerRef.current?.();
    scheduleFlush();
  }, [queue, scheduleFlush]);

  const dispose = useCallback(() => {
    clearDispatchTimers();
    clearResponseTimer();
    generationRef.current += 1;
    pendingRef.current = null;
    pendingBytesRef.current = 0;
    workerRef.current?.terminate();
    workerRef.current = null;
    busyRef.current = false;
    disposedRef.current = true;
  }, [clearDispatchTimers, clearResponseTimer]);

  return { result, revision, workerError, progress, reset, applyChanges, dispose };
}
