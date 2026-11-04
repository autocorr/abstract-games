// Game page shell: mount(game) builds the whole page UI around a Game (see
// ARCHITECTURE.md). Games provide rules; this module provides the layout
// (board plus a gutter of sections), rendering, move input, AI players,
// history, undo and the URL hash.

import { createRenderer, rotateViewBox, viewBoxAspect } from "./render.js";
import { AIPlayer } from "./ai/player.js";
import { renderChance } from "./chance-view.js";
import { h, escapeHtml, capitalise, section } from "./ui/dom.js";
import { buildSetup, AI_TIMES } from "./ui/setup.js";
import { games as registry } from "../games.js";
import {
  replay, resolveOptions, optionAllowed, findLegalMove, moveKey, parseMoveKey, piecesOf, sampleChance, currentPlayer, seatOf, CHANCE,
} from "./engine.js";

// Pause before a chance ply (a marble draw) is played, so it can be seen.
const CHANCE_DELAY_MS = 450;

const DEFAULT_AI_TIME = "1";

// Two columns (board left, gutter right) on landscape screens and wide
// windows; one column (head, board, then the sections) otherwise. Keep in
// step with the media queries in base.css.
const WIDE_QUERY = "(orientation: landscape) and (min-width: 560px), (min-width: 1000px)";

