# Q (Queue) - REST API

Base path `/api/v1`, under the API Gateway stage: `https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/api/v1`.
The same API serves the site, so the browser calls it with relative URLs and there is no CORS.
Every route is declared in [`terraform/organization/openapi.tf`](../terraform/organization/openapi.tf) (35 routes)
and handled by one of two Lambdas: `public` or `staff`.

Two audiences share one API:

* **`/api/v1/public/**`** and `/api/v1/health` - anonymous customers, served by `λ public`. No
  token. Authorised by the opaque ticket token in the path.
* **everything else** - staff, served by `λ staff`. `Authorization: Bearer <Cognito id token>`. API
  Gateway's Cognito authorizer rejects a missing or expired token with 401 before any Lambda runs.

## Errors

Every failure the functions produce is RFC 7807 `application/problem+json` with a stable
machine-readable `code`:

```json
{
  "type": "https://q.itba.ar/problems/queue-full",
  "title": "Conflict",
  "status": 409,
  "detail": "This queue has reached its maximum size",
  "instance": "/prod/api/v1/public/queues/.../entries",
  "code": "QUEUE_FULL",
  "timestamp": "2026-03-02T15:00:00Z"
}
```

Field-level failures add an `errors` object keyed by field name. Fields that are `null` are left out
of every response, as the frontend expects.

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | One or more fields are invalid (see `errors`). |
| `MALFORMED_JSON` | 400 | The body is not a JSON object. |
| `CONTACT_REQUIRED` | 400 | Neither email nor phone was supplied. |
| `INVALID_*`, `*_REQUIRED`, `*_TOO_LONG` | 400 | A specific setting or field is out of range (`INVALID_PARTY_SIZE`, `INVALID_GRACE_PERIOD`, `INVALID_LANE_RANGE`, `CROSSING_LANE_RANGES`, `QUEUE_NAME_REQUIRED`, …). |
| `INVALID_RANGE` | 400 | Metrics range other than `TODAY` or `LAST_7_DAYS`. |
| `UNAUTHENTICATED` | 401 | Missing, malformed or expired token. |
| `NOT_A_MEMBER` | 403 | You do not belong to that establishment. |
| `OWNER_ONLY` | 403 | Configuration is restricted to the owner. |
| `QUEUE_NOT_FOUND` / `ENTRY_NOT_FOUND` / `TICKET_NOT_FOUND` / `LANE_NOT_FOUND` / `ESTABLISHMENT_NOT_FOUND` / `USER_NOT_FOUND` | 404 | Unknown resource. |
| `QUEUE_ARCHIVED` | 404 / 409 | The queue was deleted (archived). Customers get 404, so an old QR leads nowhere; staff get 409. |
| `QUEUE_NOT_ACCEPTING` | 409 | Queue is paused or closed. |
| `QUEUE_CLOSED` | 409 | Calling someone, or putting someone back, on a closed or archived queue. |
| `QUEUE_FULL` | 409 | `maxSize` reached. |
| `NO_COMPATIBLE_LANE` | 409 | No active lane accepts that party size. |
| `LANE_FULL` | 409 | The lane that would take the party is at capacity. |
| `LANE_HAS_ACTIVE_ENTRIES` / `LAST_ACTIVE_LANE` / `LANE_NAME_TAKEN` | 409 | A lane change that would strand people, leave no active lane, or repeat a name. |
| `QUEUE_EMPTY` | 409 | Nobody to call. |
| `ENTRY_NOT_ACTIVE` / `ALREADY_WAITING` | 409 | The ticket already left the line / is already waiting. |
| `INVALID_TRANSITION` | 409 | Illegal state change for the entry's current status. |
| `EMAIL_TAKEN` / `ALREADY_A_MEMBER` | 409 | Duplicate. |
| `CONCURRENT_MODIFICATION` | 409 | The queue kept changing while the operation retried. Nothing was written; sending it again is safe. |
| `TOO_MANY_REQUESTS` | 429 | Too many joins from one IP in a minute. |
| `UNHEALTHY` | 503 | `GET /health` could not read back what it wrote. |
| `INTERNAL_ERROR` | 500 | Anything else. Logged in the function's CloudWatch log group. |

