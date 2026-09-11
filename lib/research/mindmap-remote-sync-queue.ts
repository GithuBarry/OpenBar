/**
 * Project-scoped remote synchronization for the mindmap editor.
 *
 * Local map saves can finish while a Git push is stalled. This queue keeps one
 * remote operation active, replaces only work that has not started yet, and
 * suppresses completion events for checkpoints that have since been replaced.
 * The registry intentionally lives at module scope so a map navigation does
 * not discard a pending push.
 */

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

  subscribe(listener: QueueListener<T>): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  enqueue(checkpoint: string, run: () => Promise<T>): Promise<T> {
    const entry: QueueEntry<T> = {
      sequence: ++this.sequence,
      checkpoint,
      run,
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
    if (this.active || !this.pending) return;
    const entry = this.pending;
    this.pending = null;
    this.active = entry;
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
    for (const waiter of entry.waiters) waiter.resolve(result);
    if (this.active !== entry) return;
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
    for (const waiter of entry.waiters) waiter.reject(error);
    if (this.active !== entry) return;
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
