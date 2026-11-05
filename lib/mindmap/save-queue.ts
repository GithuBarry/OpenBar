/** Orders local map writes and lets navigation wait for every queued write. */
export function createMindmapSaveQueue() {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  return {
    get pending() { return pending; },
    enqueue<T>(write: () => Promise<T>): Promise<T> {
      pending += 1;
      const job = tail.then(write);
      tail = job.then(() => undefined, () => undefined).finally(() => { pending -= 1; });
      return job;
    },
    async idle(): Promise<void> {
      while (pending) await tail;
    },
  };
}
