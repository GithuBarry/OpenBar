"use client";

import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";

export const BranchPreviewContext = createContext<Dispatch<SetStateAction<string | null>> | null>(null);

/** Each tree branch is uniquely identified by its child card. */
export function useBranchPreview(childId: string | null) {
  const setPreview = useContext(BranchPreviewContext);
  useEffect(() => {
    if (!childId || !setPreview) return;
    setPreview(childId);
    return () => setPreview(current => current === childId ? null : current);
  }, [childId, setPreview]);
}
