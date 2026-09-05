# Deploying Queue by hand

Written for a manual deployment: no Terraform, no CloudFormation, no container registry. Everything
here is done from the AWS console and an SSH session.

## The one thing that cannot stay manual

An Auto Scaling Group launches instances on its own, at 9pm on a Friday, with nobody watching. Those
instances have to come up already serving. So the manual work is done **once**, on a single instance,
and then frozen into an AMI that the group launches from:

```
build the jar  ->  one instance by hand  ->  verify it  ->  bake an AMI  ->  launch template  ->  ASG
```

Redeploying a new version means repeating that: update the golden instance, bake a new AMI, point the
launch template at it, and let the group replace the old instances.

## Order of operations

Each step needs the one before it, so this order avoids going back:

1. **Network** - VPC, the six subnets, Internet Gateway, NAT, route tables, VPC Endpoint for S3
2. **Security Groups** - `sg-alb`, `sg-app`, `sg-rds`, chained (below)
3. **RDS** - PostgreSQL, Multi-AZ, in the isolated subnets, `Publicly accessible: No`
4. **The golden instance** - one EC2, by hand
5. **The AMI**
6. **Target group and ALB**
7. **Launch template and ASG**
8. **Frontend** - S3 and CloudFront
9. **Back to the app** - `PUBLIC_BASE_URL` and `CORS_ORIGINS` only exist once CloudFront does, so the
   AMI has to be rebaked. Plan for baking it twice.

### Security groups

Chain them by group id, never by CIDR. That is what makes the isolation demonstrable.

| Group | Inbound | From |
|---|---|---|
| `sg-alb` | 80, 443 | `0.0.0.0/0` |
| `sg-app` | 8080 | **`sg-alb`** |
| `sg-rds` | 5432 | **`sg-app`** |

## Build the artifacts locally

```bash
cd backend && mvn clean package
```

```bash
cd frontend && NEXT_PUBLIC_API_URL=https://<alb-dns>/api/v1 npm run build
```

`backend/target/queue-api-0.1.0-SNAPSHOT.jar` and `frontend/out/` are everything that gets deployed.

## The golden instance

Launch one EC2 (Amazon Linux 2023, `t3.small`) into `app-a`, with `sg-app`. It needs the NAT to reach
the internet for packages. Reach it through the bastion.

```bash
sudo dnf install -y java-25-amazon-corretto-headless
```

> If that package is not in the repo yet, take the Corretto 25 tarball from
> <https://docs.aws.amazon.com/corretto/> and unpack it into `/opt/java`. The application needs Java 25.

```bash
sudo useradd --system --no-create-home --shell /sbin/nologin queue && sudo mkdir -p /opt/queue /etc/queue
```

Copy the jar up with `scp`, then:

```bash
sudo mv queue-api-0.1.0-SNAPSHOT.jar /opt/queue/queue-api.jar && sudo chown -R queue:queue /opt/queue
```

### Configuration

Everything the application needs comes from `/etc/queue/queue.env`. The application reads that path
itself - `spring.config.import` in `application.yml` lists it, so the values are picked up whether or
not systemd also passes them in. It is the same file as the `.env` used locally, with production
values; `backend/.env.example` is the annotated template.

Write `/etc/queue/queue.env`:

```
PORT=8080

DB_URL=jdbc:postgresql://<rds-endpoint>:5432/qdb
DB_USER=<user>
DB_PASSWORD=<password>
DB_POOL_SIZE=10

JWT_SECRET=<openssl rand -base64 48>

PUBLIC_BASE_URL=https://<cloudfront-domain>
CORS_ORIGINS=https://<cloudfront-domain>

REALTIME_ENABLED=true

NOTIFY_EMAIL_ENABLED=true
NOTIFY_EMAIL_FROM=<your gmail address>
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_AUTH=true
MAIL_STARTTLS=true
MAIL_USERNAME=<your gmail address>
MAIL_PASSWORD=<16-character app password>
```

```bash
sudo chown root:queue /etc/queue/queue.env && sudo chmod 640 /etc/queue/queue.env
```

Three things worth getting right rather than discovering later:

