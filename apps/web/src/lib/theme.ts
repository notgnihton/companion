import { ThemePreference } from "../types";

const THEME_COLORS: Record<"light" | "dark", string> = {
  light: "#f5f7fb",
  dark: "#0f1f2f"
};

function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return prefersDark() ? "dark" : "light";
  }
  return preference;
}

export function applyTheme(preference: ThemePreference): "light" | "dark" {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", THEME_COLORS[resolved]);
  }

  return resolved;
}
