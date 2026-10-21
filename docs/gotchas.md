# Things that will bite you

Practical notes for whoever touches this next — including us, three weeks from now. Reasoning lives
in [architecture.md](architecture.md); the deployment procedure in [deployment.md](deployment.md);
this is the short, unglamorous list.

---

## 1. Before you walk away from the lab

> **Destroy from the pipeline, then stop the lab.** Add the `destroy` label to the pull request and
> approve the `aws-lab` environment. The Destroy job runs `terraform destroy`, then empties and
> deletes the three buckets, which Terraform does not own (see §3), and last the state bucket, once
> the state is empty.

Then check the job's log: it should end with `Destroy complete!` and one `Vaciando y borrando:` line
per bucket, four in all. A failed destroy is not a destroy.

**Deleted Cognito pools linger in Tag Editor.** After a clean destroy, the tags API still lists one
user pool per past deployment. They are gone: `aws cognito-idp list-user-pools` returns nothing, and
`describe-user-pool` answers `ResourceNotFoundException`. Not a leftover, and nothing to delete.

Idle, the deployment costs close to nothing — there is no server, no NAT and no database instance —
but the S3 objects, the DynamoDB tables and the CloudWatch logs stay until destroyed.

**Anything left from the TP2 is not Terraform's.** The CloudFormation stack, RDS, the load balancer,
the Auto Scaling Group and the NAT Gateway of the previous delivery have to be deleted by hand, and
they do bill while they exist.

---

## 2. The pipeline

**The lab's credentials expire with every session** (about four hours). Before running anything,
copy them from AWS Details in the lab into the three repository secrets: `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. An expired token fails the plan job at its first AWS call, with
`The security token included in the request is invalid`. Pasting the secret key into the access key
id is easy to do: the access key id has no `/`.

**A pending apply blocks the destroy.** Apply and Destroy share the `terraform-state` concurrency
group. An apply waiting for approval holds the group, so a destroy queued behind it waits too —
forever, if nobody approves. Approve or cancel the pending apply first.

**Every push to the pull request plans and asks to apply** — documentation-only pushes included, and
such a plan is not empty. The Next.js build ID is random, so every build changes about 75 site
objects and the 404 page embedded in the REST API, which replaces its deployment; the WebSocket API's
deployment is replaced on every plan too. Leave the apply unapproved if you do not want it, and cancel
it before a destroy (previous point).

**With the lab stopped, the plan job goes red** on the expired credentials. Expected, and harmless:
no apply is queued.

**Destroy runs with `-refresh=false`.** Refreshing a bucket makes the provider read its object lock
configuration, which the lab denies (§3). Destroying without a refresh assumes nothing
outside the pipeline changed these resources. It does not detect drift; inspect residual resources
and failures before considering cleanup complete.

**`scripts/buckets.sh` needs Bash with `mapfile` (Bash 4+).** The runner has it; macOS's `/bin/bash` 3.2 does
not.

**Two warnings that are not ours.** `terraform validate` prints `hash_key is deprecated`: it comes
from the external DynamoDB module, which still uses the attribute. actionlint exits 1 on two SC2015
infos in the smoke test; the pipeline does not run actionlint.

---

## 3. What the Learner Lab does not allow

| Limit | What it changed |
|---|---|
| An SCP denies `s3:GetBucketObjectLockConfiguration` | The AWS provider reads it right after creating any `aws_s3_bucket`, and fails on the denial in every version tried (v4.67, v5.100, v6.67). So the pipeline creates the buckets with the CLI before the apply (`scripts/buckets.sh`), with the names from the saved plan, and Terraform configures everything else on them. It is the only bucket read denied, out of 16 tried |
| No IAM roles or OIDC providers can be created | Functions and API Gateway integrations use `LabRole`; the pipeline uses the supplied lab session credentials. That is also why the credentials are session keys in secrets and not a role GitHub assumes |
| CloudFront is blocked | API Gateway serves the site from the private bucket, on the same origin as the API |
| SES is denied | Neither the lab's user role nor `LabRole` can verify an address or send (explicit deny on `ses:SendEmail`, `ses:CreateEmailIdentity`, `ses:VerifyEmailIdentity`). Customer emails go through Gmail's SMTP server instead (`SMTP_SENDER_EMAIL` and `GMAIL_APP_PASSWORD`, see [deployment.md](deployment.md)); without a configured sender/password value, the notifier writes each email to its log. Setting `SES_SENDER_EMAIL` or `SES_VERIFIED_RECIPIENTS` makes the apply fail |
| Lambda concurrency is limited | API Gateway throttles before Lambda does (429 instead of a 5xx), and each SQS consumer has its own ceiling (`consumer_max_concurrency`), which limits consumer pressure but does not reserve account concurrency for the API or live push |

---

## 4. Running it locally

**Tests need Docker running.** The integration tests start DynamoDB Local with Testcontainers. If
Docker Desktop is not running they fail at setup, which looks like a code break and is not:
start Docker Desktop (or the Docker daemon for the environment), then run them again.
`open -a Docker` is a macOS-specific command.

**One test is flaky, about 1 run in 30:** "tres a la vez" in `races.test.ts`. It is not the
optimistic lock - two writes on the same version cannot both commit. If it fails again, the reason is
in the error itself: DynamoDB lists the cancellation reasons in the message
(`[None, ConditionalCheckFailed]`), and the API logs `CancellationReasons`.

**The frontend has no local API.** `npm run dev` proxies to the deployed site, so the lab has to be
up and `DEV_API_URL` set in `frontend/.env.local`. An old `.env.local` with
`NEXT_PUBLIC_API_URL=http://localhost:8080` sends every call to a server that no longer exists:
delete that line.

