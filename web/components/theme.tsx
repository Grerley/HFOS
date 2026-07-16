"use client";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";

const THEME_KEY = "hfos_theme";
const DENSITY_KEY = "hfos_density";

function resolveDark(t: Theme): boolean {
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", resolveDark(t) ? "dark" : "light");
}
export function applyDensity(d: Density) {
  document.documentElement.setAttribute("data-density", d);
}

const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

export function ThemeControls() {
  const [theme, setTheme] = useState<Theme>("system");
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    const t = (localStorage.getItem(THEME_KEY) as Theme) || "system";
    const d = (localStorage.getItem(DENSITY_KEY) as Density) || "comfortable";
    setTheme(t);
    setDensity(d);
    // React to OS theme changes while in system mode.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system"); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  function cycleTheme() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }
  function toggleDensity() {
    const next: Density = density === "comfortable" ? "compact" : "comfortable";
    setDensity(next);
    localStorage.setItem(DENSITY_KEY, next);
    applyDensity(next);
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={cycleTheme} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Click to change.`}
        className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink-soft hover:bg-muted">
        <span aria-hidden>{THEME_ICON[theme]}</span><span className="capitalize">{theme}</span>
      </button>
      <button onClick={toggleDensity} title={`Density: ${density}`} aria-label={`Density: ${density}. Click to change.`}
        className="rounded-lg border border-line px-2 py-1 text-xs text-ink-soft hover:bg-muted">
        {density === "compact" ? "≣" : "≡"}
      </button>
    </div>
  );
}

/** Inline script (runs before paint) to set theme/density with no flash of wrong theme. */
export const themeInitScript = `(function(){try{
var t=localStorage.getItem('${THEME_KEY}')||'system';
var d=localStorage.getItem('${DENSITY_KEY}')||'comfortable';
var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.setAttribute('data-theme',dark?'dark':'light');
document.documentElement.setAttribute('data-density',d);
}catch(e){}})();`;
