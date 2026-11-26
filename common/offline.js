// Offline play, strictly opt-in: the landing page's Cache link calls
// cacheSite(), which asks for persistent storage, registers the service
// worker (sw.js at the site root) and has it store a fresh copy of every
// file. Nothing is stored until the link is clicked, and the copy changes
// only when it is clicked again.
const SW_URL = new URL("../sw.js", import.meta.url);
const SAVED_KEY = "abstract-games:offline-saved";

function stored() {
  try { return localStorage.getItem(SAVED_KEY); } catch { return null; }
}

// When the stored copy was last saved, as text (e.g. "Saved 2026-11-25"), or
// "" if there is none (never saved, or cleared by the browser).
export async function cacheStatus() {
  const saved = stored();
  const has = await globalThis.caches?.has("abstract-games").catch(() => false);
  return saved && has ? `Saved ${saved}` : "";
}

// Store a fresh copy of the site. `onStatus(text)` hears progress and the result.
export async function cacheSite(onStatus) {
  if (!("serviceWorker" in navigator)) {
    onStatus("Offline play is not supported here");
    return;
  }
  // Ask first, while the click still counts as a user gesture. Firefox may
  // show a prompt; saving goes ahead without waiting for the answer.
  navigator.storage?.persist?.().catch(() => {});
  onStatus("Saving…");
  try {
    const reg = await navigator.serviceWorker.register(SW_URL);
    // A newer sw.js (e.g. a longer FILES list) takes over before saving.
    const pending = reg.installing || reg.waiting;
    if (pending) {
      await new Promise((resolve) => {
        pending.addEventListener("statechange", () => {
          if (pending.state === "activated" || pending.state === "redundant") resolve();
        });
      });
    }
    const result = await new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (event) => resolve(event.data);
      reg.active.postMessage("cache", [port2]);
    });
    if (!result.ok) throw new Error(result.error);
    const date = new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, local
    try { localStorage.setItem(SAVED_KEY, date); } catch { /* storage disabled */ }
    onStatus(`Saved ${date}`);
  } catch (err) {
    console.error("caching for offline play:", err);
    onStatus("Saving failed");
  }
}
