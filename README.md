# Q (Queue)

Cloud queue-management platform for restaurants, shops and any other counter where people wait.
A customer scans a QR code, joins the line with minimal data, and follows their turn from their own
phone instead of standing in it. Staff run the line from a panel.

ITBA 82.08 Cloud Computing - TP, Grupo 9. This repository implements the MVP of *Funcionalidades 1-5*
of the "Queue" proposal.

**Status: backend and frontend both complete.** The SPA talks to the API over REST and Server-Sent Events.

## MVP coverage

| Proposal | Where it lives |
|---|---|
| **1. Acceso e ingreso mediante QR** | `GET /public/queues/{id}/qr` renders the code; `POST /public/queues/{id}/entries` joins with a name plus one contact channel. |
| **2. Seguimiento de la espera** | `GET /public/tickets/{token}` and its SSE stream: position, people ahead, estimated wait, recomputed on every movement. |
| **3. Notificaciones del turno** | Configurable proximity thresholds (by position and by minutes), the "it's your turn" alert, and an audited notification history. |
| **4. Gestion de la fila por el comercio** | Staff board, call / serve / no-show / cancel, pause and resume, and queue + establishment metrics. |
| **5. Abandono y periodo de gracia** | `DELETE /public/tickets/{token}` frees the place; a configurable grace period plus four no-show policies decide what happens to someone who does not show up. |
| **Idiomas** | English and Spanish, following the browser. The locale is stored with the entry, so notification emails arrive in the same language as the page the customer joined from. |

## Stack

**Backend** — Java 25 (LTS) · Spring Boot 3.5 · Spring Security (JWT) · Spring Data JPA ·
PostgreSQL 16 · Flyway · springdoc/OpenAPI · Testcontainers.

**Frontend** — Next.js 16 (App Router, static export) · React 19 · TypeScript · Tailwind CSS 4.
No component library and no data-fetching library: the API client, the live-resource hook and the
design system are all first-party and small.

## Layout

```
backend/          Spring Boot REST API
  src/main/java/ar/edu/itba/cloud/queue/
    persistence/  entities + repositories   - the only layer that knows about the database
    service/      business rules            - the only layer that touches entities
    controller/   HTTP                      - translates requests into service calls
    security/     JWT issuing and resolution
    realtime/     Server-Sent Events fan-out
    config/       properties, security, OpenAPI, clock
    exception/    RFC 7807 problem responses
frontend/         Next.js SPA, exported as static files
  src/app/        routes (see below)
  src/components/ design-system primitives
  src/lib/        API client, auth, live-resource hook, formatters
docs/             architecture, domain model, API reference, frontend notes
docker-compose.yml  PostgreSQL + Mailpit for local development
```

### Routes

| Route | Who | What |
|---|---|---|
| `/q/{queueId}` | customer | What the QR opens: the queue's live state, then the join form. |
| `/t/{ticketToken}` | customer | Their own place in line, pushed live. |
| `/` `/login` `/register` | staff | Landing and sign-in. |
| `/panel` | staff | Today's numbers and every queue at a glance. |
| `/panel/queue?id=` | staff | The live board: call, serve, no-show, pause, close. |
| `/panel/queue/settings?id=` | owner | Waits, grace period, no-show policy, notification thresholds. |
| `/panel/queue/qr?id=` | staff | The QR sheet, laid out for printing. |

The two customer URLs stay clean because they get printed on a poster and sent in a message.
Staff URLs carry their ids in the query string, which keeps the hosting configuration to two rules
(see Deploying below).

The layering is strict in both directions: JPA entities never leave the service layer, and the
service layer never sees an HTTP type. Requests are mapped into `service.command` records;
responses are the immutable read models in `service.model`.

## Running it

```bash
docker compose up -d
```

```bash
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

```bash
cd frontend && npm install && npm run dev
```

* App - <http://localhost:3000>
* API - <http://localhost:8080/api/v1>
* Swagger UI - <http://localhost:8080/swagger-ui.html>
* Mailpit (catches every notification email) - <http://localhost:8025>

> PostgreSQL is published on **55432**, not 5432, so it does not collide with a locally installed
> PostgreSQL. Change it in `docker-compose.yml` and `DB_URL` if you prefer.

The `dev` profile seeds a demo establishment with two queues and three customers waiting:

| Account | Password | Role |
|---|---|---|
| `owner@demo.q` | `demo1234` | OWNER |
| `staff@demo.q` | `demo1234` | STAFF |

### Try it end to end

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"owner@demo.q","password":"demo1234"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
```

