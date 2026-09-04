declare module "d3-hierarchy" {
  export interface HierarchyNode<Datum> {
    data: Datum;
    depth: number;
    height: number;
    parent: HierarchyNode<Datum> | null;
    children?: HierarchyNode<Datum>[];
    x: number;
    y: number;
    each(callback: (node: HierarchyNode<Datum>) => void): this;
  }

  export interface HierarchyLayout<Datum> {
    nodeSize(size: [number, number]): this;
    (root: HierarchyNode<Datum>): HierarchyNode<Datum>;
  }

  export function hierarchy<Datum>(
    data: Datum,
    children?: (d: Datum) => Iterable<Datum> | null | undefined,
  ): HierarchyNode<Datum>;

  export function tree<Datum>(): HierarchyLayout<Datum>;
}

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
