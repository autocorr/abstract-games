// The Log section of a game page: one line per turn, each ply a button that
// jumps to the position after it, plus navigation (start, back, forward,
// end) and a button that copies a link to the position on show.

import { h } from "./dom.js";

// onJump(n): show the position after n plies. onCopy(): copy the link and
// resolve to true on success.
export function createLogView({ onJump, onCopy }) {
  const list = h("ol", { class: "log-list" });
  const scroller = h("div", { class: "log-scroll" }, list);
  const nav = {
    first: h("button", { class: "btn icon", title: "Start (Home)", "aria-label": "Start", onclick: () => onJump(0) }, "⏮"),
    prev: h("button", { class: "btn icon", title: "Back (←)", "aria-label": "Back", onclick: () => onJump(cursor - 1) }, "◀"),
    next: h("button", { class: "btn icon", title: "Forward (→)", "aria-label": "Forward", onclick: () => onJump(cursor + 1) }, "▶"),
    last: h("button", { class: "btn icon", title: "Latest (End)", "aria-label": "Latest", onclick: () => onJump(length) }, "⏭"),
  };
  const copy = h("button", { class: "btn copy-link", onclick: copyLink }, "Copy link");
  const node = h("div", { class: "log" }, scroller,
    h("div", { class: "log-nav" }, nav.first, nav.prev, nav.next, nav.last, copy));

  list.addEventListener("click", (e) => {
    const ply = e.target instanceof Element ? e.target.closest("[data-n]") : null;
    if (ply) onJump(Number(ply.dataset.n));
  });

  let cursor = 0, length = 0;
  let shown = null;   // what the list was last built from

  async function copyLink() {
    let ok = false;
    try { ok = (await onCopy()) !== false; } catch { ok = false; }
    copy.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { copy.textContent = "Copy link"; }, 1500);
  }

  const plyButton = (n, text) => h("button", { class: "ply", "data-n": String(n) }, text);

  // turns: groupTurns() output; players: game.players; result: text shown
  // after the last turn when the line ends the game (or "").
  function update({ turns, cursor: c, length: len, players, result }) {
    cursor = c;
    length = len;
    nav.first.disabled = nav.prev.disabled = c === 0;
    nav.next.disabled = nav.last.disabled = c === len;

    if (!shown || shown.turns !== turns || shown.result !== result) {
      list.replaceChildren(h("li", { class: "log-start" }, plyButton(0, "Start")));
      for (const turn of turns) {
        const spec = players[turn.player];
        const plies = [];
        turn.plies.forEach((p, i) => {
          if (i) plies.push(h("span", { class: "sep", "aria-hidden": "true" }, "·"));
          plies.push(plyButton(p.index + 1, p.text));
        });
        list.append(h("li", { class: "log-turn" },
          h("span", { class: "turn-no" }, `${turn.number}.`),
          spec ? h("span", { class: "turn-stone", title: spec.name, style: `background:${spec.fill}` }) : null,
          h("span", { class: "plies" }, plies)));
      }
      if (result) list.append(h("li", { class: "log-result" }, result));
      shown = { turns, result, cursor: -1 };
    }
    if (shown.cursor !== c) {
      for (const b of list.querySelectorAll("[data-n]")) {
        const n = Number(b.dataset.n);
        b.classList.toggle("current", n === c);
        b.classList.toggle("future", n > c);
        if (n === c) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      }
      const current = list.querySelector(".current");
      // At the end of the line, show the end of the log (with the result).
      if (c === len) scroller.scrollTop = scroller.scrollHeight;
      else if (current) keepInView(current);
      shown.cursor = c;
    }
  }

  // Scroll the log (not the page) so `el` is visible.
  function keepInView(el) {
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top - 4;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight + 4;
  }

  return { node, update };
}
