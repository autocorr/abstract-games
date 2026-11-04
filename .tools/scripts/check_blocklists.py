"""Check the site's files against content-blocker filter lists.

Content blockers block scripts whose URLs look like trackers (EasyPrivacy has
"/log-view.js", for one). A blocked ES module breaks everything that imports
it, so a game page comes up blank. This downloads uBlock Origin's default
lists and reports every site file they would block.

    uv run --project .tools python .tools/scripts/check_blocklists.py [extra/path.js ...]

Extra paths (relative to the site root) are checked too, e.g. to try a name
before creating the file. Exits 1 if anything is blocked.
"""
import pathlib
import sys
import urllib.request

import adblock

# uBlock Origin's default filter lists.
LISTS = [
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist.to/easylist/easyprivacy.txt",
    "https://ublockorigin.github.io/uAssets/filters/filters.txt",
    "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
    "https://ublockorigin.github.io/uAssets/filters/badware.txt",
    "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
    "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
    "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
]
SITE = "https://autocorr.github.io/abstract-games/"
KINDS = {".js": "script", ".css": "stylesheet", ".woff2": "font", ".svg": "image", ".html": "document"}
# Not published, or not loaded by pages.
SKIP = {"node_modules", "test", "docs", "references", "experiments"}

root = pathlib.Path(__file__).resolve().parents[2]

filters = adblock.FilterSet()
for url in LISTS:
    req = urllib.request.Request(url, headers={"User-Agent": "abstract-games-blocklist-check"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        filters.add_filter_list(resp.read().decode("utf-8", errors="ignore"))
engine = adblock.Engine(filter_set=filters, optimize=True)

paths = [
    p.relative_to(root).as_posix()
    for p in root.rglob("*")
    if p.is_file() and p.suffix in KINDS
    and not any(part.startswith(".") or part in SKIP for part in p.relative_to(root).parts)
]
paths += sys.argv[1:]

blocked = 0
for path in sorted(paths):
    result = engine.check_network_urls(SITE + path, SITE, KINDS.get(pathlib.Path(path).suffix, "other"))
    if result.matched and not result.exception:
        blocked += 1
        print(f"BLOCKED  {path}")
print(f"checked {len(paths)} files, {blocked} blocked")
sys.exit(1 if blocked else 0)
