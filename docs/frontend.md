# Q — frontend notes

A Next.js App Router project built as a **static export**: `next build` produces `out/`, which is
plain HTML, CSS and JS. There is no Next server in production: the files sit in a private S3 bucket
and API Gateway serves them from the same origin as the API, so the site calls it with relative URLs
and needs no CORS.

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
WebSocket, because a WebSocket cannot report a status code and a missing ticket has to surface as
"this ticket does not exist" rather than a silent connection failure. After that the socket pushes
every change. It reconnects with backoff (API Gateway closes a connection after two hours, or ten
idle minutes, so it also pings every five) and reloads over REST on every reconnection, since
whatever happened while it was down was not pushed. Polling is the safety net, not the mechanism: it
runs only while the socket is down, so a network that blocks WebSockets degrades to a slightly slower
app instead of a broken one.

**`lib/api.ts`** — a typed client that turns the API's RFC 7807 responses into an `ApiError`
carrying the stable `code`, so the UI can branch on `QUEUE_FULL` rather than on prose. It also gets
the address the WebSocket opens with: the customer's own ticket token, or for staff a one-time ticket
from `POST /queues/{id}/ws-tickets`, so the Cognito token never goes in a URL.

**`lib/cognito.ts`** — sign-up and sign-in straight against Cognito's JSON API with `fetch`, from
the site's own pages: no SDK and no hosted login page. Cognito's errors are translated to the codes
the API used, so the pages need no new cases.

**`lib/config.ts`** — what the site learns at runtime: the Cognito ids and the WebSocket address.
They only exist after `terraform apply`, and the site is built before it, so Terraform writes them
to `config.json` next to the site and the page reads it once per load.

**`lib/session.ts` / `lib/auth.tsx`** — the staff token in `localStorage` (a static SPA has no
server of its own to hold a session cookie) and a context that restores it on load. The panel guard
waits for that restore before deciding, so reloading the board never bounces a signed-in operator
back to the sign-in screen.

**`lib/useQueryParam.ts`** — reads ids from the address bar after mount. Deliberately not route
params or `useSearchParams`: the latter forces a Suspense boundary on every page under a static
export, and reading the URL on the client also keeps server and client markup identical. (This
replaced `usePathSegment.ts` when public ids moved to query strings — see below.)

**`components/ui/Button.tsx`** — `Button`, plus `ButtonLink` and `ButtonAnchor` that render a single
`<a>` wearing the same look. The obvious spelling, a `<Link>` wrapped around a `<Button>`, produces
`<a><button></a>`, which the HTML content model forbids: keyboard users get two tab stops for one
control and a screen reader announces "link, button".

**`components/WaitFigure.tsx`** — a waiting time in the slot where a number goes. The display face is
this product's way of saying "here is the figure that matters", so it is only honest while the value
*is* a figure; at the ends of the range `formatWait` returns a sentence ("You're next", "No wait"),
and a sentence set at 3rem in a serif reads as a headline and wraps to three lines on a phone. One
slot, two treatments, chosen by what the value actually is.

## Why the URLs are shaped the way they are

A static export cannot pre-render `/q/{queueId}` for ids that do not exist at build time. Two
options were on the table: put the id in a query string, or serve one shell per public route and
rewrite at the CDN.

The original build took the second: clean paths for the two URLs a human actually sees, plus two
CloudFront rewrite rules. That was later reversed — **every id now travels in a query string**,
`/q/?id=…` and `/t/?token=…` included — because a rewrite rule is something only a CDN can express,
and plain static hosting on S3 cannot. The clean path read better on a printed poster; the query
string costs nothing and takes the hosting configuration to zero rules. The reasoning is recorded at
the top of `next.config.ts`.

## The UX, UI and accessibility pass

The interface was reviewed end to end against a running stack — every screen, both languages, light
and dark, 320px upward — and rebuilt where it fell short. What follows is the part worth knowing
later, grouped by what caused it.

### The palette had to move to reach AA

Contrast was computed rather than eyeballed, and four token pairs failed WCAG AA in light mode:
`faint` on `raised` measured **2.59:1** while carrying every hint, timestamp and helper string;
`brand`/`on-brand` — the primary button — **3.91:1**; `warn` **4.08:1**; `sage` **4.14:1**. All were
re-derived, and `muted` had to darken alongside `faint` or the two tiers would have collapsed into
each other. **All nine token pairs now clear 4.5:1**; dark mode already passed. `brand` on
`brand-soft` sits at 4.52:1, so it has little headroom — re-measure if either token moves.

### Two traps in the styling layer

**Tailwind utilities sit in a later cascade layer than `@layer base`.** `focus:outline-none` in the
shared input class therefore beat the global `:focus-visible` rule outright, and every text input,
number box, password field and select in the app had no focus ring — only a 1px border tint.
Specificity does not enter into it; the layer decides.

