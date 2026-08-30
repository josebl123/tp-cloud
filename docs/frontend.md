# Q — frontend notes

A Next.js App Router project built as a **static export**: `next build` produces `out/`, which is
plain HTML, CSS and JS. There is no Next server in production, so the only running thing in the
whole system is the Spring API.

## Design language — "warm hospitality"

The customer holds this on a phone, often outdoors, usually for a single glance: *how many are ahead
of me, and how long?* Everything follows from that.

* **Warm, low-glare surfaces** (sand `#fdfbf7`, espresso `#2b211c`) rather than clinical white and
  blue-grey. The product lives in restaurants and shops, not in a dashboard.
* **One number, enormous.** The customer's position is set in Fraunces at ~100px. Everything else is
  deliberately quieter so the hierarchy survives a two-second look.
* **Terracotta means "you".** The accent is reserved for the customer's own position and for primary
  actions. Sage means settled (open, served), amber means attention (paused, being served), and the
  red is used only where something was actually lost.
* **Fraunces for numbers and headings, Inter for everything else.** Fraunces is there for its
  optical sizing: it holds up at 100px in a way a UI sans does not.
* **Tabular numerals everywhere numbers change**, so a moving queue does not make columns jitter.

Every colour is a semantic token in `src/app/globals.css` — never a raw hex in a component. Dark
mode re-points those same tokens under `prefers-color-scheme`, so each component is written once and
is correct in both themes.

## The pieces that matter

**`lib/useLiveResource.ts`** — one resource, kept in sync. The first read is a plain `fetch`, not the
stream, because `EventSource` cannot report a status code and a missing ticket has to surface as
"this ticket does not exist" rather than a silent connection failure. After that the SSE stream
pushes every change. Polling is the safety net, not the mechanism: it runs only while the stream is
down, so a proxy that blocks `text/event-stream` degrades to a slightly slower app instead of a
broken one.

**`lib/api.ts`** — a typed client that turns the backend's RFC 7807 responses into an `ApiError`
carrying the stable `code`, so the UI can branch on `QUEUE_FULL` rather than on prose.

**`lib/session.ts` / `lib/auth.tsx`** — the staff bearer token in `localStorage` (a static SPA has no
server of its own to hold a session cookie) and a context that restores it on load. The panel guard
waits for that restore before deciding, so reloading the board never bounces a signed-in operator
back to the sign-in screen.

**`lib/usePathSegment.ts`** — reads ids from the address bar after mount. Deliberately not route
params or `useSearchParams`: the two customer routes are single exported shells, and reading the URL
on the client also keeps server and client markup identical.

## Why the URLs are shaped the way they are

A static export cannot pre-render `/q/{queueId}` for ids that do not exist at build time. Two
options were on the table: put the id in a query string, or serve one shell per public route and
rewrite at the CDN. The QR poster and the ticket link are the two URLs a human actually sees, so
they got the clean paths and the two rewrite rules. Staff URLs — which nobody prints — use query
strings and need no configuration at all.

`next.config.ts` mirrors the production rewrites in `next dev`, so the two environments behave the
same.

## Known limits

* **SSE fan-out is per-instance on the backend.** With more than one API replica a customer only
  receives updates produced by the instance holding their connection. The frontend needs no change
  when that is fixed; see the scaling note in `realtime/SseHub`.
* **The staff stream passes its token as a query parameter**, because `EventSource` cannot set
  headers. Tokens can therefore appear in access logs. Behind a proxy that converts the token to a
  cookie this goes away.
* **No test suite yet.** The API is covered by 58 tests; the frontend is verified by hand. Playwright
  against the real stack is the obvious next step.
