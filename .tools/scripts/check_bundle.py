"""Check a bundled game page (see bundle.mjs) as a sandboxed HTML viewer would
load it: a phone-width srcdoc iframe with scripts only (opaque origin, no
storage). Clicks cells at random to play, then reports the end of the log and
any console errors, and saves a screenshot.

    uv run --project .tools python .tools/scripts/check_bundle.py <page.html> [out.png]
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

html = Path(sys.argv[1]).read_text()
out = sys.argv[2] if len(sys.argv) > 2 else "bundle.png"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 412, "height": 900})
    errors = []
    page.on("console", lambda m: m.type in ("error", "warning") and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.set_content('<body style="margin:0"><iframe id="f" sandbox="allow-scripts" '
                     'style="border:0;width:412px;height:880px"></iframe></body>')
    page.eval_on_selector("#f", "(f, html) => { f.srcdoc = html; }", html)
    page.wait_for_timeout(2500)
    frame = page.frames[1]
    for _ in range(40):
        frame.evaluate("""() => {
          const cells = [...document.querySelectorAll("polygon.cell, .cell")];
          for (let i = 0; i < 200 && cells.length; i++)
            cells[Math.floor(Math.random() * cells.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }""")
        page.wait_for_timeout(400)
    page.wait_for_timeout(3000)
    log = frame.evaluate("""() => [...document.querySelectorAll("ol li, .log li")].slice(-3)
      .map((e) => e.innerText.replace(/\\s+/g, " ")).join("\\n")""")
    print(f"log tail:\n{log}")
    page.screenshot(path=out, full_page=True)
    print(f"saved: {out}")
    print("errors:", errors or "none")
    browser.close()
