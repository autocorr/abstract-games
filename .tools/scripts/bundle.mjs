// Bundle a game's page into one self-contained HTML file, for playtesting
// where the site can't be served (e.g. Claude's HTML viewer on a phone):
//
//   node .tools/scripts/bundle.mjs <game id> [out.html]   # default <game id>.html
//   uv run --project .tools python .tools/scripts/check_bundle.py <out.html>
//
// The page gets a single classic inline script (no imports, data: URLs,
// import maps or workers), as sandboxed viewers may block those; the AI
// searches on the main thread, so the page pauses while it thinks. The
// Cburnett chess pieces are inlined as data URLs; other image files a game
// loads by URL are not. Each ES module becomes a factory in a
// registry; imports become reads of the dependency's exports object, whose
// getters keep bindings live.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [id, out = `${id}.html`] = process.argv.slice(2);
if (!id) { console.error("usage: node .tools/scripts/bundle.mjs <game id> [out.html]"); process.exit(1); }
const pageDir = path.join(root, "games", id);
let html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
const mods = new Map();   // repo-relative path -> factory body

const relOf = (dir, spec) => path.relative(root, path.resolve(dir, spec)).split(path.sep).join("/");

// The names a `const a = ..., b = ...` statement starting at `i` declares.
function declNames(src, i) {
  const names = [];
  let depth = 0, expectName = true;
  const NAME = /\s*([A-Za-z_$][\w$]*)/y;
  let last = "";   // last non-space character seen at depth 0
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (expectName && depth === 0) {
      NAME.lastIndex = j;
      const m = NAME.exec(src);
      names.push(m[1]);
      j += m[0].length - 1;
      expectName = false;
      last = "x";
      continue;
    }
    if (depth === 0 && ch === "\n") {
      let k = j + 1;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (!",=([{+-*/?:&|<>!".includes(last) && !".?:+-*/|&,".includes(src[k])) break;
      continue;
    }
    if (ch === "/" && src[j + 1] === "/") { while (j + 1 < src.length && src[j + 1] !== "\n") j++; continue; }
    if (ch === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j) + 1; continue; }
    if (depth === 0 && !/\s/.test(ch)) last = ch;
    if (ch === '"' || ch === "'" || ch === "`") {   // skip strings (no nesting in templates needed here)
      for (j++; j < src.length && src[j] !== ch; j++) if (src[j] === "\\") j++;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (depth === 0 && ch === ",") expectName = true;
    else if (depth === 0 && ch === ";") break;
  }
  return names;
}

