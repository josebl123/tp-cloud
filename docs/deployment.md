# Deploying Queue

This is the operator's guide for the Tercera Entrega. Follow it from a branch of the submission
repository. The [main README](../README.md#4-terraform) explains modules, variables,
outputs, functions, meta-arguments and TP2 corrections. The [architecture](architecture.md)
describes the deployed system and its delivery limits. The source of pipeline behavior is
[terraform.yml](../.github/workflows/terraform.yml).

## 1. Prerequisites and repository setup

For a pipeline deployment you need an active AWS Academy Learner Lab session, its three session
credentials, an existing `LabRole`, and permission to configure repository Actions settings and
approve deployments. The runner installs the tools; Docker, Node and Terraform are not required
on the operator's computer. Local development/testing needs Node `>=22.22`, npm and Docker for
DynamoDB Local; local state inspection additionally needs Terraform compatible with the workflow
and authenticated AWS access. The commands below use Bash, from the repository root unless noted.

| Setting | Where | Expected result |
|---|---|---|
| Actions enabled | Repository Settings → Actions | The `Terraform` workflow can run |
| Branch and PR in the same repository | Pull requests | PR secrets are available; a fork PR does not receive them |
| Environment `aws-lab` with required reviewers | Settings → Environments | Apply and Destroy wait for approval. Naming an environment in YAML alone does not configure reviewers |
| Label `destroy` | Issues → Labels | Adding this label can trigger cleanup |
| Secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Settings → Secrets and variables → Actions | All three come from the same active lab session |
| Optional variables `SMTP_SENDER_EMAIL`, `ALERT_EMAIL` | Actions → Variables | Enable Gmail SMTP configuration and an SNS alarm subscription respectively |
| Optional secret `GMAIL_APP_PASSWORD` | Actions → Secrets | Gmail app password, used with `SMTP_SENDER_EMAIL` |

The Terraform state lives in a bucket the pipeline creates the first time
it runs in an account, `tfstate-q-<account>-<region>`, versioned and private, with S3's native
locking. The destroy deletes it last, once the state is empty, and the next apply creates it again.

Leave `SES_SENDER_EMAIL` and `SES_VERIFIED_RECIPIENTS` unset in the lab used by this project: SES
operations were denied there. Those variables support accounts where SES is permitted. Restrictions
can vary by account; see [recorded lab constraints](gotchas.md#3-what-the-learner-lab-does-not-allow).

An email address is a variable; a password or AWS credential is a secret. Simulated customer emails
are supported and permitted by the assignment, so Gmail setup is optional for evaluating the stack.

## 2. Start each lab session

1. Start the lab and open AWS Details → AWS CLI. Obtain all three current session values.
2. In the repository settings, update the three AWS secrets above. If using GitHub CLI, authenticate
   it, enter the repository root and run each command; enter the value when prompted:

   ```bash
   gh secret set AWS_ACCESS_KEY_ID
   gh secret set AWS_SECRET_ACCESS_KEY
   gh secret set AWS_SESSION_TOKEN
   ```

3. Confirm all three secrets were updated for the same account/session. Their values must not be
   committed or pasted into logs. The runner verifies access when configuring credentials.

Expected result: the next Plan job can authenticate. If a previous run failed because credentials
expired, update them and use **Re-run all jobs** while the session is active.

## 3. Deploy from the pull request

1. Open a PR from the delivery branch into the repository's target branch, or push changes to the
   existing PR. The PR can remain open for grading; deploying does not require merging it.
2. In Actions, select the run for the intended commit. Wait for Validar, Compilar and Plan.
3. Read the complete Plan job/artifact and inspect any replacements or deletions. The PR comment
   is updated by later runs and can be truncated; check that it belongs to the intended run.
4. Open **Review deployments**, choose `aws-lab`, and approve Apply only for the intended run.
   This gate works when required reviewers were configured in step 1.
5. Wait for the Apply job, including its smoke test, to finish. Read the `Desplegado` summary:
   it includes the site, health URL and demo queue/user when enabled.

Expected result: Terraform applies the saved plan, the checked endpoints respond and the smoke
test passes. Resource counts vary with optional settings and the existing state; there is no fixed
resource count to use as a pass condition.

### Events, jobs and commands

| Event | Jobs selected by the workflow |
|---|---|
| PR `opened`, `synchronize`, `reopened` | Validate and build independently → plan → apply using `aws-lab` |
| PR label `destroy` added | Destroy using `aws-lab`; no build or plan dependency |
| Another label added | No jobs run |
| Manual `workflow_dispatch: plan` | Validate and build → plan; no apply |
| Manual `workflow_dispatch: apply` | Validate and build → plan → apply using `aws-lab` |
| Manual `workflow_dispatch: destroy` | Validate also runs independently; destroy does not depend on it or on build |

The manual Actions button requires the workflow to be present on the default branch. The PR flow
is the delivery path when this has not happened yet. Pushes outside an open PR are not configured
as a separate workflow trigger.

| Job | Actual work | Needs AWS credentials |
|---|---|---|
| Validar | `terraform fmt -check -recursive -diff`; `init -backend=false`; `validate`; `terraform test` in the root and each module with mocked providers; `tflint --init` and `tflint --recursive --format compact` | No |
| Compilar | `npm ci`, typecheck, build and tests in functions; `npm ci` and static build in frontend | No |
| Plan | Shared initialization action; `terraform plan -input=false -no-color -lock-timeout=10m -out=tfplan`; summary and PR comment | Yes |
| Apply | Shared initialization; create application buckets; `terraform apply -input=false -no-color -lock-timeout=10m tfplan`; set SMTP password if configured; smoke test | Yes |
| Destroy | Placeholder bundles, shared initialization, `terraform destroy -input=false -no-color -lock-timeout=10m -auto-approve -refresh=false`, then application bucket cleanup and state-bucket cleanup if state is empty | Yes |

The shared [terraform-init action](../.github/actions/terraform-init/action.yml) installs Terraform,
loads AWS credentials, bootstraps the state bucket and runs `terraform init` with the account's
bucket and region. Apply uses the saved plan without replanning; variables for it were captured
when that plan was generated.

### Artifacts, state and concurrency

- `build` contains `functions/dist` and `frontend/out`. `tfplan` contains the saved plan, readable
  plan and `.build` Lambda ZIPs. Both have **one-day retention**. Apply needs both artifacts.
- Plan files can contain sensitive values, including the generated demo password. SMTP passwords
  are excluded, but this does not make the entire plan public-safe. Limit artifact access.
- The backend is `s3://tfstate-q-<account>-<region>/queue/terraform.tfstate`, with encryption enabled
  and native S3 locking. The state bucket is private/versioned when bootstrapped. Destroy deletes
  it after verifying the state has no resources; otherwise it is preserved with a warning.
  One backend is shared by runs for the same account/region.
- Apply and Destroy share the `terraform-state` job concurrency group with cancellation of running
  jobs disabled. Do not rely on queue order to choose the right revision. Cancel obsolete pending
  approvals explicitly; a pending apply can block cleanup.
- If artifacts expired, credentials changed account, or another apply changed state after the
  plan, generate a new plan through a fresh run. Do not approve an old run after newer changes.
- A partial apply changes state. Re-running only the failed Apply job can encounter a stale saved
  plan; prefer **Re-run all jobs** or a fresh run to plan against the resulting state.

### Why buckets and the SMTP value use CLI

The lab denied the object-lock read performed by the provider after creating an `aws_s3_bucket`.
The pipeline therefore creates the three application buckets using
[`scripts/buckets.sh`](../terraform/organization/scripts/buckets.sh), with names read from `bucket_names`
in the saved plan. The script records the names in `queue/buckets.txt` in the state bucket before
creation. Terraform manages their access blocks, ownership, versioning, policy, access logs,
expiration and objects. After Terraform destroy, the script empties and deletes those buckets,
including object versions, with the logs bucket last.

Terraform creates an empty Secrets Manager secret when SMTP is enabled. The Apply job then writes
`GMAIL_APP_PASSWORD` with AWS CLI, keeping this value out of the Terraform plan and state. For setup,
set `SMTP_SENDER_EMAIL` to the Gmail address and enter its app password using repository settings or
`gh secret set GMAIL_APP_PASSWORD`. Gmail app passwords require account setup including two-step
verification. See [Google's instructions](https://support.google.com/accounts/answer/185833).

If SMTP has no stored password, the notifier simulates sends. If the repository secret is missing,
the step emits a warning and does not overwrite a previously stored password; an existing valid
Secrets Manager value can therefore still be used. Incorrect passwords cause send failures and
retries. With neither SMTP nor SES sender configured, emails are logged as `emailSimulado`.

For alarm emails, set `ALERT_EMAIL`, deploy and **confirm the SNS subscription** using the email
AWS sends. Without confirmation, the topic does not deliver alarm emails. With no address configured,
CloudWatch alarms still exist but have no email subscriber.

## 4. What is actually verified

| Check | Automatic pass condition or behavior |
|---|---|
| Health | HTTP success from `/api/v1/health` after up to ten attempts; the handler writes/reads DynamoDB |
| Site | Root returns HTML; login URL returns HTTP success; an unknown path returns HTTP 404 with HTML |
| Runtime config | `config.json` has nonempty `userPoolId` and `userPoolClientId` |
| Stream readiness | Waits for `LastProcessingResult` to differ from `No records processed`; after about five minutes it warns and continues. This alone does not assert `OK` |
| Demo, if its output is available | Join returns 201; ticket is WAITING; leaving through the realtime script produces the expected WebSocket push |
| SMTP | The demo join uses the configured SMTP sender as recipient, or a mock address otherwise. The script does not wait for notifier completion or inspect a mailbox |

HTTP, config or demo assertions failing make the job fail. The stream-wait timeout itself is a
warning, not a failed assertion. A successful smoke test is evidence for that exercised path;
it does not establish delivery guarantees for all failures.

### Manual functional acceptance

1. Open the summary's site URL. Register a staff account, or use the demo account described below.
   Expected: the authenticated panel loads.
2. Open the demo queue or create a queue in the panel. Join as a customer using a separate browser
   session and an email address. Expected: a ticket shows WAITING and appears on the staff board.
3. Call and serve that entry from the panel. Expected: the ticket and board reflect the changes;
   record whether updates arrive without reloading.
4. With SMTP configured, check the recipient inbox/spam folder for the ticket and turn emails.
   Record receipt separately from Actions success. With simulation, inspect notifier logs for
   `emailSimulado`; that validates the permitted mock path, not external delivery.
5. If testing alarms, first verify the SNS subscription is confirmed. Record actual alarm/email
   results; merely creating alarms does not test notification delivery.

The [architecture's known limits](architecture.md#6-concurrency-and-correctness) include potential
duplicate emails and swallowed per-connection WebSocket errors. These are not fixed by this guide.

### Outputs and demo credentials

The full list is in [outputs.tf](../terraform/organization/outputs.tf). URLs, table/function names,
Cognito IDs and `stream_mapping_uuid` identify resources in the console. Demo outputs can be null
when `demo_enabled = false`; SMTP outputs can be null when it is not configured.

The demo user defaults to `demo@queue.example`. Its random password persists with the same
`random_password.demo` resource; it is not regenerated on every apply. It is sensitive but stored
in Terraform state and the plan. Registering another staff account avoids needing local Terraform.
To inspect the password, authenticate AWS for the same account and, from the repository root, run:

```bash
terraform -chdir=terraform/organization init -input=false \
  -backend-config="bucket=tfstate-q-<account>-us-east-1" \
  -backend-config="region=us-east-1"
terraform -chdir=terraform/organization output -raw demo_staff_password
```

Replace `<account>` with the actual account ID; use the configured region in both arguments when
it differs. These commands only initialize/read the existing state. Do not paste their sensitive
output into the submission, a screenshot or an issue.

### Defaults and customization

Defaults are demo enabled, simulated emails unless configured, no alarm email subscriber, stage
`prod`, region `us-east-1`, log retention 14 days and staff sessions 12 hours. Every variable/default
is listed in the [main README](../README.md#46-variables-y-outputs).

Local `terraform.tfvars` is ignored and is not loaded by the hosted runner. The workflow passes
the optional email variables and `TF_VAR_api_stage_name` from `API_STAGE` in both plan and destroy.
Change `API_STAGE` to update the frontend build path and Terraform stage together; changing the
Terraform default alone is overridden in CI. The region works the same way: `AWS_REGION` configures
the credentials and reaches Terraform as `TF_VAR_region`. This workflow manages one deployment per account/region, not isolated PR stacks.

## 5. Destroy and deploy again

1. Confirm the configured credentials refer to the intended account and remain active.
2. Cancel obsolete pending applies. Check that another run is not holding `terraform-state`.
3. Add the `destroy` label to the PR and approve the resulting Destroy job in `aws-lab`.
4. Wait for Terraform destroy, `Borrar los buckets` and `Borrar el bucket del estado` to finish. Inspect the log
   for `Destroy complete!` and bucket deletion results; check the three application buckets and
   managed application resources are absent in the account. Check that the state bucket was
   deleted too; a warning that it was preserved requires inspection before declaring cleanup complete.
5. Remove the label, so it can trigger another destroy when added again. To redeploy, start a new
   PR run, for example through **Re-run all jobs** on the intended PR revision, inspect its new
   plan and approve Apply. Re-run the functional checks above.

The Destroy job does not build anything (a compile error must not keep the account from being
cleaned): it writes an empty bundle per function, runs `terraform destroy -refresh=false`, and then
`buckets.sh delete` empties every version from each recorded bucket and deletes it, the logs bucket
last, retrying while late access logs arrive. Last, if `terraform state list` comes back empty, it
empties and deletes the state bucket too, so nothing of Queue is left in the account; if any resource
were still in the state, it keeps the bucket and warns, so that resource is not lost track of. The
job's log ends with `Destroy complete!` and one `Vaciando y borrando:` line per bucket, the state
bucket included.

**What can still show up afterwards.** The tags API (Tag Editor and Resource Groups in the console)
keeps listing Cognito user pools for a while after they are deleted: one per deployment. They no
longer exist (`aws cognito-idp describe-user-pool` answers `ResourceNotFoundException`) and cost
nothing. Anything left from the TP2, or created by hand, is not Terraform's and the destroy cannot
see it.

Destroy uses placeholder bundles because configuration evaluation still needs the source files;
it does not compile the application. `-refresh=false` avoids the denied legacy bucket refresh,
but skips discovery of drift: cleanup assumes resources match the saved state. If external changes
occurred, inspect failures and residual resources rather than treating job success as proof that
the whole account is empty.

Resources from TP2/other stacks are not deleted by this workflow. Record their ownership and any
separate cleanup. A completed state-bucket deletion also removes its historical versions; a new
apply bootstraps a new state bucket. Keep the lab active until cleanup finishes.

## 6. Troubleshooting

| Symptom | Next step |
|---|---|
| Invalid/expired session token | Renew all three AWS secrets from one active session and re-run all jobs |
| Apply/Destroy queued | Inspect other runs and cancel obsolete pending applies sharing the concurrency group |
| Missing/expired artifact or stale plan | Generate a fresh plan/build; do not reuse another run's artifact |
| Apply partially failed | Read the first error, fix credentials/configuration as appropriate, then replan from the resulting state |
| Smoke failed after resources were created | The stack may still exist. Inspect the failing assertion and relevant Lambda logs, then replan or deliberately destroy |
| `GetBucketObjectLockConfiguration` denied | Check for a legacy `aws_s3_bucket` in configuration/state. See [gotchas](gotchas.md) before cleanup; do not remove state entries blindly |
| Site loads but sign-in fails | Inspect `config.json`, Cognito IDs and the configured stage/build path |
| `emailSimulado` in notifier logs | Check sender configuration and whether the Secrets Manager value exists |
| `EAUTH` / invalid SMTP login | Replace the app password secret and run a new apply. Warm workers cache the password; verify subsequent sends after the worker is recycled |
| SES identity creation denied | Unset the two SES variables for this lab and create a new plan |
| SMTP secret scheduled for deletion | Inspect its deletion state and the intended account; follow the lab's secret recovery/cleanup procedure before recreating it |

## 7. Evidence for submission and independent reproduction

The chronological [progress log](historial/AVANCE-ENTREGA-3.md) records earlier deployments, including
[run 39180411198](https://github.com/josebl123/tp-cloud/actions/runs/39180411198) with a successful
WebSocket smoke test and manually observed SMTP receipt. That is historical evidence, not proof
that the current PR head or another account passes today.

Before submission, have a teammate who did not write the Terraform follow this guide in their own
lab account. Record the following without secrets:

| Evidence | Status to fill when performed |
|---|---|
| PR URL and repository required by the course | Pending confirmation |
| Full commit hash, obtained with `git rev-parse HEAD` | Pending final approved commit |
| Successful validate/build/plan/apply run for that revision | Pending current-run verification |
| Account/region and operator of independent rehearsal | Pending independent rehearsal; use an account alias in public evidence |
| Functional checks and SMTP receipt or permitted simulation | Pending rehearsal; distinguish automatic checks from manual observations |
| Destroy and resource/bucket checks | Pending independent rehearsal |
| Second apply and functional checks in that account | Pending independent rehearsal |
| Commit hash submitted in campus | Pending human submission |

Do not mark this checklist complete because the instructions exist. A documentation review does
not run AWS, approve deployments, rotate credentials or submit the campus form.
