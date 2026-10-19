# Installing Thirty Dates on a fresh Debian LXC container

This takes a container with nothing but Debian on it to a running app that starts on boot. Nothing here uses Docker.

**Who runs what:**

- **root** is used exactly once, in step 1, to install `sudo` and create your user.
- From then on you work as **your own user**, with `sudo` only for system-level steps (installing packages, PostgreSQL admin, systemd).
- The app, its configuration and uploaded photos all live in **your home directory**, and the services run as **your user**, never as root.

The examples use the username `thirty`. Pick any name you like; after step 1 every command uses `$USER` and `$HOME`, so nothing else needs editing.

```
/home/thirty/
├── 30dates/          ← the app (git checkout)
│   └── .env          ← its configuration (secrets, chmod 600)
└── 30dates-data/
    └── uploads/      ← member photos (kept outside the checkout)
```

There are two finishing paths:

- **A. LAN testing:** open `http://<container-ip>:3000` from your own network. No domain and no email server; sign-in links appear in the API log.
- **B. Public with HTTPS:** a domain name, Caddy for automatic certificates, and real email.

Do steps 0–9, then follow step 10A or 10B.

---

## 0. Create the container (Proxmox)

| Setting | Value |
|---|---|
| Template | `debian-13-standard` or `debian-12-standard` |
| Unprivileged | Yes (default) |
| CPU | 2 cores |
| Memory | **4096 MB** (the web build needs ~2 GB; 2048 MB works if you also give 2048 MB swap) |
| Disk | 16 GB |
| Network | DHCP is fine, but a static IP or DHCP reservation keeps the address stable |

