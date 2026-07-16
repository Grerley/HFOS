import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens → CSS variables (themeable light/dark).
        surface: "var(--bg)",
        card: "var(--card)",
        muted: "var(--muted)",
        elevated: "var(--elevated)",
        line: { DEFAULT: "var(--border)", soft: "var(--border-soft)" },
        ink: {
          DEFAULT: "var(--text)",
          soft: "var(--text-soft)",
          muted: "var(--text-muted)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          dark: "var(--brand-dark)",
          light: "var(--brand-light)",
          fg: "var(--brand-fg)",
        },
        positive: "var(--positive)",
        negative: "var(--negative)",
        warning: "var(--warning)",
        info: "var(--info)",
        ai: "var(--ai)",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(15,30,52,0.06), 0 1px 3px rgba(15,30,52,0.04)",
        card: "0 4px 16px rgba(15,30,52,0.06)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
