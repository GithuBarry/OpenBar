/**
 * Project-scoped remote synchronization for the mindmap editor.
 *
 * Local map saves can finish while a Git push is stalled. This queue keeps one
 * remote operation active, replaces only work that has not started yet, and
 * suppresses completion events for checkpoints that have since been replaced.
 * The registry intentionally lives at module scope so a map navigation does
 * not discard a pending push.
 */

export const GIT_EDIT_QUIET_MS = 5_000;

export type MindmapRemoteQueuePhase = "pending" | "syncing" | "synced" | "failed";

export type MindmapRemoteQueueEvent<T> = {
  phase: MindmapRemoteQueuePhase;
  sequence: number;
  checkpoint: string;
  result?: T;
  error?: unknown;
};

type QueueEntry<T> = {
  sequence: number;
  checkpoint: string;
  run: () => Promise<T>;
  deferred: boolean;
  ready?: () => boolean;
  startedAtGeneration: number;
  waiters: Array<{
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  }>;
};

type QueueListener<T> = (event: MindmapRemoteQueueEvent<T>) => void;

/**
 * A single-flight queue whose pending tail is always the latest checkpoint.
 * `isSuccess` lets callers keep action-level failures in the normal result
 * channel while still exposing a failed queue state.
 */
export class CoalescedRemoteSyncQueue<T> {
  private sequence = 0;
  private active: QueueEntry<T> | null = null;
  private pending: QueueEntry<T> | null = null;
  private listeners = new Set<QueueListener<T>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEdit = 0;
  private editGeneration = 0;
  private paused = false;
  private snapshot: MindmapRemoteQueueEvent<T> = {
    phase: "synced",
    sequence: 0,
    checkpoint: "",
  };

  constructor(private readonly isSuccess: (result: T) => boolean) {}

  getSnapshot(): MindmapRemoteQueueEvent<T> {
    return this.snapshot;
  }

  get isBusy(): boolean {
    return this.active !== null || this.pending !== null;
  }

  get isRunning(): boolean { return this.active !== null; }

  get activityGeneration(): number { return this.editGeneration; }

  get editingRecently(): boolean { return Date.now() - this.lastEdit < GIT_EDIT_QUIET_MS; }

  noteEdit(): void {
    this.lastEdit = Date.now();
    this.editGeneration += 1;
    if (this.pending?.deferred) this.startNext();
  }

  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  resume(): void {
    this.paused = false;
    this.startNext();
  }

  subscribe(listener: QueueListener<T>): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  enqueue(checkpoint: string, run: () => Promise<T>, deferred = false, ready?: () => boolean): Promise<T> {
    const entry: QueueEntry<T> = {
      sequence: ++this.sequence,
      checkpoint,
      run,
      deferred,
      ready,
      startedAtGeneration: this.editGeneration,
      waiters: [],
    };
    const promise = new Promise<T>((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
    });

    // A pending entry has not started and can be safely replaced. Carry its
    // waiters forward so an earlier caller still observes the latest attempt.
    if (this.pending) entry.waiters.unshift(...this.pending.waiters);
    this.pending = entry;
    this.emit({
      phase: "pending",
      sequence: entry.sequence,
      checkpoint: entry.checkpoint,
    });
    this.startNext();
    return promise;
  }

  private emit(event: MindmapRemoteQueueEvent<T>): void {
    if (
      this.snapshot.phase === event.phase
      && this.snapshot.sequence === event.sequence
      && this.snapshot.checkpoint === event.checkpoint
      && this.snapshot.result === event.result
      && this.snapshot.error === event.error
    ) return;
    this.snapshot = event;
    for (const listener of this.listeners) listener(event);
  }

  private startNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.paused || this.active || !this.pending) return;
    if (this.pending.deferred) {
      const remaining = Math.max(0, this.lastEdit + GIT_EDIT_QUIET_MS - Date.now());
      if (remaining > 0) {
        this.timer = setTimeout(() => this.startNext(), remaining);
        return;
      }
      if (this.pending.ready && !this.pending.ready()) {
        this.timer = setTimeout(() => this.startNext(), 500);
        return;
      }
    }
    const entry = this.pending;
    this.pending = null;
    this.active = entry;
    entry.startedAtGeneration = this.editGeneration;
    this.emit({
      phase: "syncing",
      sequence: entry.sequence,
      checkpoint: entry.checkpoint,
    });
    void entry.run().then(
      (result) => this.finish(entry, result),
      (error) => this.fail(entry, error),
    );
  }

  private finish(entry: QueueEntry<T>, result: T): void {
    if (this.active !== entry) return;
    // A running automatic push may finish while a newer edit is still being
    // saved. Give that checkpoint the same quiet window to enter the queue.
    if (!this.pending && entry.deferred && entry.startedAtGeneration !== this.editGeneration && this.editingRecently) {
      setTimeout(() => this.finish(entry, result), Math.max(1, this.lastEdit + GIT_EDIT_QUIET_MS - Date.now()));
      return;
    }
    for (const waiter of entry.waiters) waiter.resolve(result);
    this.active = null;

    // The result belongs to an older checkpoint when a newer tail exists. Its
    // callback must not claim that the latest project state reached Git.
    if (this.pending) {
      this.emit({
        phase: "pending",
        sequence: this.pending.sequence,
        checkpoint: this.pending.checkpoint,
      });
      this.startNext();
      return;
    }
    this.emit({
      phase: this.isSuccess(result) ? "synced" : "failed",
      sequence: entry.sequence,
      checkpoint: entry.checkpoint,
      result,
    });
  }

  private fail(entry: QueueEntry<T>, error: unknown): void {
    if (this.active !== entry) return;
    if (!this.pending && entry.deferred && entry.startedAtGeneration !== this.editGeneration && this.editingRecently) {
      setTimeout(() => this.fail(entry, error), Math.max(1, this.lastEdit + GIT_EDIT_QUIET_MS - Date.now()));
      return;
    }
    for (const waiter of entry.waiters) waiter.reject(error);
    this.active = null;

    // Keep the latest checkpoint authoritative when an older operation fails
    // while a newer local save is already waiting behind it.
    if (this.pending) {
      this.emit({
        phase: "pending",
        sequence: this.pending.sequence,
        checkpoint: this.pending.checkpoint,
      });
      this.startNext();
      return;
    }
    this.emit({
      phase: "failed",
      sequence: entry.sequence,
      checkpoint: entry.checkpoint,
      error,
    });
  }
}

const projectQueues = new Map<string, CoalescedRemoteSyncQueue<unknown>>();

/** Return the stable queue for one project across map component lifecycles. */
export function getMindmapRemoteSyncQueue<T>(
  project: string,
  isSuccess: (result: T) => boolean,
): CoalescedRemoteSyncQueue<T> {
  const existing = projectQueues.get(project);
  if (existing) return existing as CoalescedRemoteSyncQueue<T>;
  const queue = new CoalescedRemoteSyncQueue<T>(isSuccess);
  projectQueues.set(project, queue as CoalescedRemoteSyncQueue<unknown>);
  return queue;
}
