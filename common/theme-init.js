// Apply a saved Theme setting before the page is first drawn. Loaded as a
// classic (blocking) script in each page's <head>; see theme.js.
try {
  const theme = localStorage.getItem("abstract-games:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // Storage disabled: follow the system.
}