**Grid items default to `min-width: auto`,** so a track cannot shrink below its content's min-content
width. One unshrinkable staff row measured a min-content of **390px**, which forced the grid, and
therefore the whole document, to 441px: the board scrolled sideways on every phone. It showed up in
Spanish first, because Spanish runs about 20% longer than English. `min-w-0` on the grid children
plus a row that wraps its actions fixed it — verified at 320px and 375px across all eight routes in
both languages.

### The customer's turn had to leave the viewport

The page invites you to close it and get on with your evening, which means the one moment that
matters arrives while the tab is in the background. It was reaching only the pixels. Three signals
now carry it, none needing a permission prompt: the tab title (`24 ahead · Q` → `⬤ It's your turn —
Q`), a short `navigator.vibrate`, and an `aria-live="assertive"` region. A Web Notification would
need `Notification.requestPermission`, and asking for that before the customer has any reason to
trust the page is how permission prompts get denied forever.

### The join page was the only screen that never updated

Every other surface is live. The one that has to answer *"is this worth the wait?"* — and the one
most likely to be left open while somebody decides — fetched once on mount and never again. A queue
that was paused or full when the page loaded stayed that way on screen forever; the customer had to
know to reload before they could ever join. It now polls every 15s **while the tab is visible**, and
immediately on `visibilitychange`, so a paused screen recovers on its own.

### Copy that was not true

* `waitingCount` is `countByQueueIdAndStatus(WAITING)` — a count of **entries**. "24 people waiting"
  was the wrong noun, and it was the same figure the next line correctly called "groups".
* `ticket.leftTitle` said *"You left the queue"*. Staff "Remove" and the customer's own "Leave" both
  land on `LEFT`, so the frontend cannot tell them apart — it now says only what is certainly true.
* The queue's danger zone said **"Archive"**, promising recoverability over a `DELETE`, and neither
  confirmation mentioned that anyone still waiting loses their place.
* In Spanish, **"fila" named both the queue and a lane**, which made `¿Eliminar esta fila?` ambiguous
  between deleting one band and deleting the whole queue — on the same screen, next to each other.
  Lanes are now `carril` throughout; the queue keeps `fila`, which is the word the customer sees.

### Things that had no way back

The customer's join form was unmounted whenever the typed party size had no lane — including the
field the message told them to change. `Remove` and `No show` acted on a named person with no
confirmation while closing a queue was confirmed; `Done`, the most final of the three, had none
either. A failed "leave the queue" closed the dialog silently, so the customer believed they had
given up their place while the line still held it. A failed queue-list load set `queues` to `[]`,
rendering "You have no queues yet" and inviting the owner to create a duplicate of a queue that
merely was not reachable.

### Races and lifecycle

`useLiveResource` had three writers — first load, explicit refresh, and the stream — with no ordering
between them, so a poll issued while the stream was down could resolve after a newer pushed snapshot
and roll the board back. Each read now takes a monotonic ticket and a result older than what has
already been applied is dropped. The polling fallback also minted an `AbortController` per tick and
never aborted any of them.

`ConfirmDialog`'s focus effect listed `onCancel` in its dependencies, and every call site passes a
fresh inline arrow — so any parent re-render tore the effect down and re-ran it. On the staff board
a live update arriving while the dialog was open **dragged focus off Cancel and onto the destructive
confirm button**; pressing Enter then removed a real customer. The callback now lives in a ref and
the effect is keyed on `open` alone. Reproduced before the fix and verified after.

The settings page's load effect depended on `t`, whose identity changes with the locale, so switching
language re-fetched the queue and overwrote every unsaved edit.

### Session handling

A 401 after boot was handled nowhere: a twelve-hour staff token expires mid-shift, and the board kept
rendering its last snapshot of customer names and email addresses with no route back to sign-in.
`api.ts` now drops the token on a 401 to any non-public path, which notifies `subscribeToToken` — a
hook that already existed, was exported, and had **zero subscribers**. The same wiring plus a
`storage` listener makes signing out reach the other tabs, which it previously did not.


## Known limits

* **No test suite yet.** The functions are covered by 128 tests; the frontend is verified by hand
  against a deployed stack. Playwright is the obvious next step.
* **No local API.** `npm run dev` proxies `/api/v1` and `config.json` to the deployed site
  (`DEV_API_URL`, see `next.config.ts`), so developing the frontend needs the lab running.
* **No per-page `<title>`.** Only the ticket page sets one (it changes to signal the turn). Two staff
  tabs are therefore indistinguishable in the tab bar.
* **No navigation guard on unsaved settings.** The page says you have unsaved changes; leaving it
  still discards them silently.
* **`formatClock` follows the browser locale, not the app locale**, so switching to Spanish on an
  English browser leaves times in 12-hour form.
* **`useHighWaterMark` is a ref**, so "you've moved up N places" restarts from the current position
  after a reload and under-reports.
