// The "largest groups cascading" win condition, and the group analysis it
// needs. Pure: no DOM.
//
// Each player lists the sizes of their groups (connected stones of their
// colour), largest first. The lists are compared one position at a time;
// at the first position where they differ, the larger group wins. A board
// with an odd number of cells, filled, gives the players stone totals of
// different parity, so the lists always differ: there are no draws.
//
// `cells[id]` is the player whose stone is on cell id (0 for empty), as in
// the games' states; the players are 1 and 2.

// Groups of connected same-coloured stones: group[id] is the stone's group
// index (-1 if empty); size[g] and owner[g] describe group g.
export function analyzeGroups(board, cells) {
  const group = new Int16Array(cells.length).fill(-1);
  const size = [], owner = [];
  const stack = [];
  for (let start = 0; start < cells.length; start++) {
    const p = cells[start];
    if (!p || group[start] >= 0) continue;
    const g = size.length;
    let n = 0;
    group[start] = g;
    stack.push(start);
    while (stack.length) {
      const id = stack.pop();
      n++;
      for (const nb of board.neighbours[id]) {
        if (cells[nb] === p && group[nb] < 0) { group[nb] = g; stack.push(nb); }
      }
    }
    size.push(n);
    owner.push(p);
  }
  return { group, size, owner };
}

// A player's group sizes, largest first.
export function sizesOf(a, player) {
  return a.size.filter((_, g) => a.owner[g] === player).sort((x, y) => y - x);
}

// Index of the first group where the lists differ, or -1 if they are equal.
export function firstDifference(x, y) {
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return i;
  return -1;
}

// The winner by largest groups cascading: 1, 2, or 0 if the lists are equal.
export function cascadeWinner(a) {
  const one = sizesOf(a, 1), two = sizesOf(a, 2);
  const i = firstDifference(one, two);
  return i < 0 ? 0 : (one[i] || 0) > (two[i] || 0) ? 1 : 2;
}

// Why the lists differ: "Largest group: Black 9, White 7." or "Tied on the
// largest 2 groups; group 3 decides: Black 4, White 3." (`players` names 1
// and 2.)
export function decider(one, two, players) {
  const i = firstDifference(one, two);
  if (i < 0) return "";
  const [n1, n2] = [players[1].name, players[2].name];
  const a = one[i] || 0, b = two[i] || 0;
  if (i === 0) return `Largest group: ${n1} ${a}, ${n2} ${b}.`;
  return `Tied on the largest ${i} group${i > 1 ? "s" : ""}; group ${i + 1} decides: ${n1} ${a}, ${n2} ${b}.`;
}

const listText = (sizes) => sizes.join(" ") || "none";

// Game hooks shared by games scored this way. `players` is the game's
// players object; `shown` is how many sizes the turn card lists.
export function largestGroupsHooks(players, { shown = 5 } = {}) {
  return {
    // Every stone shows the size of its group.
    piecesOf(s) {
      const a = analyzeGroups(s.board, s.cells);
      const out = [];
      for (let id = 0; id < s.cells.length; id++) {
        if (s.cells[id]) out.push({ id, player: s.cells[id], label: String(a.size[a.group[id]]) });
      }
      return out;
    },
    // The leading group sizes, which decide the game, largest first.
    scoreSummary(s, player) {
      const sizes = sizesOf(analyzeGroups(s.board, s.cells), player);
      const name = players[player].name;
      return {
        main: sizes.length ? sizes.slice(0, shown).join(" ") + (sizes.length > shown ? " …" : "") : "–",
        sub: name,
        title: `${name}'s groups, largest first: ${listText(sizes)}`,
      };
    },
    outcomeLines(s) {
      const a = analyzeGroups(s.board, s.cells);
      const one = sizesOf(a, 1), two = sizesOf(a, 2);
      return [decider(one, two, players), `${players[1].name}: ${listText(one)}`, `${players[2].name}: ${listText(two)}`];
    },
  };
}