API Gateway answers some requests itself, before any function runs, and those do not carry a
`code`: 401 from the Cognito authorizer, and 429 when a route's throttling limit is exceeded.

## Auth

There is no sign-in endpoint. Staff accounts live in a Cognito user pool, and the browser talks to
Cognito directly (`frontend/src/lib/cognito.ts`):

* **sign up** - Cognito `SignUp`. A pre sign-up trigger (`λ cognito-pre-signup`) confirms the
  account on the spot, so there is no verification code. The site then calls
  `POST /establishments` to create the user's first establishment.
* **sign in** - Cognito `InitiateAuth` with `USER_PASSWORD_AUTH`. The id token goes in the
  `Authorization` header of every staff request. Tokens last 12 hours (`session_hours`).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/auth/me` | The account behind the token. |

The pool id and client id the browser needs are in `config.json`, next to the site.

## Establishments

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/establishments` | member | The establishments you belong to. |
| `POST` | `/establishments` | any authenticated | Makes you its `OWNER`. → 201 |
| `GET` | `/establishments/{id}` | member | |
| `PATCH` | `/establishments/{id}` | owner | `name`, `timezone` |
| `GET` | `/establishments/{id}/members` | member | |
| `POST` | `/establishments/{id}/members` | owner | See below. → 201 |
| `GET` | `/establishments/{id}/queues` | member | Archived queues are left out. |
| `POST` | `/establishments/{id}/queues` | owner | Creates the queue with its `1+` lane. → 201 |
| `GET` | `/establishments/{id}/metrics?range=TODAY\|LAST_7_DAYS` | member | |

`POST /members` takes `{ email, role, password?, displayName? }`. Without a password it adds an
existing account (`USER_NOT_FOUND` if there is none). With a password it creates the Cognito account
first; if that email already has an account it answers `EMAIL_TAKEN`, because adding it silently
would give the establishment to whoever registered the address first.

## Queues (staff)

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/queues/{queueId}` | member | Configuration, including `joinUrl`. |
| `PATCH` | `/queues/{queueId}` | owner | Partial update. |
| `DELETE` | `/queues/{queueId}` | owner | Archives it. → 204 |
| `PUT` | `/queues/{queueId}/status` | member | `{ "status": "OPEN" \| "PAUSED" \| "CLOSED" }` |
| `GET` | `/queues/{queueId}/board` | member | The live line with positions and ETAs. |
| `POST` | `/queues/{queueId}/calls` | member | `{}` calls next; `{ "laneId": "..." }` calls next from that lane; `{ "entryId": "..." }` calls that person. |
| `POST` | `/queues/{queueId}/ws-tickets` | member | A one-time ticket to open the board's WebSocket. → 201 `{ ticket, expiresAt }` |
| `GET` | `/queues/{queueId}/events?limit=50` | member | Timeline, newest first. At most 200. |
| `GET` | `/queues/{queueId}/metrics?range=` | member | |

`PATCH /queues/{queueId}` uses explicit clear flags for the three genuinely nullable settings, since
a plain `null` cannot express "unset it":

```json
{ "serviceStations": 3, "clearMaxSize": true, "clearNotifyAtMinutes": true }
```

## Lanes (staff)

A queue keeps one QR code but can be segmented into lanes — party-size bands with their own
priority, capacity and pace. See [domain-model.md](domain-model.md) for the rules.

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/queues/{queueId}/lanes` | member | Lanes in priority order |
| `POST` | `/queues/{queueId}/lanes` | owner | → 201 |
| `PATCH` | `/queues/{queueId}/lanes/{laneId}` | owner | Partial update |
| `DELETE` | `/queues/{queueId}/lanes/{laneId}` | owner | Retires it. → 204 |

