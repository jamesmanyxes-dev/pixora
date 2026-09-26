---
name: Browser and sandbox quirks
description: Environment quirks that cost real debugging time — agent-browser URL rewriting, proxy challenge noise, cache layers, React minified errors
---

# Browser & sandbox quirks (learned 2026-09-25, Pixora debugging)

- `agent-browser open http://localhost:3001` **rewrites the address bar to the public skydive.app URL** — all browser traffic goes through the platform proxy. Don't be surprised when `location.href` shows skydive.app; and expect the proxy's proof-of-work challenge ("SOLVING...") to spam `agent-browser console` output — filter it with `grep -v SOLVING`.
- `agent-browser console` output is noisy and may not include page errors clearly; the reliable way to see JS errors is an in-page collector registered **before** the app module runs (first lines of the entry module, rebuilt into the bundle) read via `agent-browser eval "JSON.stringify(window.__errs)"`.
- `location.reload(true)` does NOT bypass HTTP cache. To bust: unregister service workers (`navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>r.unregister()))`), delete caches (`caches.keys().then(ks=>ks.map(k=>caches.delete(k)))`), then `fetch('/', {cache:'reload'}).then(()=>location.reload())`. Service-worker registrations persist across `agent-browser close --all` sessions.
- A resource entry in `performance.getEntriesByType('resource')` with 200 + correct decodedBodySize proves the file was **fetched**, not **executed** — module execution failures show up as console/page errors, not as fetch failures.
- React production builds minify error messages to codes. "Minified React error #31 (object with keys {$$typeof, render, displayName})" = a component object rendered as a JSX child (typically a lucide icon component placed in an array literal instead of `<Icon />`). Rebuild with `npx vite build --minify false` to get readable stacks.
- Managed Postgres (Neon) requires `platform secrets run` for any direct node script that needs DATABASE_URL — plain `node` in the shell has no env and ECONNREFUSEDs on localhost:5432.
- Hash-only navigation (`location.hash = ...`) across deploys can leave a **zombie React tree**: clicks fire natively but handlers are dead and a MutationObserver shows zero DOM changes. Always `location.reload()` before UI verification after a deploy; don't debug code the tree never executed.
- Multiple agent-browser tabs on the same origin **share localStorage** and each keeps a live socket with an in-memory (possibly stale) token — old tabs emit real events (incoming-call modals, declines, token refreshes) that corrupt multi-user/socket tests. Close all but the test tab first.
