"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type MindmapTitleEditor = {
  id: string;
  title: string;
  readOnly: boolean;
  rename: (title: string) => Promise<void>;
};

const MindmapTitleContext = createContext<{
  editor: MindmapTitleEditor | null;
  setEditor: Dispatch<SetStateAction<MindmapTitleEditor | null>>;
} | null>(null);

export function MindmapTitleProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<MindmapTitleEditor | null>(null);
  return <MindmapTitleContext.Provider value={{ editor, setEditor }}>{children}</MindmapTitleContext.Provider>;
}

export function useMindmapTitle() {
  return useContext(MindmapTitleContext);
}
