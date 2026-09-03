# Deploying Q on AWS

CloudFormation template for the Segunda Entrega. One stack, 48 resources, roughly 20–25 minutes to
create — most of it waiting on RDS and CloudFront. The Multi-AZ database accounts for several of
those minutes, since two instances are provisioned and synchronised before the stack completes.

> **Cost.** About **$0.18/hour** while the stack exists. The two largest lines are the NAT Gateway
> ($0.045/hr, billed whether used or not) and the Multi-AZ database ($0.042/hr for the pair). A
> four-hour lab session costs ~$0.70; left running for two weeks it eats the entire $50 budget.
> **Delete the stack when you finish.**

## What it builds

| Tier | Contents |
|---|---|
| Public subnets (2 AZs) | Application Load Balancer, NAT Gateway |
| Private app subnets (2 AZs) | Auto Scaling Group of EC2 instances running the API |
| Private database subnets (2 AZs) | RDS PostgreSQL, Multi-AZ — **route table has no path to the internet** |
| Edge | CloudFront: S3 origin for the SPA, ALB origin for `/api/*` |

Written for the **AWS Academy Learner Lab**: it creates no IAM roles and reuses the provided
`LabInstanceProfile`, because that environment does not allow creating them.

---

## 1. Build the artifacts

```bash
cd backend && mvn -DskipTests package
```

```bash
cd frontend && NEXT_PUBLIC_API_URL= npm run build
```

The empty `NEXT_PUBLIC_API_URL` is deliberate and important: it makes every API call **relative**, so
the browser sends them to the same CloudFront origin serving the page. That is what removes CORS and
mixed-content from the picture entirely. Verify with `grep -r localhost:8080 frontend/out/` — it
should find nothing.

## 2. Write the secrets file

Everything secret lives in one object in the private bucket, never in the template:

```bash
cat > /tmp/app.env <<'EOF'
DB_PASSWORD=<the same value you give the stack as DbPassword>
JWT_SECRET=<at least 32 characters, identical across instances>
NOTIFY_EMAIL_ENABLED=false
EOF
```

The database password appears twice — once as a stack parameter, because CloudFormation is what
creates RDS, and once here, because the application reads it at boot. That duplication is the price
of keeping it out of the launch template.

## 3. Create the stack

Console → **CloudFormation → Create stack → Upload a template file** → `q-stack.yaml`.

| Parameter | Value |
|---|---|
| `AmiId` | Amazon Linux 2023, x86_64. Find it under EC2 → Launch instance → Amazon Linux 2023 |
| `DbPassword` | 12+ characters, matching `/tmp/app.env` |
| `InstanceType` | `t3.small` |
| `EnableScheduledScaling` | Leave `false` unless you want to demonstrate the peak-hour schedule |

## 4. Upload artifacts while it builds

The buckets exist within about a minute, long before RDS does. **Instances poll for these files for
15 minutes after boot**, so uploading during stack creation is fine and expected.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3 cp backend/target/queue-api-0.1.0-SNAPSHOT.jar s3://q-artifacts-$ACCOUNT-us-east-1/queue-api.jar
aws s3 cp /tmp/app.env s3://q-artifacts-$ACCOUNT-us-east-1/app.env
aws s3 sync frontend/out/ s3://q-web-$ACCOUNT-us-east-1/ --delete
```

(Bucket names are deterministic: `q-artifacts-<account>-<region>` and `q-web-<account>-<region>`.)

## 5. Verify

Take `ApplicationUrl` from the stack **Outputs** tab and open it. Then:

```bash
curl -sI https://<distribution>.cloudfront.net/api/v1/actuator/health | grep -i x-instance-id
```

Run it a few times — the instance id should alternate between the two instances. That is the load
balancer distributing, shown rather than asserted.

There is deliberately **no SSH path into the private subnets** — no bastion, no key pair, nothing
listening on port 22 anywhere in the stack. That is the right security posture, and it means that if
instances never become healthy you cannot read `/var/log/q-bootstrap.log` to find out why. Until
CloudWatch is added, the recovery is to delete the stack and redeploy.

If you need visibility before then, three lines at the end of the launch template's user-data will
copy that log to the artifacts bucket, where you can read it from the S3 console:

```bash
aws s3 cp /var/log/q-bootstrap.log s3://<artifacts-bucket>/logs/$IID.log
```

---

## The demonstration

### The database is unreachable from the internet

```bash
psql -h <DatabaseEndpoint> -U qadmin -d qdb
```

It hangs and times out. Two independent things cause that, and it is worth naming both:

1. **Routing.** The database subnets' route table has no `0.0.0.0/0` entry at all. There is no path
   off the VPC — not a closed door, no door.
2. **RDS itself.** `PubliclyAccessible: false`, so even if a route existed it would not answer on a
   public address.

The positive half of the proof is the application working at all: it reaches the database from the
private subnets, through a security group rule that names the application's own security group as the
only permitted source. Show the rule in the console alongside the timeout.

### Live updates across instances

Open a customer ticket page on your phone. On a laptop, sign into the staff panel and call the next
customer. The phone updates immediately — even though the two requests were almost certainly handled
by **different EC2 instances**. That works because a queue change is published on a PostgreSQL
channel with `NOTIFY`, and every instance is `LISTEN`ing.

To make the point concrete, check `X-Instance-Id` on both sessions and show they differ.

---

## Teardown

```bash
aws s3 rm s3://q-web-$ACCOUNT-us-east-1/ --recursive
aws s3 rm s3://q-artifacts-$ACCOUNT-us-east-1/ --recursive
```

**Empty both buckets first.** CloudFormation cannot delete a bucket that still has objects in it, and
the stack deletion will fail partway with the NAT Gateway still running and still billing.

Then delete the stack from the console, or:

```bash
aws cloudformation delete-stack --stack-name q
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Stack fails immediately on `AmiId` | The parameter type is validated up front — that AMI does not exist in this region |
| Targets never healthy | Usually the artifacts were never uploaded, or the AMI is wrong. With no SSH path you cannot read the boot log — redeploy, or add the S3 log copy described above |
| `502` from CloudFront | The application is not yet up; the target group health check has to pass first |
| `404` on `/q/<id>` | The CloudFront function did not publish. It rewrites clean URLs onto the exported files |
| Stack delete stuck on a bucket | See Teardown — empty them first |
| RDS fails on `DbEngineVersion` | That PostgreSQL version is not offered in this region; pick another |
