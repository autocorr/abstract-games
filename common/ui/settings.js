// What a game page remembers: the Setup settings, saved per game in
// localStorage, and the position on show, kept in the URL hash so it can be
// reloaded or shared.

import { AI_TIMES } from "./setup.js";
import { resolveOptions, moveKey, parseMoveKey } from "../engine.js";

const DEFAULT_AI_TIME = "1";

const storageKey = (game) => `abstract-games:${game.id}`;

// The saved settings for `game`, with anything missing or no longer valid
// replaced by its default: { players: { [seat]: "human" | "ai" }, aiTime,
// options, scheme }.
export function loadSettings(game) {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(storageKey(game))) || {};
  } catch {
    // Storage disabled or unreadable: start from the defaults.
  }
  return {
    players: { ...(game.defaultPlayers || { 1: "human", 2: "ai" }), ...(stored.players || {}) },
    aiTime: AI_TIMES.includes(stored.aiTime) ? stored.aiTime : DEFAULT_AI_TIME,
    options: resolveOptions(game, stored.options),
    scheme: game.colorSchemes && stored.scheme in game.colorSchemes
      ? stored.scheme
      : Object.keys(game.colorSchemes || {})[0],
  };
}

export function saveSettings(game, settings) {
  try {
    localStorage.setItem(storageKey(game), JSON.stringify(settings));
  } catch {
    // Private browsing or storage disabled: settings just won't persist.
  }
}

// URL hash: "#size=48&moves=17.23-31.pass&at=2". Option keys come from
// game.options. Returns { options, moves, at }, or null without a move list.
export function readHash(game) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("moves")) return null;
  const options = {};
  for (const key of Object.keys(game.options || {})) if (params.has(key)) options[key] = params.get(key);
  const raw = params.get("moves");
  const moves = raw ? raw.split(".").map(parseMoveKey) : [];
  const at = params.has("at") ? Number(params.get("at")) : moves.length;
  return { options, moves, at };
}

// The full line goes in the hash; `at` marks the position on show while
// reviewing, so a reload or a shared link opens there with the line intact.
export function writeHash(options, { moves, cursor }) {
  if (!moves.length) {
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options)) params.set(k, v);
  params.set("moves", moves.map(moveKey).join("."));
  if (cursor < moves.length) params.set("at", cursor);
  history.replaceState(null, "", "#" + params.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":"));
}
