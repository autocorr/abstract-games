// The Setup section of a game page: who plays each colour, AI think time, the
// game's own options and colour schemes. Changes apply at once; the shell
// decides what each one does through the callbacks.
//
// Short lists of choices are shown as segmented buttons, so every value is
// in view; longer ones use a <select>. Both are wrapped as a control:
// { node, set(value), disable(isDisabled) }.

import { h } from "./dom.js";
import { choiceValue } from "../engine.js";

export const AI_TIMES = ["0.025", "0.05", "0.1", "0.25", "0.5", "1", "2", "5", "10", "30"];

const choiceKey = (c) => String(choiceValue(c));
const choiceLabel = (c) => (typeof c === "object" ? c.label : String(c));

// Segmented buttons fit when there are few choices with short labels.
function fitsSegmented(choices) {
  const labels = choices.map(choiceLabel);
  return labels.length <= 5 && labels.every((l) => l.length <= 10) && labels.join("").length <= 22;
}

// A row of toggle buttons, one per choice; the chosen one is pressed.
export function segmented(label, choices, value, onChange) {
  let current = String(value);
  const buttons = choices.map((c) => {
    const v = choiceKey(c);
    return h("button", {
      type: "button", class: "seg", "data-value": v,
      onclick: () => {
        if (v === current) return;
        set(v);
        onChange(v);
      },
    }, choiceLabel(c));
  });
  const node = h("div", { class: "segmented", role: "group", "aria-label": label }, buttons);
  function set(v) {
    current = String(v);
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === current));
  }
  set(current);
  return {
    node,
    set,
    disable(isDisabled) { for (const b of buttons) b.disabled = isDisabled(b.dataset.value); },
  };
}

// A <select> with the same interface.
export function dropdown(label, choices, value, onChange) {
  const node = h("select", { class: "btn", "aria-label": label, onchange: (e) => onChange(e.target.value) });
  for (const c of choices) node.append(h("option", { value: choiceKey(c) }, choiceLabel(c)));
  node.value = String(value);
  return {
    node,
    set(v) { node.value = String(v); },
    disable(isDisabled) {
      for (const o of node.options) o.disabled = isDisabled(o.value);
      node.disabled = [...node.options].every((o) => o.disabled);   // e.g. an inactive option
    },
  };
}

// A labelled control row. Choices are plain values or { value, label }.
// Returns { node, control }.
export function choiceRow(label, choices, value, onChange) {
  const control = (fitsSegmented(choices) ? segmented : dropdown)(label, choices, value, onChange);
  const node = h("div", { class: "option-row" }, h("span", { class: "label" }, label), control.node);
  return { node, control };
}

// Returns { node, optionControls, setPlayerNames } where optionControls maps
// each game option key to its control, so the shell can keep them in step
// with the position, and setPlayerNames(players) relabels the player rows.
export function buildSetup(game, settings, { onPlayer, onAiTime, onOption, onScheme, onPieceStyle, onLabels, onDecor, extraRows = [] }) {
  const node = h("div", { class: "setup" });
  const optionControls = {};
  // A colour scheme may name the players (scheme.players).
  const scheme = game.colorSchemes && game.colorSchemes[settings.scheme];
  const players = (scheme && scheme.players) || game.players;
  const playerLabels = {};
  for (const p of Object.keys(game.players).map(Number)) {
    const row = choiceRow(players[p].name,
      [{ value: "human", label: "Human" }, { value: "ai", label: "AI" }],
      settings.players[p], (v) => onPlayer(p, v));
    playerLabels[p] = row.node.querySelector(".label");
    node.append(row.node);
  }
  node.append(choiceRow("AI think time", AI_TIMES.map((t) => ({ value: t, label: `${t}s` })),
    settings.aiTime, onAiTime).node);
  for (const [key, spec] of Object.entries(game.options || {})) {
    const row = choiceRow(spec.label, spec.choices, settings.options[key], (v) => onOption(key, v));
    optionControls[key] = row.control;
    node.append(row.node);
  }
  if (game.colorSchemes) {
    const choices = Object.entries(game.colorSchemes).map(([value, s]) => ({ value, label: s.name }));
    node.append(choiceRow("Colors", choices, settings.scheme, onScheme).node);
  }
  if (game.pieceStyles) {
    const choices = Object.entries(game.pieceStyles).map(([value, s]) => ({ value, label: s.name }));
    node.append(choiceRow("Pieces", choices, settings.pieceStyle, onPieceStyle).node);
  }
  // Labels on the pieces (game.pieceLabels names them) can be hidden.
  if (game.pieceLabels) {
    node.append(choiceRow(game.pieceLabels, [{ value: "on", label: "Show" }, { value: "off", label: "Hide" }],
      settings.labels, onLabels).node);
  }
  // Board decor marked optional (game.optionalDecor names it) can be shown.
  if (game.optionalDecor) {
    node.append(choiceRow(game.optionalDecor, [{ value: "on", label: "Show" }, { value: "off", label: "Hide" }],
      settings.decor, onDecor).node);
  }
  node.append(...extraRows);
  // Rename the player rows (e.g. when the colour scheme changes).
  const setPlayerNames = (named) => {
    for (const [p, label] of Object.entries(playerLabels)) {
      label.textContent = named[p].name;
      const control = label.nextElementSibling;
      if (control) control.setAttribute("aria-label", named[p].name);
    }
  };
  return { node, optionControls, setPlayerNames };
}
