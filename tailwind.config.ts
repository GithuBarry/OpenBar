import type { Config } from "tailwindcss";

const withVar = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        canvas: withVar("--canvas"),
        surface: {
          DEFAULT: withVar("--surface"),
          2: withVar("--surface-2"),
          3: withVar("--surface-3"),
        },
        line: withVar("--line"),
        ink: withVar("--ink"),
        muted: withVar("--muted"),
        faint: withVar("--faint"),
        accent: {
          DEFAULT: withVar("--accent"),
          ink: withVar("--accent-ink"),
          soft: "rgb(var(--accent) / 0.12)",
        },
        danger: withVar("--danger"),
        warn: withVar("--warn"),
        ok: withVar("--ok"),
        m: {
          empty: withVar("--m-empty"),
          hypo: withVar("--m-hypo"),
          draft: withVar("--m-draft"),
          review: withVar("--m-review"),
          final: withVar("--m-final"),
        },
      },
      maxWidth: {
        prose: "72ch",
      },
      boxShadow: {
        xs: "0 1px 2px rgb(0 0 0 / 0.06), 0 0 0 1px rgb(var(--line) / 0.5)",
        card: "0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.04)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        inout: "cubic-bezier(0.77, 0, 0.175, 1)",
      },
      transitionDuration: {
        press: "140ms",
        ui: "180ms",
      },
    },
  },
  plugins: [],
};

export default config;