* **Do not set `SPRING_PROFILES_ACTIVE=dev.** The `dev` profile seeds a demo establishment with
  accounts whose passwords are in the README.
* **`JWT_SECRET` has a development default.** Leaving it produces tokens anyone holding this
  repository can forge. Minimum 32 bytes.
* **`PUBLIC_BASE_URL` is printed onto posters.** QR codes and ticket links are built from it, so a
  wrong value survives in the physical world after you fix it.

### The service

`/etc/systemd/system/queue.service`:

```
[Unit]
Description=Queue API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=queue
EnvironmentFile=/etc/queue/queue.env
ExecStart=/usr/bin/java -jar /opt/queue/queue-api.jar
Restart=always
RestartSec=5
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now queue
```

`enable` is the part that matters for the AMI: it is what makes an instance the group launches come up
serving without anyone logging in.

```bash
curl -s localhost:8080/actuator/health/readiness && sudo journalctl -u queue -n 40 --no-pager
```

Two lines in the log confirm the cross-instance channel is alive:

```
Listening for queue changes on 'queue_changed' as instance <uuid>
Queue-change channel open
```

## Bake the AMI

With the service verified: **Actions -> Image and templates -> Create image**. Leave the instance
running; the snapshot is consistent enough for a stateless application.

The RDS endpoint and every credential are baked into the image. Rebuilding the database means
rebaking the AMI.

## Target group and load balancer

Target group, HTTP, port 8080, and the health check is the setting that matters most:

| | |
|---|---|
| Path | **`/actuator/health/readiness`** |
| Healthy / unhealthy threshold | 2 / 3 |
| Timeout / interval | 5s / 15s |
| **Deregistration delay** | **120s** |

`/actuator/health/readiness` deliberately does not check the database - see the health check section
in the README. Pointing this at `/actuator/health` instead will take healthy instances out of service
whenever the connection pool is busy.

The deregistration delay matters because SSE connections are long-lived: scaling in cuts them, and 120s
is long enough for requests in flight without making every scale-in wait.

Then an internet-facing ALB across `public-a` and `public-b`, with `sg-alb`, forwarding to the group.

## Launch template and Auto Scaling Group

Launch template: the AMI just baked, `t3.small`, `sg-app`, no user data - systemd already handles it.
Enable **detailed CloudWatch monitoring**; the 5-minute default makes scaling take about fifteen
minutes to react.

| | |
|---|---|
| Subnets | `app-a`, `app-b` |
| Min / desired / max | **2 / 2 / 8** |
| Health check type | **ELB** |
| Health check grace period | **120s** |
| Scaling policy | Target tracking on **`ASGAverageNetworkOut`** |

Two numbers deserve an explanation, because both come from a limit rather than a preference:

* **Min 2** puts one instance in each AZ, which is what makes the Multi-AZ design real rather than
  drawn.
* **Max 8** is a database limit, not a budget one: each instance takes `DB_POOL_SIZE` pooled
  connections plus one long-lived LISTEN session. Keep `max x (pool + 1)` under about 80% of the
  instance's `max_connections` - roughly 110 on a `db.t3.micro`, so `8 x 11 = 88`. **Raising the max
  without raising the database instance will exhaust its connections.**

`ASGAverageNetworkOut` is a proxy: outbound traffic grows with the number of open streams, because each
takes a heartbeat every 20s and an update on every movement of its queue. Calibrate the target by
opening a known number of streams, confirming it with `q.sse.connections` (see the README), and reading
the bytes per instance off the group's monitoring.

## Frontend

Upload `frontend/out/` to a bucket, put CloudFront in front of it, and add the two rewrites the static
export needs - `/q/*` and `/t/*` both serve their own `index.html`, because the id in the URL cannot be
known at build time. Details are in the README.

Then go back and rebake: `PUBLIC_BASE_URL` and `CORS_ORIGINS` need the CloudFront domain.

## Verifying the deployment

Run all six. The first four prove it works; the last two are what the assignment asks you to
demonstrate.

**1. Both instances are serving.** Target group shows two healthy targets.

**2. The application answers.** Open the CloudFront URL, sign in, create a queue.

**3. A customer can join.** Scan the QR, join, and land on the ticket page.

**4. Live updates cross instances.** The one worth rehearsing, because it is the only test that a
single instance cannot pass. Join a queue and keep the ticket stream open, then call the next customer
from the staff panel in a different browser - the ALB will usually put the two on different instances.
The ticket must move on its own. To prove which instance served which, run it against the instances
directly from the bastion, as in the README.

**5. The database rejects the internet.** From your own laptop:

```bash
psql "postgresql://<user>@<rds-endpoint>:5432/qdb"
```

It must hang and time out - no route from the internet, and `sg-rds` only accepts `sg-app`. A refusal
is not the same as a timeout: a timeout is the stronger demonstration, because it means the packets
never arrived.

**6. The application subnet has no way in either.** SSH straight to an app instance's private address
from outside must fail; only the bastion can reach it.

## Deploying a new version

```bash
cd backend && mvn clean package
```

Copy the jar to the golden instance, `sudo systemctl restart queue`, verify, bake a new AMI, point the
launch template at the new version, and use **Instance refresh** on the ASG to roll the group over.

Every instance runs Flyway at startup. That is safe with several starting at once - Flyway takes a lock
and the rest find the migrations already applied - but it does mean a bad migration fails the whole
group's boot, so test migrations before baking.