---

## 5. Git

**The repository is public.** Never commit a real secret, and there should be none to commit:
Cognito, IAM and the lab's role cover everything but the Gmail app password, which lives only in the
`GMAIL_APP_PASSWORD` repository secret and in Secrets Manager. The lab's credentials live only in the
repository secrets. `app.env` (the TP2's manual configuration, with passwords in plain text) is in `.gitignore`
for anyone who still has a copy. `git` history is permanent, so a mistake means rewriting history
*and* rotating the credential.

**Port 22 is blocked on some networks here.** If `git push` hangs or reports
`Permission denied (publickey)` after the keys are loaded, route over 443:

```bash
git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push origin entrega-3
```

If the agent has no identities: `ssh-add --apple-load-keychain`.

---

## 6. Code that looks wrong but isn't

Each of these is a deliberate decision that a well-meaning cleanup would break.

| Looks like | Actually |
|---|---|
| Positions are computed on every read | A stored position can disagree with the line. The waiting list sorted by order key *is* the line |
| Order keys are strings, not numbers | There is always a string between two strings, so putting someone between two neighbours never renumbers the line — which in DynamoDB would mean rewriting every waiting item |
| An entry's sort key changes when its status does (`W#`, `A#`, `F#`) | One query by prefix returns each group already ordered, and the finished ones by end time, which is all the metrics read. The `ENTRY#…/REF` item tracks the current key |
| Events are items in the same transaction as the change | So an event exists if and only if the change committed. Publishing after the write instead would lose events on a crash between the two, or announce changes that rolled back |
| `commit` only recognises `ConditionalCheckFailed` at position 0 | Position 0 is the queue's version. Retrying on a failed condition anywhere else would also retry the condition that protects against duplicate order keys |
| Closing a queue releases people in batches of 24 | Each release writes four items and a transaction takes 100. Thirty did not fit |
| The notifier ignores what the event says | It decides from the current state: one movement can make dozens cross a threshold, and deciding from state makes duplicates and out-of-order events harmless |
| Notification keys include a `cycle` | Without it, a customer called, missed, requeued and called again would never get the second "it's your turn" |
| Grace expiry runs in several places | On a delayed SQS message so a queue nobody is watching still moves, and on every read and write so nobody sees a call the clock invalidated. The queue's version makes the first one win |
| The broadcaster rereads the queue instead of applying the event | A duplicate, late or out-of-order event can cause one push too many, never a wrong screen. Events for the same queue that arrive together cost one read and one push per connection |
| A board can arrive as `queue.changed`, with no data | A WebSocket message is limited to 128 KB. A very long queue's board does not fit, so the browser fetches it over REST |
| Staff open the WebSocket with a ticket, not their token | A browser cannot set headers on a WebSocket, so the credential goes in the URL. The ticket is single-use and expires in a minute; the Cognito token never reaches a URL or a log |
| The connections index is eventually consistent | REST provides the initial view, but a connection absent from the eventually consistent index can miss a later push; another push, reload or reconnection is needed to reconcile |
| Every page is uploaded three times to the site bucket | `login/index.html`, `login/` and `login`: API Gateway's S3 integration requests the key exactly as it arrives in the URL and does not add `index.html` |
| The 404 page is wrapped in `#[[ … ]]#` | API Gateway runs the template through Velocity, and Next's HTML has `$` and `#` in it |
| JSON bodies are decoded from base64 | `binary_media_types` is `*/*` so fonts and images arrive intact, and that makes API Gateway hand every body over in base64 |
| Terraform creates the SMTP secret but never its value | A value set through Terraform would be included in the saved plan artifact and in state; `sensitive` alone would not remove it. Access depends on repository/artifact permissions. The Apply job writes it with the CLI instead |
| The SMTP secret has `recovery_window_in_days = 0` | With the default 30 days, a destroyed secret keeps its name reserved and the next apply fails creating it. The cátedra destroys and applies again |
| The notifier simulates when the SMTP secret is empty, but fails on a wrong password | The secret is empty between the apply and the step that fills it, and the smoke test may send in between. A wrong password is a misconfiguration: failing makes the notification retry and end in the DLQ, with its alarm |
| The functions are two `for_each` maps, not one | The REST API depends on the functions it serves, and some workers need the API's URL. In one map, everything would depend on everything |
| The site and WebSocket URLs are built from the API ids, not the stages | The stage depends on the deployment, the deployment on the integrations, the integrations on the functions. The id has no cycle |
| The stream mapping starts at `TRIM_HORIZON`, not `LATEST` | A new mapping takes minutes to start reading. With `LATEST`, whatever is written meanwhile is lost — in a deployment from scratch, the demo seed and the whole smoke test. Re-reading at creation is harmless: the consumers decide from the current state |
| The stream mapping has a filter | Only new event items invoke `stream-publisher`. Every other write to `q-main` is discarded before invoking anything, so it costs no concurrency |
| The round robin visits lanes that are empty | Deliberately. The cursor is a persisted index; rotating only over occupied lanes makes it mean something different on every call and starves the lane it exists to protect |
| Lane bands may nest | Disjoint or nested, never partially overlapping. A group goes to the innermost band that fits, the most specific rule for its size |
| A retired lane is still in the table | Its entries still point to it, and it keeps which band each finished customer was served in |
| `DELETE /queues/{id}` does not delete | It archives — closed, hidden from listings, entries and events kept. Destroying a queue would destroy the history its metrics are computed from |
| `trailingSlash: true`, and `/q` and `/t` are single shell pages | A static export cannot pre-render unknown ids. Each shell reads its id from the **query string** (`/q/?id=…`, `/t/?token=…`), because the site has no rewrite rules. Changing this breaks every printed QR code |
| English is the source of truth for i18n | `MessageKey` derives from the English bundle and Spanish is typed as a complete record of it — a missing translation is a build error, not something a user finds |
| `Button` sets `aria-disabled` while loading, not `disabled` | The native attribute blurs the focused element mid-action, dropping a keyboard operator to `<body>` and back to the top of the document — and it makes the `aria-busy` beside it unreachable, since disabled controls are skipped. The busy state keeps focus and swallows its own activation instead |
| `ConfirmDialog`'s effect does not depend on `onCancel` | Every call site passes a fresh inline arrow, so depending on it re-ran the effect on any parent render. A live update arriving while the dialog was open dragged focus off Cancel onto the destructive confirm button. The callback lives in a ref; the effect is keyed on `open` alone |
| There is no `focus:outline-none` on the shared input class | There was, and Tailwind utilities sit in a **later cascade layer** than `@layer base`, so it beat the global `:focus-visible` rule outright and left every input with no focus ring. Specificity is not the issue — the layer decides |
| Grid children carry `min-w-0` that looks redundant | Grid items default to `min-width: auto` and cannot shrink below their content's min-content width. One unshrinkable staff row measured 390px and forced the whole document to 441px, so the board scrolled sideways on every phone — in Spanish first, which runs ~20% longer |
| The join page polls but the ticket page gets pushes | The ticket is one connection per waiting customer, which is worth it. The join page is one per *undecided visitor*, which is not — and its numbers change on the scale of minutes. It polls only while the tab is visible |
| `subscribeToToken` has subscribers | It was exported with none, so a 401 ended nothing and signing out was tab-local. `api.ts` drops the token on a 401 to any non-public path, and a `storage` listener carries it to the other tabs |
| Queue names and descriptions are never translated | That is the business's own data, shown as they typed it |

---

## 7. Where the reasoning lives

| Question | Document |
|---|---|
| Why is it built this way? | [architecture.md](architecture.md), with the decision log; the original design in [arquitectura-serverless.md](historial/arquitectura-serverless.md) |
| What are the domain rules? | [domain-model.md](domain-model.md) |
| What does the API do? | [api-reference.md](api-reference.md) |
| How does the frontend work? | [frontend.md](frontend.md) |
| How do I deploy it? | [deployment.md](deployment.md) |
| What did the TP2 do? | [../tp2/](../tp2/) |