Start it and open its console (Proxmox: the container's **Console** tab, or `pct enter <id>` on the host).

## 1. As root, the only time: sudo and your user

```bash
apt update && apt full-upgrade -y
apt install -y sudo curl ca-certificates gnupg git openssl locales

# Minimal templates often have no locale, which makes PostgreSQL complain.
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8

# Your user, with sudo rights.
adduser thirty            # asks for a password; the other questions can be left blank
usermod -aG sudo thirty
```

Now switch to that user and stay there for the rest of the guide:

```bash
su - thirty
```

Next time, log in as `thirty` directly: through the console, or over SSH with `ssh thirty@<container-ip>`.

> **Optional hardening.** Once you've confirmed you can log in as your user and run `sudo whoami` (it should print `root`), stop root from logging in over SSH:
> `sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && sudo systemctl restart ssh`

The app keeps all of its schedules in UTC, so the container's own time zone doesn't matter. The container takes its clock from the Proxmox host, so make sure the **host** keeps accurate time (NTP).

## 2. PostgreSQL + PostGIS + pgvector

The schema needs pgvector 0.5 or newer (it uses an HNSW index). Which commands you run depends on your Debian release:

```bash
grep VERSION_CODENAME /etc/os-release
```

**Debian 13 (trixie).** This is the current Proxmox template. Debian's own packages are new enough (PostgreSQL 17, PostGIS 3.5, pgvector 0.8):

```bash
sudo apt update
sudo apt install -y postgresql postgresql-17-postgis-3 postgresql-17-pgvector
sudo systemctl enable --now postgresql
```

**Debian 12 (bookworm).** Debian's pgvector is too old there, so use the official PostgreSQL repository and PostgreSQL 16:

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-16 postgresql-16-postgis-3 postgresql-16-pgvector
sudo systemctl enable --now postgresql
```

**Check before moving on.** Both commands should succeed:

```bash
pg_lsclusters                                  # 17 (or 16)  main  5432  online …
sudo -u postgres psql -c "SELECT version();"
```

If `pg_lsclusters` prints nothing, PostgreSQL didn't install: re-read the `apt install` output for errors. If the cluster shows `down`, start it with `sudo pg_ctlcluster <version> main start`. Nothing later works until this check passes.

## 3. Node.js 22

Debian ships an older Node, so use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node -v    # v22.x
```

## 4. Get the code into your home directory

The repository is private, so you need a GitHub **personal access token** with read access to `Somel1978/30dates`. Create one at GitHub → Settings → Developer settings → Fine-grained tokens, with Contents set to read-only.

```bash
cd ~
git clone --branch claude/clever-hypatia-qyi2q0 \
  https://<YOUR_GITHUB_TOKEN>@github.com/Somel1978/30dates.git ~/30dates
# Don't leave the token in the saved remote URL:
git -C ~/30dates remote set-url origin https://github.com/Somel1978/30dates.git

mkdir -p ~/30dates-data/uploads
```

No `sudo` here: the code belongs to you. Once the branch is merged, use `--branch main` instead.

## 5. Database, role and extensions

Generate a password for the app's database role and keep it for step 6. It only lives in this shell session, so if you log out before step 6, generate a new one and redo this step:

```bash
DB_PASSWORD=$(openssl rand -hex 24); echo "$DB_PASSWORD"
```

```bash
sudo -u postgres psql -c "CREATE ROLE thirtydates_app LOGIN PASSWORD '$DB_PASSWORD';"
sudo -u postgres createdb -O thirtydates_app thirtydates
sudo -u postgres psql -d thirtydates -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector;"
```

The database role `thirtydates_app` is deliberately **not** a superuser. That is what makes the database enforce the blind-escrow privacy rules (row-level security) against the app itself.

## 6. Configuration file

```bash
cd ~/30dates
cp deploy/thirtydates.env.example .env
chmod 600 .env

sed -i "s|CHANGE_ME_DB_PASSWORD|$DB_PASSWORD|" .env
sed -i "s|__APP_HOME__|$HOME|" .env
for key in JWT_SECRET ESCROW_PAIR_SALT CRON_SECRET; do
  sed -i "s|^$key=CHANGE_ME|$key=$(openssl rand -hex 32)|" .env
done
```

Set `WEB_ORIGIN` to **every address you'll open the site with**, separated by commas. This starts you with the container's IP and its hostname:

```bash
IP=$(hostname -I | awk '{print $1}')
sed -i "s|^WEB_ORIGIN=.*|WEB_ORIGIN=http://$IP:3000,http://$(hostname):3000|" .env
grep -E '^(NODE_ENV|WEB_ORIGIN|DATABASE_URL|UPLOAD_DIR)=' .env
grep -c CHANGE_ME .env      # should print 0
```

Check that `DATABASE_URL` has a long password after `thirtydates_app:`. If it shows `thirtydates_app:@`, the password variable was lost; see troubleshooting.

> **What `WEB_ORIGIN` does.** It doesn't decide who can connect: the web app listens on every interface regardless. It's the list of addresses the site answers to. Sign-in and other form submissions are only accepted from these addresses (this stops other websites acting on a member's behalf). Each emailed sign-in link points back to the address the member used. Include the scheme and port, e.g. `http://30plus:3000`. Add more entries any time (a domain later on, say), then `sudo systemctl restart thirtydates-api`.

The hostname entry only works if your router or local DNS resolves `30plus` (or whatever you named the container). Otherwise just use the IP.

**Never change `ESCROW_PAIR_SALT` after members join.** It keys the hashed pair identifiers, so changing it orphans every pending stamp.

`.env` is git-ignored, so `git pull` never overwrites it.

## 7. Install dependencies, build, migrate

```bash
cd ~/30dates
npm ci --include=dev
npm run build
set -a; . ./.env; set +a
npm run db:migrate
```

You should see `applied 001_init.sql`. The build takes a few minutes. If it gets killed, the container needs more memory or swap (see step 0).

## 8. systemd services (run as your user)

Three services: the API, the scheduler (the Monday 07:00 deal, the Sunday 06:00 reveal and maintenance) and the web app. The unit files in `deploy/systemd/` are templates; this fills in your username and home directory as it installs them:

```bash
for f in ~/30dates/deploy/systemd/thirtydates-*.service; do
  sed -e "s|__APP_USER__|$USER|g" -e "s|__APP_DIR__|$HOME/30dates|g" "$f" \
    | sudo tee /etc/systemd/system/$(basename "$f") > /dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now thirtydates-api thirtydates-worker thirtydates-web
systemctl status thirtydates-api thirtydates-worker thirtydates-web --no-pager
```

Check them:

```bash
curl -s http://127.0.0.1:4000/healthz          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/signin   # 200
journalctl -u thirtydates-worker -n 20 --no-pager   # "worker started" with next run times
ps -o user= -C node | sort -u                        # your username, not root
```

If `journalctl` says you lack permission, add yourself to the log readers once with `sudo usermod -aG systemd-journal $USER`, then log out and back in. Until then, prefix `journalctl` with `sudo`.

## 9. Test it on your own: the Test tools page

On a fresh install you're the only member, so the week is empty. With `NODE_ENV=development` (the LAN-testing setting), sign in, finish your profile, and open **Test tools** in the top menu. Its buttons walk the whole week in a few minutes:

1. **Add 24**: creates members built to match *you* (nearby, inside your age window, the genders you seek, your life-architecture answers).
2. **Monday**, then **Deal now**: your six cards appear on *This week*.
3. **Stamp me ×3**: three cards silently stamp you. Stamp them back (hold a line on a card) to form mutual pairs.
4. **Wednesday**: unlocks the scenario exchange on your mutual pairs.
5. **Sunday 06:05**: runs the reveal; names unblur.
6. **Sunday 18:05**: send your #1 Signal, then **Signal me**. You get a match, chat and the First-Meet Bridge.
7. **Next Monday**: new week, new cards. **Real time** puts the clock back.

The clock moves only inside the API process and resets when the API restarts. The page and its endpoints don't exist when `NODE_ENV=production`.

The same seeding is available from the command line, for an account that has finished its profile:

```bash
cd ~/30dates
set -a; . ./.env; set +a
npm run seed:demo -w @thirtydates/api -- you@example.com
```

Outside testing, members who join mid-week are dealt cards within the hour (until Saturday night), as other members become available.

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
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
sudo apt update && sudo apt install -y caddy
```

**2. Configure it:**

```bash
sed 's/dates.example.com/YOUR.DOMAIN/' ~/30dates/deploy/Caddyfile.example | sudo tee /etc/caddy/Caddyfile > /dev/null
sudo systemctl reload caddy
```

**3. Make the web app listen only behind Caddy:**

```bash
sudo sed -i 's/^Environment=WEB_HOST=0.0.0.0/Environment=WEB_HOST=127.0.0.1/' /etc/systemd/system/thirtydates-web.service
sudo systemctl daemon-reload
```

**4. Switch the app to production with real email.** Edit `~/30dates/.env` with `nano ~/30dates/.env`:

```
NODE_ENV=production
WEB_ORIGIN=https://YOUR.DOMAIN,http://<container-ip>:3000
SMTP_URL=smtps://USER:PASSWORD@smtp.your-provider.com:465
MAIL_FROM="Thirty Dates <hello@YOUR.DOMAIN>"
```

Any SMTP provider works (Postmark, Mailgun, Amazon SES, Fastmail, …). URL-encode special characters in the password.

**5. Restart:**

```bash
sudo systemctl restart thirtydates-api thirtydates-worker thirtydates-web
```

Open `https://YOUR.DOMAIN`. Sign-in links now arrive by email and point at whichever address you used. Sessions on the HTTPS address get a secure cookie automatically. Once step 3 has moved the web app behind Caddy, the `http://<container-ip>:3000` entry stops working, so you can drop it.

---

## Day-to-day operations

All of these are run as your user.

**Logs**

```bash
journalctl -u thirtydates-api -f
journalctl -u thirtydates-worker -f
journalctl -u thirtydates-web -f
```

**Updating to a newer version**

```bash
cd ~/30dates
git pull
npm ci --include=dev
npm run build
set -a; . ./.env; set +a
npm run db:migrate
sudo systemctl restart thirtydates-api thirtydates-worker thirtydates-web
```

If an update changes the files in `deploy/systemd/`, re-run the install loop from step 8.

**Backups:** the database, photos and configuration

```bash
mkdir -p ~/backups
sudo -u postgres pg_dump -Fc thirtydates > ~/backups/thirtydates-$(date +%F).dump
tar czf ~/backups/thirtydates-uploads-$(date +%F).tgz -C ~/30dates-data uploads
cp ~/30dates/.env ~/backups/thirtydates-env-$(date +%F)
chmod 600 ~/backups/*
```

Keep the `.env` copy safe: without the same `ESCROW_PAIR_SALT` and `JWT_SECRET`, a restored database won't line up. Copy `~/backups` off the container, or rely on Proxmox container backups (vzdump), which capture everything at once.

**Run a scheduled job by hand**

For example, to re-deal after fixing data:

```bash
set -a; . ~/30dates/.env; set +a
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:4000/api/cron/monday-deal
```

Jobs are safe to repeat; a job that isn't due yet answers `409 job_not_due`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `thirty is not in the sudoers file` | Step 1's `usermod -aG sudo` was skipped, or you haven't logged in again since. Log out and back in. |
| `Invalid configuration: …` in the API log | A value in `~/30dates/.env` is missing or too short. The message names it. |
| Service fails with `Failed to load environment files` | The `.env` path in the unit doesn't match. Re-run the step 8 loop as your own user (not with `sudo -i`), so `$USER` and `$HOME` are yours. |
| `EACCES` writing uploads | `~/30dates-data/uploads` is missing or not owned by you: `mkdir -p ~/30dates-data/uploads`. |
| `403 Cross-origin request rejected` | The address in your browser bar isn't in the `WEB_ORIGIN` list. Add it exactly (scheme, host and port), then `sudo systemctl restart thirtydates-api`. |
| Sign-in link works but you land back on sign-in | You opened the link in a different browser from the one that requested it, or on an address that isn't in `WEB_ORIGIN`. |
| `DATABASE_URL` shows `thirtydates_app:@` (empty password) | Set a fresh one in both places: `P=$(openssl rand -hex 24); sed -i -E "s|thirtydates_app:[^@]*@|thirtydates_app:$P@|" ~/30dates/.env; sudo -u postgres psql -c "ALTER ROLE thirtydates_app PASSWORD '$P';"` |
| `No existing cluster is suitable as a default target` / `You must install at least one postgresql-client-<version> package` | PostgreSQL never installed. Usually the Debian 12 commands were run on Debian 13: check `VERSION_CODENAME` and use the matching block in step 2. |
| `type "vector" does not exist` | The pgvector package for your PostgreSQL version is missing: redo step 2 for your Debian release. |
| Build fails with `<Html> should not be imported outside of pages/_document` | An older checkout built the web app with `NODE_ENV=development` from `.env`. Run `git pull`: the web build now always runs in production mode. |
| `npm run build` killed / "JavaScript heap out of memory" | Give the container 4 GB RAM or add swap in Proxmox. |
| No cards on the dashboard | Cards are dealt Mondays at 07:00 UTC. Check `journalctl -u thirtydates-worker`, or run the job by hand (above). |
| A service fails with "Failed to set up mount namespacing" | Enable *Options → Features → nesting* for the container in Proxmox. |
