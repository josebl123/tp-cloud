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
docs/             domain model, API reference, frontend notes
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

75 tests: unit tests for the estimation and ordering logic, the SSE connection counter and the
cross-instance notification payload, plus integration tests that run the whole API against a real
PostgreSQL through Testcontainers (Docker must be running). The tests drive
a controllable clock, so grace periods and token expiry are asserted directly rather than by
sleeping.

## Configuration

Everything is overridable by environment variable; defaults suit local development.

Values also come from a **`.env`** file, read natively through `spring.config.import` - no library and
no `export`. Copy `backend/.env.example` to `backend/.env` and fill it in; the file is gitignored, and
`/etc/queue/queue.env` is read the same way on a deployed instance. It is properties syntax, not shell:
no `export`, no quotes. Both imports are optional, so tests and CI still run on the defaults below.

| Property | Env | Default | Purpose |
|---|---|---|---|
| `q.public-base-url` | `PUBLIC_BASE_URL` | `http://localhost:3000` | SPA base. QR codes and ticket links are built on it. |
| `q.cors-allowed-origins` | `CORS_ORIGINS` | `http://localhost:3000` | |
| `q.jwt.secret` | `JWT_SECRET` | dev value | **Must be overridden outside local dev.** Minimum 32 bytes. |
| `q.jwt.ttl` | | `12h` | Access-token lifetime. |
| `q.estimation.service-time-samples` | | `10` | Recent services averaged into the ETA. |
| `q.grace.sweep-interval` | | `10s` | How often expired grace periods are swept. |
| `q.sse.timeout` / `q.sse.heartbeat-interval` | | `30m` / `20s` | |
| `q.realtime.enabled` | `REALTIME_ENABLED` | `true` | Cross-instance fan-out over LISTEN/NOTIFY. Off only for a single instance. |
| `q.notifications.email.enabled` | `NOTIFY_EMAIL_ENABLED` | `false` (`true` in `dev`) | When off, notifications go to the logging transport. |
| `spring.mail.*` | `MAIL_HOST` `MAIL_PORT` `MAIL_USERNAME` `MAIL_PASSWORD` `MAIL_AUTH` `MAIL_STARTTLS` | Mailpit on `localhost:1025`, no auth | A real provider needs all six. Gmail: `smtp.gmail.com`, `587`, auth and STARTTLS on, and a 16-character App Password rather than the account password. |
| `spring.datasource.url` | `DB_URL` | `jdbc:postgresql://localhost:55432/qdb` | |
| `spring.datasource.hikari.maximum-pool-size` | `DB_POOL_SIZE` | `10` | Sized against the database, not against traffic: keep (largest ASG size x this) under ~80% of the instance's `max_connections`. |

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
* **The database is the message broker.** Live updates cross instances over LISTEN/NOTIFY rather than
  through a queue or cache service, which keeps the moving parts to the ones already in the design.

See [docs/domain-model.md](docs/domain-model.md) for the state machine and the rules,
[docs/api-reference.md](docs/api-reference.md) for the endpoints, and
[docs/deployment.md](docs/deployment.md) for the step-by-step manual deployment to AWS.

## Toward the cloud deployment

The application is stateless, and the one piece of per-instance state - the SSE emitters in
`realtime/SseHub`, which live in the JVM holding the connection - is reconciled across instances
through the database.

### Live updates across instances

An instance can only push to the customers the load balancer put on it, so with more than one node a
customer would never hear about a change made on another. `QueueChangeNotifier` and
`QueueChangeListener` close that over **PostgreSQL LISTEN/NOTIFY**, using the database everyone
already shares rather than adding a broker:

| | |
|---|---|
| **Announce** | `QueueChangeNotifier` runs `pg_notify` **before commit**, on the transaction's own connection. PostgreSQL holds the notification until that transaction commits and drops it if it rolls back, so the announcement is exactly as atomic as the change - and costs no extra round trip. Identical payloads within one transaction are collapsed by PostgreSQL itself. |
| **Listen** | `QueueChangeListener` holds one session open running `LISTEN`, and pushes what it hears to its own emitters. That session is opened **outside HikariCP** - a connection held for the life of the process would take one of the pool's ten permanently - so budget one extra connection per instance. |
| **Skip your own** | The payload carries the `InstanceId` that produced it. The origin has already pushed at commit without waiting for the round trip, so it ignores the echo. Local subscribers therefore keep being served even while the listener is disconnected: a failover degrades the fan-out to single-instance behaviour instead of stopping it. |
| **Reconnect** | The loop reopens the session whenever it drops, because an RDS Multi-AZ failover takes it with it. |

Set `REALTIME_ENABLED=false` only when running a single instance.

Two seams were left deliberately swappable:

* `NotificationSender` - today SMTP and a logger; SES/SNS/a WhatsApp provider drop in behind it
  without touching any business logic.
* `GraceSweepJob` - correct today under multiple replicas because of the per-queue lock, but a
  leader election or a scheduled cloud trigger would avoid the duplicated work.

### Health checks

Point the load balancer's health check at **`/actuator/health/readiness`**, never at
`/actuator/health`.

The readiness group is configured to check only that the application has finished starting. It
deliberately leaves the database out: `/actuator/health` asks the datasource for a connection, so an
exhausted pool - a burst on one busy queue is enough - would fail the check and cost a perfectly
healthy instance its place in the target group. Its SSE connections would then reconnect onto the
remaining instances, exhaust *their* pools, and the Auto Scaling Group would work its way through the
whole group replacing instances that were never broken.

Failing readiness on a database problem would not help either: every instance shares one RDS, so
there is nowhere healthier to send the traffic.

`/actuator/health` still aggregates everything, database included. It is the right endpoint for a
human and for CloudWatch alarms - just not for the load balancer.

Two ASG settings matter alongside it: a **health check grace period** of ~120s, because Spring Boot
plus Flyway take well over a minute to boot, and a **deregistration delay** short enough that
scaling in does not sit waiting on 30-minute SSE streams.

### Knowing how loaded an instance is

Virtual threads let one instance hold thousands of open SSE streams at almost no CPU cost, so CPU
utilisation stays flat while memory, sockets and file descriptors climb. The number that actually
describes the load is how many streams the instance is holding, and `SseHub` counts it:

```bash
curl -s localhost:8080/actuator/metrics/q.sse.connections -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s "localhost:8080/actuator/metrics/q.sse.connections?tag=audience:ticket" -H "Authorization: Bearer $TOKEN"
```

The endpoint needs a staff token: `SecurityConfig` leaves only `/actuator/health` and `/actuator/info`
public.

The Auto Scaling Group scales on `ASGAverageNetworkOut`, a predefined metric that rises with the
number of open streams because each one takes a heartbeat every 20s and an update on every movement
of its queue. Turning that into a byte target means knowing how many connections produced those
bytes: open a known number of streams, read this gauge to confirm it, and read the bytes per instance
off the group's monitoring. Enable **detailed (1-minute) monitoring** while doing it - the 5-minute
default makes a target-tracking policy take about fifteen minutes to react, which is no use against a
lunch rush.

Network traffic is only a proxy: an instance holding 500 streams on a queue that is not moving sends
very little. Publishing this gauge directly would be the honest signal, and the counter is already
here for whenever that becomes available.

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
