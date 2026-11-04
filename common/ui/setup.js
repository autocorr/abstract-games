// The Setup section of a game page: who plays each seat, AI think time, the
// game's own options and colour schemes. Changes apply at once; the shell
// decides what each one does through the callbacks.

import { h } from "./dom.js";

export const AI_TIMES = ["0.025", "0.05", "0.1", "0.25", "0.5", "1", "2", "5", "10", "30"];

// A labelled <select>. Choices are plain values or { value, label }.
export function optionRow(label, choices, value, onChange) {
  const select = h("select", { class: "btn", onchange: (e) => onChange(e.target.value) });
  for (const c of choices) {
    const v = typeof c === "object" ? c.value : c;
    const opt = h("option", { value: String(v) }, typeof c === "object" ? c.label : String(c));
    if (String(v) === String(value)) opt.selected = true;
    select.append(opt);
  }
  return h("label", { class: "option-row" }, h("span", { class: "label" }, label), select);
}

// Returns { node, optionSelects } where optionSelects maps each game option
// key to its <select>, so the shell can keep them in step with the position.
export function buildSetup(game, settings, { onPlayer, onAiTime, onOption, onScheme, extraRows = [] }) {
  const node = h("div", { class: "setup" });
  const optionSelects = {};
  for (const p of Object.keys(game.players).map(Number)) {
    // With the swap rule a setting follows the seat, whatever colour it ends up playing.
    node.append(optionRow(game.swap ? `${game.players[p].name} at start` : game.players[p].name,
      [{ value: "human", label: "Human" }, { value: "ai", label: "AI" }],
      settings.players[p], (v) => onPlayer(p, v)));
  }
  node.append(optionRow("AI think", AI_TIMES.map((t) => ({ value: t, label: `${t}s` })), settings.aiTime, onAiTime));
  for (const [key, spec] of Object.entries(game.options || {})) {
    const row = optionRow(spec.label, spec.choices, settings.options[key], (v) => onOption(key, v));
    optionSelects[key] = row.querySelector("select");
    node.append(row);
  }
  if (game.colorSchemes) {
    const choices = Object.entries(game.colorSchemes).map(([value, s]) => ({ value, label: s.name }));
    node.append(optionRow("Colors", choices, settings.scheme, onScheme));
  }
  node.append(...extraRows);
  return { node, optionSelects };
}