// On one-column layouts the board leaves this much of the viewport below it,
// so the top of the turn card stays in view.
const NARROW_RESERVE_PX = 110;

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
  // root (body.game)
  //   .page
  //     .board-col > .board-wrap > svg.board
  //     aside.gutter
  //       header.page-head        title, blurb, link back to the games
  //       .card.turn-card         players, status, bags, move buttons, Undo
  //       details Setup / Rules   collapsible sections
  // On one-column layouts the gutter's children flow under the board, and
  // the head moves above it (CSS).
  root.classList.add("game");
  const ui = {};
  const entry = registry.find((g) => g.id === game.id);
  const blurb = entry ? entry.blurb : "";
  const gamesHref = new URL("../../", location.href).pathname;
  const wideQuery = window.matchMedia(WIDE_QUERY);

  ui.head = h("header", { class: "page-head" },
    h("a", { class: "back", href: gamesHref }, "← Games"),
    h("h1", { class: "title" }, game.title),
    blurb ? h("p", { class: "blurb" }, blurb) : null);

  ui.board = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ui.board.setAttribute("class", "board");
  ui.board.setAttribute("role", "img");
  ui.board.setAttribute("aria-label", `${game.title} board`);
  ui.boardWrap = h("div", { class: "board-wrap" }, ui.board);
  ui.boardCol = h("main", { class: "board-col" }, ui.boardWrap);

  ui.players = h("div", { class: "players" });
  ui.status = h("div", { class: "status", "aria-live": "polite" });
  ui.chance = h("div", { class: "chance" });
  ui.actions = h("div", { class: "move-actions" });
  ui.undo = h("button", { class: "btn", onclick: undo }, "Undo");
  ui.turnCard = h("section", { class: "card turn-card", "aria-label": "Turn" },
    ui.players, ui.status, ui.chance, ui.actions,
    h("div", { class: "turn-buttons" }, ui.undo, h("button", { class: "btn", onclick: reset }, "New game")));

  const setup = buildSetup(game, settings, {
    onPlayer(p, v) { settings.players[p] = v; persist(); onPlayersChanged(); },
    onAiTime(v) { settings.aiTime = v; persist(); },
    onOption(key, v) {
      settings.options = resolveOptions(game, { ...settings.options, [key]: v });
      persist();
      start(settings.options, []);
    },
    onScheme(v) {
      settings.scheme = v;
      persist();
      renderer.setCellFill(cellFill());
      render();   // marbles and hints may follow the scheme
    },
  });
  ui.optionSelects = setup.optionSelects;
  ui.setup = section("setup", "Setup", setup.node, { open: wideQuery.matches });

  const rulesTemplate = document.getElementById("rules");
  ui.rules = rulesTemplate || blurb
    ? section("rules", "Rules", [
        blurb ? h("p", { class: "rules-blurb" }, blurb) : null,
        rulesTemplate ? h("div", { class: "rules" }, rulesTemplate.content.cloneNode(true)) : null,
      ])
    : null;

  ui.gutter = h("aside", { class: "gutter" }, ui.head, ui.turnCard, ui.setup, ui.rules);
  ui.page = h("div", { class: "page" }, ui.boardCol, ui.gutter);
  root.append(ui.page);

  const renderer = createRenderer(ui.board);
  renderer.onCellClick(onCellClick);

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
    renderPlayers();
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

    renderPlayers();
    renderChance(ui.chance, game, state, (currentScheme() || {}).marbles);
    renderStatus();
    fitBoard();
  }

  // One row per player: stone, name, AI tag and score; the player to move
  // is highlighted, with the thinking dots while the AI searches.
  function renderPlayers() {
    if (!state) return;
    ui.players.replaceChildren();
    const toMove = currentPlayer(game, state);
    for (const p of playerIds) {
      const spec = game.players[p];
      const summary = game.scoreSummary ? game.scoreSummary(state, p) : {};
      const isAI = controller(state, p) === "ai";
      const active = p === toMove;
      const sub = summary.sub !== undefined && String(summary.sub) !== spec.name ? String(summary.sub) : null;
      ui.players.append(h("div", {
        class: "player-row" + (active ? " active" : ""),
        title: summary.title || `${spec.name}${isAI ? " (AI)" : ""}`,
      },
        h("span", { class: "turn-stone", style: `background:${spec.fill}` }),
        h("span", { class: "player-name" }, spec.name),
        isAI ? h("span", { class: "player-tag" }, "AI") : null,
        active && thinking ? h("span", { class: "thinking", "aria-label": "thinking" }, h("span"), h("span"), h("span")) : null,
        h("span", { class: "player-score" },
          sub ? h("span", { class: "score-sub" }, sub) : null,
          summary.main !== undefined ? h("span", { class: "score-main" }, String(summary.main)) : null),
      ));
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
  // The board takes the width of its column and is capped by the viewport
  // height: on two-column layouts it fits the viewport; on one column it
  // leaves NARROW_RESERVE_PX below it for the top of the turn card.

  // Games with `rotatable: true` may be turned 90 degrees when that draws the
  // board noticeably larger (a wide board on a portrait phone, say).
  const ROTATE_GAIN = 1.15;
  let lastBoardMax = -1;

  const px = (style, ...props) => props.reduce((sum, p) => sum + (parseFloat(style[p]) || 0), 0);

  function fitBoard() {
    if (!board) return;
    const wide = wideQuery.matches;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const wrapStyle = getComputedStyle(ui.boardWrap);
    const chromeX = px(wrapStyle, "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth");
    const chromeY = px(wrapStyle, "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth");

    // Width: the page minus the gutter on two columns.
    let availW = ui.page.clientWidth;
    if (wide) availW -= ui.gutter.getBoundingClientRect().width + px(getComputedStyle(ui.page), "columnGap");
    availW -= chromeX;
    // Height: from the board's top (in document coordinates) to the bottom
    // of the viewport, less the page's bottom padding or the reserve.
    const top = ui.boardWrap.getBoundingClientRect().top - document.documentElement.getBoundingClientRect().top;
    const below = wide ? px(getComputedStyle(root), "paddingBottom") : NARROW_RESERVE_PX;
    const availH = Math.floor(vh - top - chromeY - below);
    if (availW <= 0 || availH <= 0) return;

    // Turn a rotatable board if that makes it clearly bigger in the space available.
    if (game.rotatable) {
      const scale = (r) => {
        const [, , w, h] = rotateViewBox(board.viewBox, r).split(" ").map(Number);
        return Math.min(availW / w, availH / h);
      };
      const other = renderer.rotation ? 0 : 90;
      if (scale(other) > ROTATE_GAIN * scale(renderer.rotation)) {
        showBoard(other);
        render();   // redraws pieces and refits; the hysteresis stops it flipping back
        return;
      }
    }

    const aspect = viewBoxAspect(rotateViewBox(board.viewBox, renderer.rotation));
    const width = Math.floor(Math.min(availW, availH * aspect)) + chromeX;
    if (width === lastBoardMax) return;
    lastBoardMax = width;
    ui.boardWrap.style.setProperty("--board-w", width + "px");
  }

  window.addEventListener("resize", fitBoard);
  window.addEventListener("orientationchange", fitBoard);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitBoard);
  wideQuery.addEventListener("change", fitBoard);
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