```bash
curl -s localhost:8080/api/v1/establishments -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## Tests

```bash
cd backend && mvn test
```

58 tests: unit tests for the estimation and ordering logic, plus integration tests that run the
whole API against a real PostgreSQL through Testcontainers (Docker must be running). The tests drive
a controllable clock, so grace periods and token expiry are asserted directly rather than by
sleeping.

## Configuration

Everything is overridable by environment variable; defaults suit local development.

| Property | Env | Default | Purpose |
|---|---|---|---|
| `q.public-base-url` | `PUBLIC_BASE_URL` | `http://localhost:3000` | SPA base. QR codes and ticket links are built on it. |
| `q.cors-allowed-origins` | `CORS_ORIGINS` | `http://localhost:3000` | |
| `q.jwt.secret` | `JWT_SECRET` | dev value | **Must be overridden outside local dev.** Minimum 32 bytes. |
| `q.jwt.ttl` | | `12h` | Access-token lifetime. |
| `q.estimation.service-time-samples` | | `10` | Recent services averaged into the ETA. |
| `q.grace.sweep-interval` | | `10s` | How often expired grace periods are swept. |
| `q.sse.timeout` / `q.sse.heartbeat-interval` | | `30m` / `20s` | |
| `q.notifications.email.enabled` | `NOTIFY_EMAIL_ENABLED` | `false` (`true` in `dev`) | When off, notifications go to the logging transport. |
| `spring.datasource.url` | `DB_URL` | `jdbc:postgresql://localhost:55432/qdb` | |

### Running the `prod` profile

`--spring.profiles.active=prod` makes the settings below **mandatory** — it will not start without
them, on purpose.

| Variable | Purpose |
|---|---|
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | RDS endpoint and credentials |
| `JWT_SECRET` | At least 32 bytes, and **identical on every instance** or tokens issued by one are rejected by another |
| `PUBLIC_BASE_URL` | The CloudFront domain. QR codes and ticket links are built on it, so it must be an address a customer's phone can reach — never an internal load balancer name |
| `INSTANCE_ID` | Written into every log line and returned as `X-Instance-Id`. Set from EC2 instance metadata at boot |
| `NOTIFY_EMAIL_ENABLED` | `false` by default; notifications fall back to the logging transport |

Health endpoints for a load balancer target group: **`/actuator/health/readiness`** (includes the
database) and `/actuator/health/liveness` (process only).

## Design notes worth knowing

* **Positions are derived, never stored.** The `WAITING` list sorted by a sparse order key *is* the
  line, so a shown position can never disagree with reality.
* **One lock per queue.** Every mutation takes a pessimistic write lock on the queue row, which is
  what stops two staff members from calling the same person.
* **Notifications are sent after commit** and de-duplicated by `(entry, type, pass through the
  line)`, so a threshold alert fires once per pass however much the queue moves.
* **Grace expiry is evaluated both lazily and by a background sweep**, so state is never stale on
  read and a queue nobody is watching still moves.
* **One clock.** Time is read through an injected `Clock` everywhere, including JWT validation.

## Documentation

| Document | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | **Start here.** System architecture, request lifecycles, the concurrency and ordering models, security, cloud deployment, and a decision log with the alternatives that were rejected |
| [docs/domain-model.md](docs/domain-model.md) | Entities, the entry state machine, grace policies, estimation and metrics definitions |
| [docs/api-reference.md](docs/api-reference.md) | Every endpoint, error code and payload, plus the SSE contract |
| [docs/frontend.md](docs/frontend.md) | Frontend implementation notes and the design language |
| [docs/gotchas.md](docs/gotchas.md) | **Read before deploying or deleting anything.** Teardown traps, cost, local setup, and the decisions a cleanup would break |
| [infra/README.md](infra/README.md) | Deployment runbook for AWS, and the demonstration script |
| [infra/q-stack.yaml](infra/q-stack.yaml) | CloudFormation template — the whole environment, 50 resources |
| [infra/q-architecture.drawio](infra/q-architecture.drawio) | Architecture diagram, editable in draw.io, official AWS icons |

## Toward the cloud deployment

The API is stateless and runs behind a load balancer as several instances. The one piece of
per-instance state - the open SSE connections - is handled by **PostgreSQL LISTEN/NOTIFY**: a queue
change is announced on a database channel, every instance hears it, and each pushes to whichever of
its own connections care. No message broker, no extra service, and because PostgreSQL withholds a
notification until the transaction commits, nothing is ever announced that did not stick.

Two seams were left deliberately swappable:

* `NotificationSender` - today SMTP and a logger; SES/SNS/a WhatsApp provider drop in behind it
  without touching any business logic.
* `GraceSweepJob` - correct today under multiple replicas because of the per-queue lock, but a
  leader election or a scheduled cloud trigger would avoid the duplicated work.

## Deploying the frontend

`npm run build` writes `out/` — plain static files, no server, no idle compute. Upload it to S3
behind CloudFront (or Amplify, or any static host) and add **two rewrites**, because the two public
URLs carry an id the export cannot know in advance:

| Request | Serves |
|---|---|
| `/q/*` | `/q/index.html` |
| `/t/*` | `/t/index.html` |

Each shell reads its id from the address bar at runtime. `next dev` gets the same behaviour through
the rewrites in `next.config.ts`, so development and production agree.

Set `NEXT_PUBLIC_API_URL` at build time, and point the backend's `PUBLIC_BASE_URL` at the deployed
SPA so QR codes and ticket links resolve.

## Next

Deployment itself: the S3/CloudFront distribution for the SPA, and a container for the API.
