// Small DOM helpers shared by the page modules and the renderer.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// An SVG element with attributes set as given (no event handlers).
export function svgEl(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- collapsible sections ------------------------------------------------
// Which sections are open is saved for the whole site, not per game, so a
// player who closes Rules once keeps it closed everywhere.

const SECTIONS_KEY = "abstract-games:sections";

function loadOpen() {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveOpen(key, open) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...loadOpen(), [key]: open }));
  } catch {
    // Storage disabled: sections just won't remember their state.
  }
}

// A <details> card. `open` is the default when nothing is saved for `key`.
export function section(key, title, content, { open = false } = {}) {
  const saved = loadOpen()[key];
  const node = h("details", { class: `card section section-${key}`, open: saved ?? open },
    h("summary", {}, h("h2", {}, title)),
    h("div", { class: "section-body" }, content));
  node.addEventListener("toggle", () => saveOpen(key, node.open));
  return node;
}
