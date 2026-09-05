# Q (Queue) - REST API

Base path `/api/v1`. Interactive docs at `/swagger-ui.html` while the app runs.

Two audiences share one API:

* **`/api/v1/public/**`** - anonymous customers. No token. Authorised by the opaque ticket token in
  the path.
* **everything else** - staff. `Authorization: Bearer <jwt>`.

## Errors

Every failure is RFC 7807 `application/problem+json` with a stable machine-readable `code`:

```json
{
  "type": "https://q.itba.ar/problems/queue-full",
  "title": "Conflict",
  "status": 409,
  "detail": "This queue has reached its maximum size",
  "instance": "/api/v1/public/queues/.../entries",
  "code": "QUEUE_FULL",
  "timestamp": "2026-03-02T15:00:00Z"
}
```

Field-level failures add an `errors` object keyed by field name.

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | One or more fields are invalid (see `errors`). |
| `CONTACT_REQUIRED` | 400 | Neither email nor phone was supplied. |
| `PARTY_SIZE_REQUIRED` | 400 | The queue requires a party size. |
| `UNAUTHENTICATED` | 401 | Missing, malformed or expired token. |
| `BAD_CREDENTIALS` | 401 | Wrong email or password. |
| `NOT_A_MEMBER` | 403 | You do not belong to that establishment. |
| `OWNER_ONLY` | 403 | Configuration is restricted to the owner. |
| `QUEUE_NOT_FOUND` / `ENTRY_NOT_FOUND` / `TICKET_NOT_FOUND` | 404 | Unknown resource. |
| `QUEUE_NOT_ACCEPTING` | 409 | Queue is paused or closed. |
| `QUEUE_FULL` | 409 | `maxSize` reached. |
| `QUEUE_EMPTY` | 409 | Nobody to call. |
| `ENTRY_NOT_ACTIVE` | 409 | The ticket already left the line. |
| `INVALID_TRANSITION` | 409 | Illegal state change for the entry's current status. |
| `EMAIL_TAKEN` / `ALREADY_A_MEMBER` | 409 | Duplicate. |

## Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | Creates account + establishment + `OWNER` membership. → 201 |
| `POST` | `/auth/login` | → `{ accessToken, tokenType, expiresInSeconds, user, establishment }` |
| `GET` | `/auth/me` | The account behind the token. |

## Establishments

| Method | Path | Role |
|---|---|---|
| `GET` | `/establishments` | member |
| `POST` | `/establishments` | any authenticated |
| `GET` | `/establishments/{id}` | member |
| `PATCH` | `/establishments/{id}` | owner |
| `GET` | `/establishments/{id}/members` | member |
| `POST` | `/establishments/{id}/members` | owner |
| `GET` | `/establishments/{id}/queues` | member |
| `POST` | `/establishments/{id}/queues` | owner |
| `GET` | `/establishments/{id}/metrics?range=TODAY\|LAST_7_DAYS` | member |

## Queues (staff)

| Method | Path | Role | Notes |
|---|---|---|---|
| `GET` | `/queues/{queueId}` | member | Configuration, including `joinUrl`. |
| `PATCH` | `/queues/{queueId}` | owner | Partial update. |
| `DELETE` | `/queues/{queueId}` | owner | → 204 |
| `PUT` | `/queues/{queueId}/status` | member | `{ "status": "OPEN" \| "PAUSED" \| "CLOSED" }` |
| `GET` | `/queues/{queueId}/board` | member | The live line with positions and ETAs. |
| `POST` | `/queues/{queueId}/calls` | member | `{}` calls next; `{ "entryId": "..." }` calls that person. |
| `GET` | `/queues/{queueId}/events?limit=50` | member | Timeline, newest first. |
| `GET` | `/queues/{queueId}/metrics?range=` | member | |
| `GET` | `/queues/{queueId}/stream` | member | SSE. See below. |

`PATCH /queues/{queueId}` uses explicit clear flags for the three genuinely nullable settings, since
a plain `null` cannot express "unset it":

```json
{ "serviceStations": 3, "clearMaxSize": true, "clearNotifyAtMinutes": true }
```

## Entries (staff)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/entries/{entryId}` | |
| `PUT` | `/entries/{entryId}/status` | `{ "status": "CALLED" \| "SERVING" \| "SERVED" \| "NO_SHOW" \| "LEFT" \| "WAITING" }` |
| `GET` | `/entries/{entryId}/events` | This customer's timeline. |
| `GET` | `/entries/{entryId}/notifications` | With delivery status. |

`WAITING` means "put them back": undoing a call keeps their place, while bringing back somebody who
had already left sends them to the end.

## Public - customers

| Method | Path | Notes |
|---|---|---|
| `GET` | `/public/queues/{queueId}` | The landing page after scanning the QR. |
| `GET` | `/public/queues/{queueId}/qr?size=512` | `image/png`, ready to print. |
| `POST` | `/public/queues/{queueId}/entries` | Join. → 201 + `Location` |
| `GET` | `/public/tickets/{ticketToken}` | Policy-aware groups scheduled before the ticket, lane context and estimated wait. |
| `DELETE` | `/public/tickets/{ticketToken}` | Leave the queue (recorded as `LEFT`, not deleted). |
| `GET` | `/public/tickets/{ticketToken}/notifications` | |
| `GET` | `/public/tickets/{ticketToken}/stream` | SSE. |

Join request - a name and **at least one** contact channel:

```json
{ "name": "Ana Perez", "email": "ana@example.com", "phone": "+5491100000000", "partySize": 2 }
```

## Server-Sent Events

| Stream | Event name | Payload |
|---|---|---|
| `GET /queues/{queueId}/stream` | `queue.updated` | Same as `GET /queues/{queueId}/board` |
| `GET /public/tickets/{token}/stream` | `ticket.updated` | Same as `GET /public/tickets/{token}` |

Both push the current state immediately on connect, so a client never needs a separate first fetch.
Updates are emitted after the change commits.

The browser `EventSource` API cannot set an `Authorization` header, so the staff stream also accepts
`?access_token=<jwt>`. The trade-off is that tokens can end up in access logs; if that matters in
your deployment, put the SPA behind a proxy that moves the token into a cookie.

```js
const es = new EventSource(`${API}/api/v1/queues/${queueId}/stream?access_token=${token}`)
es.addEventListener('queue.updated', e => setBoard(JSON.parse(e.data)))
```
