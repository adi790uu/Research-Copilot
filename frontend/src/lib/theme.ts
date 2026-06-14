import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";

  // URL param wins (lets us deep-link a theme, useful for previews and screenshots).
  try {
    const param = new URL(window.location.href).searchParams.get("theme");
    if (param === "light" || param === "dark") return param;
  } catch {
    // ignore
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }

  // Mirror the inline bootstrap script's default.
  const html = document.documentElement.getAttribute("data-theme");
  if (html === "light" || html === "dark") return html;

  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  const set = (t: Theme) => setThemeState(t);

  return { theme, toggle, set };
}
