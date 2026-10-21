# Q — session handoff

Everything a new session or a teammate needs to continue without re-deriving it. Written
2026-10-17, on branch `entrega-3`, at the end of Phase 6 of [ROADMAP.md](ROADMAP.md).

> **Historical snapshot from 2026-10-17.** Current operator instructions are in
> [deployment.md](../deployment.md), the [Terraform README](../../infra/terraform/README.md), and the
> current delivery checklist in [ROADMAP.md](ROADMAP.md#fase-7--entrega). Counts and deployment
> results below describe the session at that date, not the current PR state.
>
> Read [gotchas.md](../gotchas.md) before deploying or deleting anything on AWS. This document is the
> map; that one is the minefield.

---

## 1. What this is

**Q (Queue)** — a cloud queue-management platform. A customer scans a QR code, joins a line with
minimal data, and follows their turn from their own phone instead of standing in it. Staff run the
line from a panel.

**ITBA 82.08 Cloud Computing — Trabajo Práctico, Grupo 9.** Nicolás Koron · José María Benegas Lynch ·
Agustín Galán · Nicolás Bellavitis Alzate.

**Repository:** `github.com/josebl123/tp-cloud`. **It is public** — never commit a secret. The work
is on `entrega-3`, with pull request #1 (`entrega-3 → main`) open as the place the pipeline runs. It
is not meant to be merged before the correction.

### The deliverables

| Entrega | What it asks | State |
|---|---|---|
| **1 — Propuesta** | Pick and justify an idea | Done. Idea 1, "Queue" |
| **2 — Diseño y Demo de Arquitectura Fundacional** | A design document and a live demo in the lab | Done. Spring Boot on EC2 behind a load balancer, RDS, CloudFormation. Kept in [`tp2/`](../../tp2/) and in git history |
| **3 — Terraform** | Implement the architecture with Terraform, deployed from a GitHub Actions pipeline that runs on the pull request, with the TP2's corrections | In progress: Phases 1–5 deployed, Phase 6 done in the repository, Phase 7 pending |

The rubric and how each point is met are in [ROADMAP.md](ROADMAP.md#cómo-se-evalúa). 40 % is that
it deploys and works, 30 % is modules. **The cátedra has to be able to run it in their own lab
account** with nothing but the README: no hard-coded account values, no manual steps, everything
destroyable.

### MVP scope

The proposal's five *funcionalidades*, all implemented: QR access and joining; live wait tracking;
turn notifications; queue management by staff; leaving and the grace period. Plus Spanish/English
throughout, and queue lanes by party size.

---

## 2. Where things stand

| Phase | State |
|---|---|
| 1 · Walking skeleton: Terraform and pipeline | Deployed by the pipeline, smoke test green |
| 2 · Domain and persistence in DynamoDB | Deployed |
| 3 · Synchronous API and Cognito | Deployed |
| 4 · Event bus | Deployed |
| 5 · Consumers and realtime | Deployed |
| 6 · Retire the old system | Done in the repository: Java backend, compose file and SSE removed, TP2 files moved, docs rewritten. The lab-side cleanup is pending (§9) |
| 7 · Delivery | Pending: `infra/terraform/README.md`, a README per module, the updated diagram, a dry run by someone who did not write the Terraform, the PR to the cátedra's repository |

[AVANCE-ENTREGA-3.md](AVANCE-ENTREGA-3.md) is the detailed log, phase by phase: what was built,
what was decided and why, what was verified.

**The first complete deployment** (Actions run 39081506431) created 200 resources and passed the whole
smoke test, WebSocket included. It was then destroyed from the pipeline, which also deleted the three
buckets.

---

## 3. The stack

| Layer | What |
|---|---|
| Entry | API Gateway REST: the static site from a private S3 bucket and `/api/v1` on the same origin. API Gateway WebSocket for live updates |
| Compute | 9 Lambdas in TypeScript on Node 22: `public`, `staff`, `stream-publisher`, `ws-connections`, `broadcaster`, `notifier`, `lifecycle`, `seed`, `cognito-pre-signup` |
| Data | DynamoDB: `q-main` (single table, Streams, PITR, TTL) and `q-connections` |
| Events | DynamoDB Streams → `stream-publisher` → SNS FIFO → SQS (`push` FIFO, `notifications` filtered, `lifecycle` delayed), each with a DLQ and alarms |
| Identity | Cognito user pool for staff; customers are anonymous, authorised by their ticket token |
| Email | Gmail's SMTP server, with the group's account; its app password in Secrets Manager. SES is denied in the Learner Lab |
| Infrastructure | Terraform 1.16, AWS provider 6.67, one external module (`terraform-aws-modules/dynamodb-table` 5.5.2) and three of our own (`private-bucket`, `lambda-function`, `queue-with-dlq`) |
| Pipeline | GitHub Actions on the pull request: validate, build, plan; apply after approving `aws-lab`; destroy with the `destroy` label |
| Frontend | Next.js 16 static export, React 19, Tailwind 4 |

---

## 4. Repository map

```
functions/          the Lambdas: src/handlers (one per function), domain, persistence, api; test/
infra/terraform/    the deployment: *.tf at the root, modules/, scripts/buckets.sh, seed/demo.json
frontend/           the site
.github/            workflows/terraform.yml, actions/terraform-init, scripts/smoke-realtime.mjs
docs/               this file and the rest of the documentation
tp2/                the TP2 delivery, as delivered
ROADMAP.md          the plan for the Tercera Entrega (Spanish)
AVANCE-ENTREGA-3.md the log of what was done (Spanish)
arquitectura-serverless.md  the serverless design (Spanish)
```

---

## 5. How to run everything

**Deploy** — see [deployment.md](../deployment.md). In short: lab credentials into the three secrets,
push to `entrega-3`, approve the apply, read the URLs in the run summary.

**Tests:**

```bash
cd functions && npm install && npm test
```

132 tests, with Docker running (DynamoDB Local through Testcontainers). `npm run typecheck` and
`npm run build` too; the build writes one bundle per handler to `functions/dist/`.

**Frontend:**

```bash
cd frontend && npm install && npm run typecheck && npm run lint && npm run build
```

`npm run dev` needs a deployed stack: set `DEV_API_URL` in `frontend/.env.local` to the site's URL
(see `.env.example`) and the dev server proxies the API and `config.json` to it.

**Terraform locally**, for `fmt` and `validate` only (deploying is the pipeline's job):

```bash
cd infra/terraform && terraform fmt -check -recursive && terraform init -backend=false && terraform validate && terraform test
```

Each module has its own tests too: `terraform init -backend=false && terraform test` in `infra/terraform/modules/<module>/`. All of them run in plan mode with mocked providers, so they need no AWS credentials.

---

## 6. The architecture, in brief

[architecture.md](../architecture.md) is the full version. The four ideas that hold it together:

* **Every change to a queue is one DynamoDB transaction conditioned on the queue's version.** No
  locks; the loser re-reads and decides again.
* **Events are items in that same transaction.** The stream publishes them, so nothing is announced
  that did not commit, and everything asynchronous — pushes, notifications, the grace timer, releasing
  a closed queue — is a consumer of those events.
* **Consumers re-read state instead of trusting events.** Duplicates and reordering cost at most an
  extra evaluation. The claims reduce duplicate emails but do not make SMTP and DynamoDB atomic;
  see the current limits in [architecture.md](../architecture.md#6-concurrency-and-correctness).
* **The lab's limits shaped the deployment.** No IAM roles (everything uses `LabRole`), no
  CloudFront (API Gateway serves the site), an SCP that keeps Terraform from creating S3 buckets
  (the pipeline creates them), and no SES (emails go through Gmail's SMTP server, the one secret).

---

## 7. Measurements actually taken

| What | Result | Where |
|---|---|---|
| First complete deployment | 200 resources, smoke test green including the WebSocket | Actions run 39081506431 |
| Teardown | 200 resources destroyed, then the three buckets emptied and deleted | Actions run 39083049121 |
| S3 reads the lab's SCP denies | 1 of 16: `GetBucketObjectLockConfiguration` | CloudShell probe, AVANCE |
| Release batch for a closed queue | 24 entries (4 items each + the queue fit in a 100-item transaction; 30 did not) | Phase 2 |
| Test suite | 128 tests, 5 clean runs in a row; one race test failed once in ~29 runs | Phase 1–5 review |
| A documentation-only push | 5 to add, 75 to change, 5 to destroy: the site's objects, and both API deployments | Actions run 39082539689 |

---

## 8. Working conventions

**Commit attribution.** Jose's commits carry **no `Co-Authored-By` trailer and no AI attribution**.
Four earlier commits by Nicolás Koron on `entrega-3` do carry one; they were left as they are, on
purpose. Before pushing, check that the new commits have none:

```bash
git log origin/entrega-3..HEAD --format='%B' | grep -icE "claude|anthropic|co-authored"   # must be 0
```

**Pushing.** Port 22 is blocked from the agent shell on this machine. Use:

```bash
git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push origin entrega-3
```

**Don't push while the lab is up and nobody can approve.** Every push to the PR queues an apply; an
unapproved one blocks the next destroy ([gotchas.md](../gotchas.md) §2).

**Language.** Code comments, commit messages, ROADMAP and AVANCE are in Spanish; the documents in
`docs/` and the README are in English.

**Commit style.** Prose explaining *why*, not bullet lists of what. Include measurements where they
exist. Look at recent history for the register.

**`.claude/` is gitignored** deliberately, so AI tooling config stays out of the repository.

**Tooling notes:** no AWS CLI installed locally — the lab console and CloudShell are the way in, and
the pipeline does everything else. Terraform and Docker are installed.

---

## 9. Open items

**Phase 6, the user's part** (needs the lab up): delete what is left of the TP2 in the lab account
(the stack, RDS, the load balancer, the Auto Scaling Group, the NAT Gateway), delete `app.env` from
the TP2's artifacts bucket, **revoke the Gmail app password** that was in it, and rotate the RDS
password if the database is kept.

**Phase 7** — see the ROADMAP.

**To look at, not fixed:**

1. **The flaky race test** ("tres a la vez" in `races.test.ts`, once in ~29 runs). Not the optimistic
   lock. If it fails in the pipeline, the cancellation reasons are in the error message.
2. **Every build changes the site.** The Next.js build ID is random; pinning it (`generateBuildId`)
   would make a plan with no frontend changes leave the site alone — and the REST API's deployment
   too, since the 404 page is embedded in the API definition. The WebSocket deployment is replaced
   on every plan as well; why is still to be found.
3. **`reasons[0]` in `commit`** only recognises a version conflict at position 0. Correct today, and
   widening it would break the order-key protection ([gotchas.md](../gotchas.md) §6).
4. **No frontend test suite.** Playwright against a deployed stack is the obvious next step.
5. **Nothing reads the lane history that retiring preserves.** A retired lane keeps which band each
   finished customer was served in; no metric uses it yet.

---

## 10. If you are picking this up cold

Read, in order: this file → [gotchas.md](../gotchas.md) → [architecture.md](../architecture.md) §§1–3 for
the shape, then whichever section covers what you are touching. `git log` messages and AVANCE carry
the reasoning for anything recent.

The single most useful thing to know: **almost every non-obvious choice here was measured or argued,
and the argument is written down.** Before changing something that looks odd, check the decision log
in `architecture.md`, the "Ajustes al diseño" table in the ROADMAP, and the "code that looks wrong but
isn't" table in `gotchas.md` — the reason is probably already there.