function transform(src, dir) {
  const exported = [];
  let n = 0;
  src = src.replace(/\bimport\s*([\s\S]*?)\s*from\s*(["'])(\.{1,2}\/[^"']+)\2;?|\bimport\s*(["'])(\.{1,2}\/[^"']+)\4;?/g,
    (m, clause, q, spec, q2, spec2) => {
      const rel = relOf(dir, spec ?? spec2);
      load(rel);
      if (spec2) return `__r(${JSON.stringify(rel)});`;
      const v = `__m${n++}`;
      const parts = [`const ${v} = __r(${JSON.stringify(rel)});`];
      const named = /\{([\s\S]*?)\}/.exec(clause);
      const rest = clause.replace(/\{[\s\S]*?\}/, "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const r of rest) {
        const ns = /^\*\s*as\s+(\S+)$/.exec(r);
        parts.push(ns ? `const ${ns[1]} = ${v};` : `const ${r} = ${v}.default;`);
      }
      if (named) for (const item of named[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const [from, as = from] = item.split(/\s+as\s+/);
        // A getter-backed accessor keeps the binding live.
        parts.push(`const ${as} = ${v}.${from};`);
      }
      return parts.join(" ");
    });
  if (/\bimport\s*\(/.test(src) || /^\s*export\s*\{/m.test(src) || /^\s*export\s*\*/m.test(src)) throw new Error("unsupported module syntax");
  src = src.replace(/^export\s+default\s+/m, () => { exported.push(["default", "__default"]); return "const __default = "; });
  src = src.replace(/^export\s+((?:async\s+)?function\*?|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, name) => {
    exported.push([name, name]);
    return `${kw} ${name}`;
  });
  src = src.replace(/^export\s+(const|let|var)\s+/gm, (m, kw, offset, whole) => {
    // Offsets shift as we replace; resolve names on the original text below.
    return `${kw} /*__exp*/`;
  });
  src = src.replace(/\/\*__exp\*\//g, (m, offset, whole) => {
    for (const name of declNames(whole, offset + m.length)) exported.push([name, name]);
    return "";
  });
  const getters = exported.map(([k, v]) => `get ${JSON.stringify(k)}() { return ${v}; }`).join(", ");
  return `__e({ ${getters} });\n${src}`;
}

function load(rel) {
  if (mods.has(rel)) return;
  mods.set(rel, "");
  let src = fs.readFileSync(path.join(root, rel), "utf8");
  if (rel === "common/ai/player.js") {
    // No worker in a single file: search on the main thread.
    src = src.replace('new URL("./worker.js", import.meta.url)', "null")
      .replace('this.workerBroken = typeof Worker === "undefined" || !game.url;', "this.workerBroken = true;");
  }
  if (rel === "common/chess/game.js") {
    // Chess piece images are files: inline them as data URLs.
    const dir = path.join(root, "common/pieces/cburnett");
    const urls = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => [
      f.slice(0, -4), "data:image/svg+xml;charset=utf-8," + encodeURIComponent(fs.readFileSync(path.join(dir, f), "utf8")),
    ]));
    const from = "new URL(`../pieces/cburnett/${name}.svg`, import.meta.url).href";
    if (!src.includes(from)) throw new Error("bundle.mjs: chess piece URLs changed; update the inlining");
    src = src.replace(from, `${JSON.stringify(urls)}[name]`);
  }
  // Viewer frames may be about:srcdoc or sandboxed: URL and history calls must not throw.
  src = src.replace('new URL("../../", location.href).pathname', '"#"')
    .replace(/\bhistory\.replaceState\(/g, "__replaceState(");
  src = src.replace(/\bimport\.meta\.url\b/g, JSON.stringify(`https://bundle.invalid/${rel}`));
  mods.set(rel, transform(src, path.dirname(path.join(root, rel))));
}

let pageBody;
html = html.replace(/<script type="module">([\s\S]*?)<\/script>/, (m, body) => {
  pageBody = transform(body, pageDir);
  return "<!--BUNDLE-->";
});

// Exports objects are created before a module body runs (its function and
// class declarations hoist), so a getter read during a cycle sees TDZ only
// for not-yet-run const bindings, as real modules would.
const runtime = `(() => {
"use strict";
const __defs = {}, __cache = {};
const __replaceState = (...a) => { try { history.replaceState(...a); } catch (e) {} };
function __r(rel) {
  if (__cache[rel]) return __cache[rel];
  const exports = {};
  __cache[rel] = exports;
  __defs[rel](__r, (desc) => Object.defineProperties(exports, Object.getOwnPropertyDescriptors(desc)));
  return exports;
}
${[...mods].map(([rel, body]) => `__defs[${JSON.stringify(rel)}] = function (__r, __e) {\n"use strict";\n${body}\n};`).join("\n")}
(function (__r, __e) {\n"use strict";\n${pageBody}\n})(__r, () => {});
})();`;

const b64 = (p) => fs.readFileSync(path.join(root, p)).toString("base64");
let css = fs.readFileSync(path.join(root, "common/base.css"), "utf8")
  .replace(/url\("fonts\/([^"]+)"\)/g, (m, f) => `url("data:font/woff2;base64,${b64("common/fonts/" + f)}")`);
html = html
  .replace(/<link rel="preload"[^>]*>\n?/, "")
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${b64("common/favicon.svg")}" type="image/svg+xml">`)
  .replace(/<script src="[^"]*theme-init.js"><\/script>/, () => `<script>\ntry {\n${fs.readFileSync(path.join(root, "common/theme-init.js"), "utf8")}\n} catch (e) {}\n</script>`)
  // Classic scripts run where they stand: put it after the page body so the DOM exists.
  .replace("<!--BUNDLE-->", "")
  .replace("</body>", () => `<script>\n${runtime.replace(/<\/script/gi, "<\\/script")}\n</script>\n</body>`);
fs.writeFileSync(out, html);
console.log(`${mods.size} modules, ${(html.length / 1024).toFixed(0)} KB -> ${out}`);
