"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "paper";

const ThemeCtx = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  cycle: () => void;
}>({ theme: "light", setTheme: () => {}, cycle: () => {} });

const ORDER: Theme[] = ["paper", "light", "dark"];

/** Inline script that sets the theme before paint to avoid a flash. */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('ob-theme');if(!t){t='paper';}document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-p-theme',t==='dark'?'darkmode':'lightmode');}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("paper");

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as Theme) || "paper";
    setThemeState(t);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("data-p-theme", t === "dark" ? "darkmode" : "lightmode");
    try {
      localStorage.setItem("ob-theme", t);
    } catch {}
  };

  const cycle = () => setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, cycle }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
