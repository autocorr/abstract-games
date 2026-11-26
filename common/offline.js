// Offline play: registers the service worker (sw.js at the site root), which
// keeps a copy of every page. Each page load asks it, at most every few hours,
// to refresh that copy; the landing page shows how it went.
const SW_URL = new URL("../sw.js", import.meta.url);
const REFRESH_KEY = "abstract-games:offline-refreshed";
const PERSIST_KEY = "abstract-games:offline-persist-asked";
const REFRESH_MS = 6 * 60 * 60 * 1000;

function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage disabled */ }
}

// Register the service worker. `onStatus(text)`, if given, hears about the
// offline copy (e.g. "Saved for offline play").
export async function enableOffline(onStatus = () => {}) {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  let reg;
  try {
    reg = await navigator.serviceWorker.register(SW_URL);
  } catch (err) {
    console.warn("offline play unavailable:", err);
    return;
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { type, total, cached } = event.data || {};
    if (type !== "offline-status") return;
    if (cached === total) {
      store(REFRESH_KEY, String(Date.now()));
      onStatus("Saved for offline play");
      askToPersist();
    } else {
      onStatus(`Saved ${cached} of ${total} files for offline play`);
    }
  });
  await navigator.serviceWorker.ready;
  const last = Number(stored(REFRESH_KEY)) || 0;
  if (navigator.onLine && Date.now() - last > REFRESH_MS) {
    (navigator.serviceWorker.controller || reg.active)?.postMessage("refresh");
  } else if (last) {
    onStatus("Saved for offline play");
  }
}

// Ask once that the browser not evict the offline copy under storage pressure.
function askToPersist() {
  if (stored(PERSIST_KEY) || !navigator.storage?.persist) return;
  store(PERSIST_KEY, "1");
  navigator.storage.persist().catch(() => {});
}
