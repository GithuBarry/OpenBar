"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const PaperReadingContext = createContext<{ reading: boolean; setReading: (reading: boolean) => void }>({ reading: false, setReading: () => {} });

export function PaperReadingShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  const [reading, setReading] = useState(true);
  return (
    <PaperReadingContext.Provider value={{ reading, setReading }}>
      <div className="flex h-full min-h-0 flex-col">
        <div id="paper-project-header" data-paper-header hidden={reading}>{header}</div>
        <main className="min-h-0 w-full flex-1 overflow-hidden p-2 sm:p-3">{children}</main>
      </div>
    </PaperReadingContext.Provider>
  );
}

export function usePaperReadingMode() {
  return useContext(PaperReadingContext);
}
