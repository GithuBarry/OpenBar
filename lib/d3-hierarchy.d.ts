declare module "proper-lockfile" {
  type LockOptions = {
    stale?: number;
    update?: number;
    realpath?: boolean;
    retries?: number | { retries: number; minTimeout?: number; maxTimeout?: number };
    lockfilePath?: string;
    onCompromised?: (error: Error) => void;
  };

  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
  export function lockSync(
    file: string,
    options?: LockOptions,
  ): () => void;
}

declare module "@citation-js/core" {
  export class Cite {
    constructor(data?: unknown, options?: Record<string, unknown>);
    data: unknown[];
    format(type: string, options?: Record<string, unknown>): string;
  }
}

declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-csl";
