// Game page shell: mount(game) builds the whole page UI around a Game (see
// ARCHITECTURE.md). Games provide rules; this module provides controls,
// dialogs, rendering, move input, AI players, history, undo and the URL hash.

import { createRenderer, rotateViewBox, viewBoxAspect } from "./render.js";
import { AIPlayer } from "./ai/player.js";
import { renderChance } from "./chance-view.js";
import {
  replay, resolveOptions, optionAllowed, findLegalMove, moveKey, parseMoveKey, piecesOf, sampleChance, currentPlayer, seatOf, CHANCE,
} from "./engine.js";

// Pause before a chance ply (a marble draw) is played, so it can be seen.
const CHANCE_DELAY_MS = 450;

const AI_TIMES = ["0.025", "0.05", "0.1", "0.25", "0.5", "1", "2", "5", "10", "30"];
const DEFAULT_AI_TIME = "1";

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The declared choice value of option `key` matching a <select> string.
function parseOption(game, key, text) {
  const c = game.options[key].choices.find((x) => String(typeof x === "object" ? x.value : x) === text);
  return typeof c === "object" ? c.value : c;
}

const startsWith = (move, prefix) => prefix.every((id, i) => move[i] === id);

// ---- persistence -------------------------------------------------------

function loadSettings(game) {
  try {
    return JSON.parse(localStorage.getItem(`abstract-games:${game.id}`)) || {};
  } catch {
    return {};
  }
}

function saveSettings(game, settings) {
  try {
    localStorage.setItem(`abstract-games:${game.id}`, JSON.stringify(settings));
  } catch {
    // Private browsing or storage disabled: settings just won't persist.
  }
}

// URL hash: "#size=48&moves=17.23-31.pass". Option keys come from game.options.
function readHash(game) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("moves")) return null;
  const options = {};
  for (const key of Object.keys(game.options || {})) if (params.has(key)) options[key] = params.get(key);
  const raw = params.get("moves");
  const moves = raw ? raw.split(".").map(parseMoveKey) : [];
  return { options, moves };
}

function writeHash(options, moves) {
  if (!moves.length) {
    history.replaceState(null, "", location.pathname + location.search);
    return;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options)) params.set(k, v);
  params.set("moves", moves.map(moveKey).join("."));
  history.replaceState(null, "", "#" + params.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":"));
}

// ---- mount -------------------------------------------------------------

