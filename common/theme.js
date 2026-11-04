// Site-wide light/dark theme. "auto" follows the system preference
// (prefers-color-scheme in base.css); "light" and "dark" override it via
// data-theme on <html>. theme-init.js applies the saved choice before first
// paint.

export const THEME_KEY = "abstract-games:theme";
export const THEMES = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    if (theme === "light" || theme === "dark") localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Storage disabled: the choice lasts for this page only.
  }
}
