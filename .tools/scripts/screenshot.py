"""Screenshot a page of the locally served site and report console errors.

    npm run serve   # in another shell (port 8000)
    uv run --project .tools python .tools/scripts/screenshot.py [path] [out.png]
"""
import sys
from playwright.sync_api import sync_playwright

path = sys.argv[1] if len(sys.argv) > 1 else "/"
out = sys.argv[2] if len(sys.argv) > 2 else "screenshot.png"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 900})
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://localhost:8000{path}", wait_until="networkidle")
    page.screenshot(path=out, full_page=True)
    print(f"title: {page.title()!r}  saved: {out}")
    for e in errors:
        print("console error:", e)
    browser.close()
