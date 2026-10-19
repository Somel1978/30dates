# Installing Thirty Dates on a fresh Debian LXC container

This takes a container with nothing but Debian on it to a running app that starts on boot. Every command is run **as root inside the container** (Proxmox: `pct enter <id>`, or the container's console). Nothing here uses Docker.

There are two finishing paths:

- **A. LAN testing:** open `http://<container-ip>:3000` from your own network. No domain and no email server; sign-in links appear in the API log.
- **B. Public with HTTPS:** a domain name, Caddy for automatic certificates, and real email.

Do steps 1–9 for both, then follow step 10A or 10B.

---

## 0. Create the container (Proxmox)

| Setting | Value |
|---|---|
| Template | `debian-12-standard` (Debian 13 also works) |
| Unprivileged | Yes (default) |
| CPU | 2 cores |
| Memory | **4096 MB** (the web build needs ~2 GB; 2048 MB works if you also give 2048 MB swap) |
| Disk | 16 GB |
| Network | DHCP is fine, but a static IP or DHCP reservation makes `WEB_ORIGIN` stable |

Start it, then open a shell inside it.

## 1. Base system

```bash
apt update && apt full-upgrade -y
apt install -y curl ca-certificates gnupg git openssl locales
```

Minimal LXC templates often have no locale set, which makes PostgreSQL complain. Fix it once:

```bash
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8
export LANG=en_US.UTF-8
```

The app keeps all of its schedules in UTC, so the container's own time zone doesn't matter. The container takes its clock from the Proxmox host, so make sure the **host** keeps accurate time (NTP).

## 2. PostgreSQL 16 + PostGIS + pgvector

Debian's own pgvector package is too old (the schema uses an HNSW index, which needs pgvector ≥ 0.5). Use the official PostgreSQL apt repository instead:

```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-16 postgresql-16-postgis-3 postgresql-16-pgvector
systemctl enable --now postgresql
```

Check it:

```bash
runuser -u postgres -- psql -c "SELECT version();"
```

## 3. Node.js 22

Debian ships an older Node, so use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt install -y nodejs
node -v    # v22.x
```

## 4. Service user and code

The app runs as its own unprivileged user, never as root.

```bash
useradd --system --create-home --home-dir /opt/thirtydates --shell /usr/sbin/nologin thirtydates
```

Clone the repository. It is private, so you need a GitHub **personal access token** with read access to `Somel1978/30dates`. Create one at GitHub → Settings → Developer settings → Fine-grained tokens, with Contents set to read-only.

```bash
runuser -u thirtydates -- git clone --branch claude/clever-hypatia-qyi2q0 \
  https://<YOUR_GITHUB_TOKEN>@github.com/Somel1978/30dates.git /opt/thirtydates/app
# Don't leave the token in the saved remote URL:
runuser -u thirtydates -- git -C /opt/thirtydates/app remote set-url origin https://github.com/Somel1978/30dates.git
```

Once the branch is merged, use `--branch main` instead.

## 5. Database, role and extensions

Generate a password for the app's database role and keep it for step 6:

```bash
DB_PASSWORD=$(openssl rand -hex 24); echo "$DB_PASSWORD"
```

```bash
runuser -u postgres -- psql -c "CREATE ROLE thirtydates_app LOGIN PASSWORD '$DB_PASSWORD';"
runuser -u postgres -- createdb -O thirtydates_app thirtydates
runuser -u postgres -- psql -d thirtydates -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector;"
```

The role is deliberately **not** a superuser. That is what makes the database enforce the blind-escrow privacy rules (row-level security) against the app itself.

## 6. Configuration file

```bash
mkdir -p /etc/thirtydates
cp /opt/thirtydates/app/deploy/thirtydates.env.example /etc/thirtydates/thirtydates.env
chown root:thirtydates /etc/thirtydates/thirtydates.env
chmod 640 /etc/thirtydates/thirtydates.env
```

Fill in the secrets automatically:

```bash
ENV=/etc/thirtydates/thirtydates.env
sed -i "s|CHANGE_ME_DB_PASSWORD|$DB_PASSWORD|" $ENV
for key in JWT_SECRET ESCROW_PAIR_SALT CRON_SECRET; do
  sed -i "s|^$key=CHANGE_ME|$key=$(openssl rand -hex 32)|" $ENV
done
```

Set `WEB_ORIGIN` to the exact address you will type in the browser. For LAN testing that is the container's IP:

```bash
IP=$(hostname -I | awk '{print $1}'); echo "$IP"
sed -i "s|CONTAINER_IP|$IP|" $ENV
grep -E '^(NODE_ENV|WEB_ORIGIN|DATABASE_URL)=' $ENV
```

> `WEB_ORIGIN` must match the browser's address exactly, including `http`/`https` and the port. If it doesn't, sign-in requests are rejected as cross-origin.

**Never change `ESCROW_PAIR_SALT` after members join.** It keys the hashed pair identifiers, so changing it orphans every pending stamp.

## 7. Install dependencies, build, migrate

```bash
cd /opt/thirtydates/app
runuser -u thirtydates -- npm ci --include=dev
runuser -u thirtydates -- npm run build
runuser -u thirtydates -- bash -c 'set -a; . /etc/thirtydates/thirtydates.env; set +a; npm run db:migrate'
```

You should see `applied 001_init.sql`. The build takes a few minutes. If it gets killed, the container needs more memory or swap (see step 0).

## 8. systemd services

Three services: the API, the scheduler (the Monday 07:00 deal, the Sunday 06:00 reveal and maintenance) and the web app.

```bash
cp /opt/thirtydates/app/deploy/systemd/thirtydates-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now thirtydates-api thirtydates-worker thirtydates-web
systemctl status thirtydates-api thirtydates-worker thirtydates-web --no-pager
```

Check them:

```bash
curl -s http://127.0.0.1:4000/healthz          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/signin   # 200
journalctl -u thirtydates-worker -n 20 --no-pager   # "worker started" with next run times
```

## 9. Optional: demo data

This creates 30 demo members, three partner venues and an onboarded account for your email, with this week's cards dealt and three of them already having stamped you:

```bash
cd /opt/thirtydates/app
runuser -u thirtydates -- bash -c 'set -a; . /etc/thirtydates/thirtydates.env; set +a; npm run seed:demo -w @thirtydates/api -- you@example.com'
```

Only do this on a test container; the seed refuses to run when `NODE_ENV=production`. If you seed before Monday 07:00 UTC, your cards stay hidden until then; that is the weekly ritual working as designed.

---

## 10A. LAN testing (no domain, no email)

You're done. From a computer on the same network, open:

```
http://<container-ip>:3000
```

Enter your email. No email is sent; the sign-in link is printed in the API log:

```bash
journalctl -u thirtydates-api -n 50 --no-pager | grep -o 'http[^"]*auth/verify?token=[^"\\ ]*'
```

Open that link in the same browser. If the container runs a firewall, allow port 3000 from your LAN only. The API (port 4000) listens on localhost and is not reachable from outside.

## 10B. Public with HTTPS

You need a domain (say `dates.example.com`) whose DNS A record points at your public IP. Forward ports **80 and 443** from your router to the container.

**1. Install Caddy.** It fetches and renews certificates automatically.

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

**2. Configure it:**

```bash
cp /opt/thirtydates/app/deploy/Caddyfile.example /etc/caddy/Caddyfile
sed -i 's/dates.example.com/YOUR.DOMAIN/' /etc/caddy/Caddyfile
systemctl reload caddy
```

**3. Make the web app listen only behind Caddy:**

```bash
sed -i 's/^Environment=WEB_HOST=0.0.0.0/Environment=WEB_HOST=127.0.0.1/' /etc/systemd/system/thirtydates-web.service
systemctl daemon-reload
```

**4. Switch the app to production with real email.** Edit `/etc/thirtydates/thirtydates.env`:

```
NODE_ENV=production
WEB_ORIGIN=https://YOUR.DOMAIN
SMTP_URL=smtps://USER:PASSWORD@smtp.your-provider.com:465
MAIL_FROM="Thirty Dates <hello@YOUR.DOMAIN>"
```

Any SMTP provider works (Postmark, Mailgun, Amazon SES, Fastmail, …). URL-encode special characters in the password.

**5. Restart:**

```bash
systemctl restart thirtydates-api thirtydates-worker thirtydates-web
```

Open `https://YOUR.DOMAIN`. Sign-in links now arrive by email, and the session cookie is marked secure automatically because the origin is HTTPS.

---

## Day-to-day operations

**Logs**

```bash
journalctl -u thirtydates-api -f
journalctl -u thirtydates-worker -f
journalctl -u thirtydates-web -f
```

**Updating to a newer version**

```bash
cd /opt/thirtydates/app
runuser -u thirtydates -- git pull
runuser -u thirtydates -- npm ci --include=dev
runuser -u thirtydates -- npm run build
runuser -u thirtydates -- bash -c 'set -a; . /etc/thirtydates/thirtydates.env; set +a; npm run db:migrate'
systemctl restart thirtydates-api thirtydates-worker thirtydates-web
```

**Backups:** the database plus uploaded photos

```bash
runuser -u postgres -- pg_dump -Fc thirtydates > /root/thirtydates-$(date +%F).dump
tar czf /root/thirtydates-uploads-$(date +%F).tgz -C /var/lib/thirtydates uploads
```

Also keep a copy of `/etc/thirtydates/thirtydates.env`: without the same `ESCROW_PAIR_SALT` and `JWT_SECRET`, a restored database won't line up. Proxmox's own container backups (vzdump) capture all of this at once.

**Run a scheduled job by hand**

For example, to re-deal after fixing data:

```bash
. /etc/thirtydates/thirtydates.env
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:4000/api/cron/monday-deal
```

Jobs are safe to repeat; a job that isn't due yet answers `409 job_not_due`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration: …` in the API log | A value in the env file is missing or too short. The message names it. |
| Sign-in link works but you land back on sign-in | `WEB_ORIGIN` doesn't match the browser address, or you opened the link in a different browser. |
| `403 Cross-origin request rejected` | Same: fix `WEB_ORIGIN`, then `systemctl restart thirtydates-api`. |
| `Could not enable the "vector" extension` / `type "vector" does not exist` | pgvector isn't installed for PostgreSQL 16: redo step 2 using the PGDG repository. |
| `npm run build` killed / "JavaScript heap out of memory" | Give the container 4 GB RAM or add swap in Proxmox. |
| No cards on the dashboard | Cards are dealt Mondays at 07:00 UTC. Check `journalctl -u thirtydates-worker`, or run the job by hand (above). |
| A service fails with "Failed to set up mount namespacing" | Your container is restricted. Enable *Options → Features → nesting* in Proxmox, or remove `StateDirectory`/hardening lines and create `/var/lib/thirtydates` owned by `thirtydates` yourself. |
