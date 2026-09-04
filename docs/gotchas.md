# Things that will bite you

Practical notes for whoever touches this next — including us, three weeks from now. Reasoning lives
in [architecture.md](architecture.md); this is the short, unglamorous list.

---

## 1. Before you walk away from AWS

> **Empty both S3 buckets before deleting the stack.**
> CloudFormation cannot delete a bucket that still contains objects. The delete fails *partway*, and
> what survives is usually the NAT Gateway — still running, still billing at $0.045/hour, with the
> stack in `DELETE_FAILED` and nobody watching.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3 rm s3://q-web-$ACCOUNT-us-east-1/ --recursive
aws s3 rm s3://q-artifacts-$ACCOUNT-us-east-1/ --recursive
aws cloudformation delete-stack --stack-name q
```

Then confirm the stack reaches `DELETE_COMPLETE`. A failed delete is not a delete.

**Cost while the stack exists: ~$0.18/hour**, or about $4.20/day.

| | |
|---|---|
| One 4-hour lab session | $0.70 |
| Left running a week | $30 |
| Left running two weeks | **$59 — more than the whole budget** |

Two lines dominate: the NAT Gateway ($0.045/hr, billed whether anything uses it or not) and the
Multi-AZ database pair ($0.042/hr). Neither cares whether you are using the stack.

---

## 2. Deploying

**Build the frontend with an empty API base.** This is easy to miss and breaks the deployment
subtly rather than loudly:

```bash
cd frontend && NEXT_PUBLIC_API_URL= npm run build
```

Empty means API calls are **relative**, so the browser sends them to the same CloudFront origin that
served the page. That is what removes CORS and mixed-content entirely. Check with
`grep -r localhost:8080 frontend/out/` — it must find nothing. If it finds something, the deployed
app will try to call your laptop.

**Upload artifacts during stack creation, not after.** Instances poll S3 for the jar and `app.env`
for 15 minutes after boot. The buckets exist about a minute in; RDS takes ten. Uploading while it
builds is the intended flow.

**The database password goes in two places.** Once as the `DbPassword` stack parameter, because
CloudFormation is what creates RDS; once in `app.env`, because the application reads it at boot.
They must match, and nothing checks that they do.

**Two parameters commonly fail on first deploy:**

| Parameter | Failure |
|---|---|
| `AmiId` | Region-specific and rotates. Get the current Amazon Linux 2023 id from EC2 → Launch instance |
| `DbEngineVersion` | Defaults to `16.4`; if that is not offered in the region, RDS creation fails |

**There is no way into the instances.** No bastion, no key pair, nothing listening on port 22
anywhere in the stack. That is the correct security posture, and the cost is that a failed deployment
is opaque: `/var/log/q-bootstrap.log` sits on a machine you cannot reach. Until CloudWatch is added,
recovery is delete-and-redeploy — or three lines of user-data copying that log to the artifacts
bucket. Deliberate MVP simplification, not an oversight.

**`LabInstanceProfile` is Learner Lab specific.** The template references it rather than creating an
IAM role, because AWS Academy does not permit creating one. In a normal account, create a role with
S3 read access and swap the name.

---

## 3. Running it locally

**PostgreSQL is on port 55432, not 5432.** There is already a PostgreSQL installed on this machine
holding 5432, and it silently answers instead — producing a confusing `role "q" does not exist`
rather than a connection refused.

```bash
docker compose up -d
cd backend && mvn spring-boot:run -Dspring-boot.run.profiles=dev
cd frontend && npm run dev
```

* App <http://localhost:3000> · API <http://localhost:8080> · Mailpit <http://localhost:8025>
* Sign in as `owner@demo.q` / `demo1234`

**The `dev` seeder is idempotent** — it does nothing if the demo owner already exists. To get fresh
demo data you must truncate first:

```bash
docker exec q-postgres psql -U q -d qdb -c "TRUNCATE TABLE notification_record, queue_event, queue_entry, service_queue, membership, establishment, user_account RESTART IDENTITY CASCADE;"
```

**Tests need Docker running.** The integration tests use Testcontainers against a real PostgreSQL,
deliberately — the pessimistic locks, the CHECK constraints and the Flyway migration are precisely
the parts an in-memory database would fake.

**Rebuild the jar after backend changes before running it standalone.** `mvn test` does not repackage;
more than once the running jar has been an older build than the source.

---

## 4. Git

**The repository is public.** Never commit a real secret. The build already keeps them out — the
config in the jar contains only `${DB_URL}`-style placeholders — but `git` history is permanent, so a
mistake means rewriting history *and* rotating the credential.

**Port 22 is blocked on some networks here.** If `git push` hangs or reports
`Permission denied (publickey)` after the keys are loaded, route over 443:

```bash
git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push origin main
```

If the agent has no identities: `ssh-add --apple-load-keychain`.

---

## 5. Code that looks wrong but isn't

Each of these is a deliberate decision that a well-meaning cleanup would break.

| Looks like | Actually |
|---|---|
| The PostgreSQL driver is `compile` scope, not `runtime` | The realtime transport uses `PGConnection` and `PGNotification` directly. Moving it back to `runtime` breaks the build |
| The mail health indicator is disabled | Left on, an unreachable SMTP server reports the whole instance `DOWN` and lets the load balancer deregister a healthy fleet. It also contradicts the rule that a failed notification never undoes a queue movement |
| The Auto Scaling Group uses **EC2** health checks, not ELB | The target group's check includes the database. If it drove replacement, a database outage would terminate every instance and their replacements would fail identically — an endless loop instead of a recoverable blip |
| The database NACL allows **all** egress | The database route table has no path off the VPC, so there is nowhere to go. Tightening it risks interfering with the managed service's own traffic, and a too-narrow stateless rule shows up as a connection that opens and then hangs |
| The notification listener does almost nothing | On purpose. Its thread must keep reading the database connection; doing the refresh there serialised every queue on the instance behind every other, and one customer on a bad connection could block `SseEmitter.send` and stall them all. Work belongs on `BroadcastCoordinator`'s virtual threads |
| The broadcast payload carries no `revision` or version | It does not need one. `BroadcastCoordinator` keeps at most one refresh per queue in flight, so an older view cannot be published after a newer one. Remove that serialisation and you *do* need a counter — pick one, not both |
| `readBroadcast` looks like it does too much in one method | It deliberately assembles the whole fan-out in one pass. Rebuilding each subscriber's view independently made database load grow with the number of people watching — 12 watchers cost 66 statements instead of 19. Splitting it back up reintroduces that |
| Positions are computed on every read | A stored position can disagree with the line. The `WAITING` list sorted by order key *is* the line |
| Notification uniqueness includes a `cycle` column | Without it, a customer called, missed, requeued and called again would never get the second "it's your turn" |
| Grace expiry runs in two places | Lazily on read so a client never sees a call the clock invalidated, and on a timer so a queue nobody is watching still moves |
| `q.realtime.mode` is `LOCAL` in tests | Production uses PostgreSQL LISTEN/NOTIFY. Tests use the in-JVM path so assertions stay deterministic — the transport has its own tests |
| SSE responses set `X-Accel-Buffering: no` | An event stream is a response deliberately never finished, which is exactly what a CDN or load balancer likes to buffer. Two proxies sit in front of this |
| Shutdown closes SSE streams *before* the graceful wait | So a terminating instance releases clients immediately instead of holding them for the full 25 seconds |
| JWT expiry is validated against an injected `Clock` | One notion of time across the whole application, and token lifetime becomes testable by advancing a clock rather than sleeping |
| `trailingSlash: true`, and `/q` and `/t` are single shell pages | A static export cannot pre-render unknown ids. Each shell reads its id from the address bar; CloudFront rewrites the path. Changing this breaks every printed QR code |
| English is the source of truth for i18n | `MessageKey` derives from the English bundle and Spanish is typed as a complete record of it — a missing translation is a build error, not something a user finds |
| Queue names and descriptions are never translated | That is the business's own data, shown as they typed it |

---

## 6. Where the reasoning lives

| Question | Document |
|---|---|
| Why is it built this way? | [architecture.md](architecture.md) — includes a 16-entry decision log with the rejected alternatives |
| What are the domain rules? | [domain-model.md](domain-model.md) |
| What does the API do? | [api-reference.md](api-reference.md) |
| How does the frontend work? | [frontend.md](frontend.md) |
| How do I deploy it? | [../infra/README.md](../infra/README.md) |