A lane carries `name`, a party-size band (`minPartySize`, `maxPartySize`, null meaning open-ended),
`priority` (lower is served first), `capacityMode` (`PERSONS` counts people, `GROUPS` counts
entries), an optional `maxSize`, a `timeFactor` multiplying the queue's average service time, and
`active`. Active bands may be disjoint or nested, never partially overlapping: a joining group goes
to the innermost active band that contains its size.

Queue-level `callStrategy` decides how lanes are drained — `GLOBAL_AGE` (oldest group first,
ignoring lanes), `LANE_PRIORITY` (lowest priority number first, oldest within it) or `ROUND_ROBIN`
(one lane at a time, rotating over every active lane).

## Entries (staff)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/entries/{entryId}` | |
| `PUT` | `/entries/{entryId}/status` | `{ "status": "CALLED" \| "SERVING" \| "SERVED" \| "NO_SHOW" \| "LEFT" \| "WAITING" }` |
| `GET` | `/entries/{entryId}/events` | This customer's timeline. |
| `GET` | `/entries/{entryId}/notifications` | With delivery status. |

`WAITING` means "put them back": undoing a call keeps their place, while bringing back somebody who
had already finished is a new join at the end of the line — through the same lane and capacity
checks, so they may land in a different lane.

## Public - customers

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Writes and reads back an item in the table. What the pipeline's smoke test calls. |
| `GET` | `/public/queues/{queueId}` | The landing page after scanning the QR. |
| `GET` | `/public/queues/{queueId}/availability?partySize=` | Whether a party of that size can join now, and in which lane. |
| `GET` | `/public/queues/{queueId}/qr?size=512` | `image/png`, ready to print. `size` between 128 and 1024. |
| `POST` | `/public/queues/{queueId}/entries` | Join. → 201 + `Location`. Limited per IP (`joins_per_minute`). |
| `GET` | `/public/tickets/{ticketToken}` | Groups scheduled before the ticket, lane context and estimated wait. |
| `DELETE` | `/public/tickets/{ticketToken}` | Leave the queue (recorded as `LEFT`, not deleted). |
| `GET` | `/public/tickets/{ticketToken}/notifications` | |

Join request - a name and **at least one** contact channel. Notifications only go to the email:

```json
{ "name": "Ana Perez", "email": "ana@example.com", "phone": "+5491100000000", "partySize": 2, "locale": "es" }
```

## Realtime: WebSocket

A second API Gateway API, of type WebSocket, pushes changes to whoever is looking at a queue. Its
address is `websocketUrl` in `config.json`. The browser never sends data over it; the credential goes
in the URL, because a browser cannot set headers when opening a WebSocket:

| Who | URL | Receives |
|---|---|---|
| A customer | `wss://…/prod?ticket=<ticketToken>` | `ticket.updated`, same payload as `GET /public/tickets/{token}` |
| Staff | `wss://…/prod?wsTicket=<ticket>` | `queue.updated`, same payload as `GET /queues/{queueId}/board` |

The staff ticket comes from `POST /queues/{queueId}/ws-tickets`: it can be used once and expires in
a minute, so the Cognito token never appears in a URL or an access log.

Every message is `{ "type": ..., "data": ... }`. A board too large for one frame (over 120 KB) is
sent as `{ "type": "queue.changed" }` instead, and the browser fetches it over REST.

Connecting does not push the current state: the page loads it over REST first, because a WebSocket
cannot report a status code (a missing ticket has to show as "this ticket does not exist").

API Gateway closes a connection after 10 idle minutes and after 2 hours in any case. The site sends
`{ "action": "ping" }` every 5 minutes (answered by API Gateway without a Lambda) and reconnects with
backoff, reloading over REST on every reconnection.

```js
const socket = new WebSocket(`${websocketUrl}?ticket=${encodeURIComponent(ticketToken)}`)
socket.onmessage = (e) => {
  const message = JSON.parse(e.data)
  if (message.type === 'ticket.updated') setTicket(message.data)
}
```
