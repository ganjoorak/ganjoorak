# Deploying Ganjoorak on a VPS

Three containers on one Docker network:

| Service | Image | Port (inside the network) | Job |
|---|---|---|---|
| `web` | `ghcr.io/hadi7546/ganjoorak:<tag>` | 3000 | Next.js app |
| `server` | `ghcr.io/hadi7546/ganjoorak-server:<tag>` | 8787 | Go accounts service + SQLite |
| `caddy` | `caddy:2` | 80, 443 (public) | HTTPS and reverse proxy to `web` |

The names `web` and `server` matter:
- `ACCOUNTS_API_URL=http://server:8787` is **baked into the web image at build time** (the
  `/api/account/*` rewrite), so the accounts container must be called `server`.
- The accounts service reads poem text from the web app (`POEMS_API_URL=http://web:3000`) for
  quotes and moshaere.

HTTPS is required: the session cookie is `Secure`, so sign-in does not work over plain HTTP.

---

## 1. Prepare the VPS (once)

Ubuntu 22.04/24.04, 1 GB RAM is enough. Point your domain's `A` record (and `AAAA` if you
have IPv6) at the VPS first, so Caddy can get a certificate.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and in again
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## 2. Get the images

Pushing to `v3` (or `master`) runs `.github/workflows/docker-image.yml`, which publishes both
images tagged with the branch name (`v3`) and the commit (`sha-…`); `master` also gets
`latest`. Wait for the workflow to finish on GitHub (Actions tab).

If the packages are private, log in on the VPS with a GitHub token that has `read:packages`:

```bash
echo <TOKEN> | docker login ghcr.io -u hadi7546 --password-stdin
```

If `ghcr.io` is slow or blocked from the VPS, use the same mirror as your other containers
(e.g. `ghcr.hamdocker.ir/hadi7546/...`) in the image names below.

## 3. Compose file

`/opt/ganjoorak/compose.yml`:

```yaml
name: ganjoorak
services:
  web:
    image: ghcr.io/hadi7546/ganjoorak:v3
    restart: unless-stopped
    environment:
      GANJOOR_API_BASE_URL: https://api.ganjoor.net
      # Server components call the accounts service directly at runtime.
      ACCOUNTS_API_URL: http://server:8787
    depends_on: [server]

  server:
    image: ghcr.io/hadi7546/ganjoorak-server:v3
    restart: unless-stopped
    environment:
      POEMS_API_URL: http://web:3000
    volumes:
      - accounts-data:/data       # the SQLite database with every account

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [web]

volumes:
  accounts-data:
  caddy-data:
  caddy-config:
```

`/opt/ganjoorak/Caddyfile` (replace the domain):

```
ganjoorak.example.com {
	encode zstd gzip
	reverse_proxy web:3000
}
```

Only Caddy publishes ports; `web` and `server` are reachable only inside the Docker network.

## 4. Start

```bash
cd /opt/ganjoorak
docker compose pull
docker compose up -d
docker compose logs -f --tail=50
```

## 5. Check it works

```bash
curl -s https://ganjoorak.example.com/api/account/catalog | head -c 200   # badges + banners JSON
curl -s "https://ganjoorak.example.com/api/poem-lines?key=ganjoor:hafez:2131" | head -c 200
```

Then in a browser: sign up, open a poem for 15 s (streak), select two lines → «در صفحهٔ من»
(quote; this one proves `server` → `web` works), open `/@yourname`, and post a verse in
`/moshaere`.

## 6. Updating

Push to `v3`, wait for the workflow, then:

```bash
cd /opt/ganjoorak && docker compose pull && docker compose up -d
```

Database changes are applied automatically when the accounts service starts (new tables and
columns). **Back up first** (next section). To pin a release, use a `sha-…` tag instead of `v3`.

If an older accounts service is already running with real users, keep using **its existing
volume** (put that volume's name under `accounts-data`, with `external: true`), so no account
is lost.

## 7. Backups

SQLite runs in WAL mode, so copy it with `.backup`, not `cp`. Uploaded avatars and banners
live next to it in `/data/media`, so archive those too:

```bash
mkdir -p /opt/ganjoorak/backups
docker run --rm -v ganjoorak_accounts-data:/data -v /opt/ganjoorak/backups:/backup alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/accounts.db ".backup /backup/accounts-$(date +%F).db" && tar -czf /backup/media-$(date +%F).tar.gz -C /data media'
```

Put that in `crontab -e` (e.g. `0 3 * * *`; escape each `%` as `\%` in a crontab line) and copy
`/opt/ganjoorak/backups` off the server now and then. To restore: stop `server`, copy a backup
to `/data/accounts.db` in the volume, unpack the media archive into `/data`, start it again.

## Building on the VPS instead (no registry)

```bash
git clone -b v3 https://github.com/hadi7546/ganjoorak && cd ganjoorak
docker build -t ganjoorak-server:local backend
# The web Dockerfile copies a prebuilt .next/standalone, so build Next first (Node 20):
npm ci && ACCOUNTS_API_URL=http://server:8787 npm run build
docker build -t ganjoorak:local .
```

and use `ganjoorak:local` / `ganjoorak-server:local` as the images in `compose.yml`.
`next build` needs ~2 GB RAM; add swap on a 1 GB VPS.