export function mount(game, { root = document.body } = {}) {
  const playerIds = Object.keys(game.players).map(Number);
  const stored = loadSettings(game);
  const settings = {
    players: { ...(game.defaultPlayers || { 1: "human", 2: "ai" }), ...(stored.players || {}) },
    aiTime: AI_TIMES.includes(stored.aiTime) ? stored.aiTime : DEFAULT_AI_TIME,
    options: resolveOptions(game, stored.options),
    scheme: game.colorSchemes && stored.scheme in game.colorSchemes
      ? stored.scheme
      : Object.keys(game.colorSchemes || {})[0],
  };
  const persist = () => saveSettings(game, settings);

  // Position: everything is derived from options + move list.
  let board = null;
  let boardKey = null;
  let state = null;
  let moves = [];
  let lastInfo = null;
  let selection = [];
  let thinking = false;
  let aiGeneration = 0;
  let chanceTimer = null;
  let errorText = "";
  const ai = new AIPlayer(game);

  // ---- DOM ----
  root.classList.add("game");
  const ui = {};
  const rulesTemplate = document.getElementById("rules");

  ui.undo = h("button", { class: "btn", onclick: undo }, "Undo");
  ui.controls = h("nav", { class: "controls" },
    h("a", { class: "btn", href: new URL("../../", location.href).pathname }, "Games"),
    rulesTemplate ? h("button", { class: "btn", onclick: () => ui.rulesDialog.showModal() }, "Rules") : null,
    h("button", { class: "btn", onclick: () => ui.optionsDialog.showModal() }, "Options"),
    ui.undo,
    h("button", { class: "btn", onclick: reset }, "Reset"),
  );

  ui.turnPanel = h("div", { class: "turn-panel" });
  ui.boardHeader = h("div", { class: "board-header" },
    ui.turnPanel,
    h("div", { class: "board-title" }, game.title),
  );
  ui.board = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ui.board.setAttribute("class", "board");
  ui.board.setAttribute("role", "img");
  ui.board.setAttribute("aria-label", `${game.title} board`);
  ui.thinking = h("div", { class: "thinking", "aria-hidden": "true" }, h("span"), h("span"), h("span"));
  ui.boardWrap = h("div", { class: "board-wrap" }, ui.boardHeader, ui.board, ui.thinking);
  ui.chance = h("div", { class: "chance" });
  ui.actions = h("div", { class: "move-actions" });
  ui.status = h("div", { class: "status", "aria-live": "polite" });
  ui.stage = h("main", { class: "stage" }, ui.boardWrap, ui.chance, ui.actions, ui.status);

  ui.rulesDialog = rulesTemplate ? buildDialog("Rules", rulesTemplate.content.cloneNode(true)) : null;
  ui.optionsDialog = buildDialog("Options", buildOptions());

  root.append(ui.controls, ui.stage, ...[ui.rulesDialog, ui.optionsDialog].filter(Boolean));

  const renderer = createRenderer(ui.board);
  renderer.onCellClick(onCellClick);

  function buildDialog(title, content) {
    const dialog = h("dialog", { class: "dialog" }, h("h2", {}, title), content);
    dialog.append(h("button", { class: "btn dialog-close", onclick: () => dialog.close() }, "Close"));
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    return dialog;
  }

  function optionRow(label, choices, value, onChange) {
    const select = h("select", { class: "btn", onchange: (e) => onChange(e.target.value) });
    for (const c of choices) {
      const v = typeof c === "object" ? c.value : c;
      const opt = h("option", { value: String(v) }, typeof c === "object" ? c.label : String(c));
      if (String(v) === String(value)) opt.selected = true;
      select.append(opt);
    }
    return h("label", { class: "option-row" }, h("span", { class: "label" }, label), select);
  }

  function buildOptions() {
    const frag = document.createDocumentFragment();
    ui.optionSelects = {};
    for (const p of playerIds) {
      // With the swap rule a setting follows the seat, whatever colour it ends up playing.
      const row = optionRow(game.swap ? `${game.players[p].name} at start` : game.players[p].name,
        [{ value: "human", label: "Human" }, { value: "ai", label: "AI" }],
        settings.players[p],
        (v) => { settings.players[p] = v; persist(); onPlayersChanged(); });
      frag.append(row);
    }
    frag.append(optionRow("AI think", AI_TIMES.map((t) => ({ value: t, label: `${t}s` })), settings.aiTime,
      (v) => { settings.aiTime = v; persist(); }));
    for (const [key, spec] of Object.entries(game.options || {})) {
      const row = optionRow(spec.label, spec.choices, settings.options[key], (v) => {
        settings.options = resolveOptions(game, { ...settings.options, [key]: v });
        persist();
        start(settings.options, []);
      });
      ui.optionSelects[key] = row.querySelector("select");
      frag.append(row);
    }
    if (game.colorSchemes) {
      const choices = Object.entries(game.colorSchemes).map(([value, s]) => ({ value, label: s.name }));
      frag.append(optionRow("Colors", choices, settings.scheme, (v) => {
        settings.scheme = v;
        persist();
        renderer.setCellFill(cellFill());
        render();   // marbles and hints may follow the scheme
      }));
    }
    return frag;
  }

  const currentScheme = () => (game.colorSchemes && game.colorSchemes[settings.scheme]) || null;

  function cellFill() {
    const scheme = currentScheme();
    return scheme ? scheme.cellFill : undefined;
  }

  // ---- game flow ----

  const isOver = () => !!game.outcome(state);
  // A decision ply belongs to a player; chance plies are played by the shell.
  // Settings are kept per seat; after a swap the seats play the other colours.
  const controller = (s, p) => settings.players[seatOf(game, s, p)];
  const isHumanAt = (s) => !game.outcome(s) && game.toMove(s) !== CHANCE && controller(s, game.toMove(s)) !== "ai";
  const isHumanTurn = () => !thinking && isHumanAt(state);

  // (Re)build the position for `options` and `moveList`. Illegal moves (e.g.
  // from a hand-edited URL) truncate the history rather than failing.
  function start(options, moveList) {
    cancelAI();
    const opts = resolveOptions(game, options);
    settings.options = opts;
    for (const [k, sel] of Object.entries(ui.optionSelects)) {
      sel.value = String(opts[k]);
      for (const o of sel.options) o.disabled = !optionAllowed(game, k, parseOption(game, k, o.value), opts);
    }
    // Boards depend only on the options, so rebuild only when they change.
    const key = JSON.stringify(opts);
    if (key !== boardKey) {
      board = game.createBoard(opts);
      boardKey = key;
    }
    const result = replay(game, opts, moveList, { strict: false, board });
    state = result.state;
    moves = result.moves;
    lastInfo = result.lastInfo;
    selection = [];
    errorText = "";
    if (renderer.board !== board) showBoard(renderer.rotation);
    writeHash(settings.options, moves);
    render();
    advance();
  }

  function playMove(move) {
    const legal = findLegalMove(game, state, move);
    if (!legal) return;
    lastInfo = game.applyMove(state, legal);
    moves.push(legal);
    selection = [];
    writeHash(settings.options, moves);
    render();
    advance();
  }

  function reset() {
    start(settings.options, []);
  }

  // Step back to the most recent position where a human is to decide. The
  // draws before that decision are kept, so Undo cannot re-roll chance.
  function undo() {
    if (!moves.length) return;
    let n = moves.length - 1;
    while (n > 0) {
      const { state: s } = replay(game, settings.options, moves.slice(0, n), { board });
      if (isHumanAt(s)) break;
      n--;
    }
    start(settings.options, moves.slice(0, n));
  }

  function onPlayersChanged() {
    // A player switched to human mid-search: stop thinking for them.
    if (thinking && controller(state, game.toMove(state)) !== "ai") cancelAI();
    render();
    advance();
  }

  // ---- AI and chance ----

  function setThinking(on) {
    thinking = on;
    ui.thinking.classList.toggle("on", on);
  }

  function cancelAI() {
    aiGeneration++;
    ai.cancel();
    setThinking(false);
    clearTimeout(chanceTimer);
    chanceTimer = null;
  }

  // Move the game along when no human input is needed: play chance plies
  // after a short pause, and ask the AI for its moves.
  function advance() {
    if (isOver() || thinking || chanceTimer) return;
    if (game.toMove(state) === CHANCE) {
      chanceTimer = setTimeout(() => {
        chanceTimer = null;
        if (!isOver() && game.toMove(state) === CHANCE) playMove(sampleChance(game, state));
      }, CHANCE_DELAY_MS);
      return;
    }
    maybeAI();
  }

  function maybeAI() {
    if (isOver() || thinking) return;
    const player = game.toMove(state);
    if (controller(state, player) !== "ai") return;
    const gen = ++aiGeneration;
    setThinking(true);
    render();
    ai.choose({ options: settings.options, moves, timeMs: parseFloat(settings.aiTime) * 1000 })
      .then((move) => {
        if (gen !== aiGeneration) return;
        setThinking(false);
        if (move !== null) playMove(move);
        else render();
      })
      .catch((err) => {
        if (gen !== aiGeneration) return;
        console.error(err);
        setThinking(false);
        errorText = "The AI failed to choose a move (see the console).";
        render();
      });
  }

  // ---- input ----

  function onCellClick(id) {
    if (!isHumanTurn()) return;
    const cellMoves = game.legalMoves(state).filter(Array.isArray);

    // Clicking the last selected cell again commits a complete move that is
    // also a prefix of longer ones, or otherwise steps the selection back.
    if (selection.length && selection[selection.length - 1] === id) {
      const exact = cellMoves.find((m) => m.length === selection.length && startsWith(m, selection));
      if (exact) playMove(exact);
      else { selection.pop(); render(); }
      return;
    }

    let candidate = [...selection, id];
    let matching = cellMoves.filter((m) => startsWith(m, candidate));
    if (!matching.length && selection.length) {
      candidate = [id];   // start a new selection from this cell
      matching = cellMoves.filter((m) => startsWith(m, candidate));
    }
    if (!matching.length) {
      selection = [];
      render();
      return;
    }
    if (matching.length === 1 && matching[0].length === candidate.length) {
      playMove(matching[0]);
      return;
    }
    selection = candidate;
    render();
  }

  // ---- rendering ----

  // Ring the destination of the most recent cell move (skipping draws and
  // other string moves).
  function defaultMarkers() {
    for (let i = moves.length - 1; i >= 0; i--) {
      if (Array.isArray(moves[i])) return [{ id: moves[i][moves[i].length - 1], kind: "ring" }];
    }
    return [];
  }

  // (Re)draw the static board at a display rotation (see fitBoard).
  function showBoard(rotate) {
    renderer.setBoard(board, cellFill(), game.boardDecor ? game.boardDecor(board) : [], rotate);
    lastBoardMax = -1;
  }

  function render() {
    const over = isOver();
    const legal = over ? [] : game.legalMoves(state);
    const targets = selection.length
      ? [...new Set(legal.filter((m) => Array.isArray(m) && m.length > selection.length && startsWith(m, selection))
          .map((m) => m[selection.length]))]
      : [];
    const lastMove = moves[moves.length - 1];
    renderer.draw({
      pieces: piecesOf(game, state),
      players: game.players,
      markers: lastMove === undefined ? [] : game.markers ? game.markers(state, lastMove, lastInfo) : defaultMarkers(),
      selected: selection,
      targets,
    });
    ui.board.classList.toggle("locked", !isHumanTurn());

    // Special (string) moves as buttons on a human turn.
    ui.actions.replaceChildren();
    if (isHumanTurn()) {
      for (const m of legal.filter((x) => typeof x === "string")) {
        const label = (game.moveLabel && game.moveLabel(state, m)) ||
          (game.moveLabels && game.moveLabels[m]) || capitalise(m);
        ui.actions.append(h("button", { class: "btn", onclick: () => playMove(m) }, label));
      }
    }

    const humans = playerIds.some((p) => settings.players[p] !== "ai");
    ui.undo.disabled = !moves.length || !humans;

    renderTurnPanel(over);
    renderChance(ui.chance, game, state, (currentScheme() || {}).marbles);
    renderStatus();
    fitBoard();
  }

  function renderTurnPanel(over) {
    ui.turnPanel.replaceChildren();
    const toMove = currentPlayer(game, state);
    for (const p of playerIds) {
      const spec = game.players[p];
      const summary = game.scoreSummary ? game.scoreSummary(state, p) : {};
      const row = h("div", {
        class: "turn-row" + (p === toMove ? " active" : ""),
        title: summary.title || `${spec.name}${controller(state, p) === "ai" ? " (AI)" : ""}`,
      },
        h("span", { class: "turn-stone", style: `background:${spec.fill}` }),
        summary.main !== undefined ? h("span", { class: "turn-main" }, String(summary.main)) : null,
        h("span", { class: "turn-sub" }, summary.sub !== undefined ? String(summary.sub) : spec.name),
      );
      ui.turnPanel.append(row);
    }
  }

  function renderStatus() {
    const result = game.outcome(state);
    if (errorText) {
      ui.status.innerHTML = `<b>${escapeHtml(errorText)}</b>`;
    } else if (result) {
      const name = (p) => escapeHtml(game.players[p] ? game.players[p].name : `Player ${p}`);
      const verdict = result.winner ? `<b>${name(result.winner)} wins</b>` : "<b>Draw</b>";
      const lines = game.outcomeLines ? game.outcomeLines(state, result) : [];
      ui.status.innerHTML =
        `<div class="verdict"><b>Game over</b> &nbsp;·&nbsp; ${verdict}</div>` +
        (lines.length ? `<div class="scoreline">${lines.join("<br>")}</div>` : "");
    } else {
      const hint = game.turnHint ? game.turnHint(state, currentScheme()) : "";
      ui.status.innerHTML = hint ? escapeHtml(hint) : "";
    }
  }

  // ---- responsive sizing ----
  // Size the board to the smaller of the available width and height so it
  // never overflows a short viewport or wastes vertical space.

  // Games with `rotatable: true` may be turned 90 degrees when that draws the
  // board noticeably larger (a wide board on a portrait phone, say).
  const ROTATE_GAIN = 1.15;
  let lastBoardMax = -1;
  const landscapeQuery = window.matchMedia("(orientation: landscape) and (max-height: 500px)");

  function fitBoard() {
    if (landscapeQuery.matches) {
      const headerH = ui.boardHeader.getBoundingClientRect().height;
      root.style.setProperty("--aside-top", Math.round(headerH + 10) + "px");
    }
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const bottomPad = parseFloat(getComputedStyle(root).paddingBottom) || 0;
    const gap = parseFloat(getComputedStyle(ui.stage).rowGap) || 0;
    const wrapStyle = getComputedStyle(ui.boardWrap);
    const wrapBottom = (parseFloat(wrapStyle.paddingBottom) || 0) + (parseFloat(wrapStyle.borderBottomWidth) || 0);
    // Everything stacked below the board (move buttons, status) plus gaps.
    let below = 0;
    for (const el of [ui.chance, ui.actions, ui.status]) {
      const hgt = el.getBoundingClientRect().height;
      if (hgt > 0 || el === ui.status) below += hgt + gap;
    }
    const boardTop = ui.board.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const max = Math.max(0, Math.floor(vh - boardTop - wrapBottom - below - bottomPad));
    if (!board) return;

    // Turn a rotatable board if that makes it clearly bigger in the space
    // available (width capped by the wrap's max-width, height by `max`).
    if (game.rotatable) {
      const padX = (parseFloat(wrapStyle.paddingLeft) || 0) + (parseFloat(wrapStyle.paddingRight) || 0) +
        (parseFloat(wrapStyle.borderLeftWidth) || 0) + (parseFloat(wrapStyle.borderRightWidth) || 0);
      const availW = Math.min(ui.stage.clientWidth, parseFloat(wrapStyle.maxWidth) || Infinity) - padX;
      const scale = (r) => {
        const [, , w, h] = rotateViewBox(board.viewBox, r).split(" ").map(Number);
        return Math.min(availW / w, max / h);
      };
      const other = renderer.rotation ? 0 : 90;
      if (availW > 0 && max > 0 && scale(other) > ROTATE_GAIN * scale(renderer.rotation)) {
        showBoard(other);
        render();   // redraws pieces and refits; the hysteresis stops it flipping back
        return;
      }
    }

    // The board's width follows from the height budget and its aspect ratio.
    const width = Math.floor(max * viewBoxAspect(rotateViewBox(board.viewBox, renderer.rotation)));
    if (width === lastBoardMax) return;
    lastBoardMax = width;
    ui.boardWrap.style.setProperty("--board-max", width + "px");
  }

  window.addEventListener("resize", fitBoard);
  window.addEventListener("orientationchange", fitBoard);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitBoard);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fitBoard).observe(root);

  // A pasted link to a different position in the same tab.
  window.addEventListener("hashchange", () => {
    const fromHash = readHash(game);
    if (fromHash) start({ ...settings.options, ...fromHash.options }, fromHash.moves);
  });

  // ---- start ----
  const fromHash = readHash(game);
  if (fromHash) start({ ...settings.options, ...fromHash.options }, fromHash.moves);
  else start(settings.options, []);

  // Handle for the console and future tooling.
  return {
    get state() { return state; },
    get moves() { return moves.slice(); },
    play: playMove,
    undo,
    reset,
  };
}
