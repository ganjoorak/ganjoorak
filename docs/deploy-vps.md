# Deploying Ganjoorak on a VPS

Two containers on one Docker network, behind the nginx already running on the VPS:

| Service | Image | Port | Job |
|---|---|---|---|
| `web` | `ghcr.io/hadi7546/ganjoorak:<tag>` | 3000 (published on `127.0.0.1:3100`) | Next.js app |
| `server` | `ghcr.io/hadi7546/ganjoorak-server:<tag>` | 8787 (inside the network only) | Go accounts service + SQLite |

nginx on the host terminates HTTPS and proxies everything to `web`, including `/api/account/*`,
which `web` forwards to `server`. Do not point nginx at `server` directly.

The names `web` and `server` matter:
- `ACCOUNTS_API_URL=http://server:8787` is **baked into the web image at build time** (the
  `/api/account/*` rewrite) and is also the image's runtime default (profile pages at
  `/@username` fetch it from the server), so the accounts container must be called `server`.
  See [troubleshooting-profile-404.md](troubleshooting-profile-404.md) if profiles answer 404.
- The accounts service reads poem text from the web app (`POEMS_API_URL=http://web:3000`) for
  quotes and moshaere.

HTTPS is required: the session cookie is `Secure`, so sign-in does not work over plain HTTP.

---

## 1. Prepare the VPS (once)

Ubuntu 22.04/24.04, 1 GB RAM is enough. Point your domain's `A` record (and `AAAA` if you
have IPv6) at the VPS first, so certbot can get a certificate.

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
    # Reachable only by nginx on this host. Change 3100 if it is taken, here and in the nginx site.
    ports: ["127.0.0.1:3100:3000"]
    environment:
      GANJOOR_API_BASE_URL: https://api.ganjoor.net
      # Server components call the accounts service directly at runtime. Without
      # this (on images older than the Dockerfile default), /@username answers 404.
      ACCOUNTS_API_URL: http://server:8787
    depends_on: [server]

  server:
    image: ghcr.io/hadi7546/ganjoorak-server:v3
    restart: unless-stopped
    environment:
      POEMS_API_URL: http://web:3000
    volumes:
      - accounts-data:/data       # the SQLite database and uploaded images

volumes:
  accounts-data:
```

## 4. Start

```bash
cd /opt/ganjoorak
docker compose pull
docker compose up -d
docker compose logs -f --tail=50
```

Check it answers locally before touching nginx:

```bash
curl -sI http://127.0.0.1:3100 | head -1
```

## 5. nginx

`/etc/nginx/sites-available/ganjoorak` (replace the domain):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name ganjoorak.example.com;

    # Banner uploads are up to 4 MB. nginx's 1 MB default would answer them with 413.
    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # The accounts service rate-limits sign-in by the last hop of this header, and Next.js
        # passes it through unchanged. Without this line every visitor shares one limit.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Next.js streams pages.
        proxy_buffering off;
    }
}
```

Enable it and get a certificate. certbot adds the HTTPS server block and the redirect:

```bash
sudo ln -s /etc/nginx/sites-available/ganjoorak /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ganjoorak.example.com
```

**Behind Cloudflare,** nginx sees Cloudflare's address instead of the visitor's, so add this once
(it also has to be rerun if Cloudflare's ranges change), and set the SSL mode to Full (strict):

```bash
{ for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} | sudo tee /etc/nginx/conf.d/cloudflare-real-ip.conf
sudo nginx -t && sudo systemctl reload nginx
```

If nginx itself runs in a container, drop the `ports` line from `web`, attach nginx to the
`ganjoorak_default` network and use `proxy_pass http://web:3000;`.

## 6. Check it works

```bash
curl -s https://ganjoorak.example.com/api/account/catalog | head -c 200   # badges + banners JSON
curl -s "https://ganjoorak.example.com/api/poem-lines?key=ganjoor:hafez:2131" | head -c 200
```

Then in a browser: sign up, open a poem for 15 s (streak), select two lines → «در صفحهٔ من»
(quote; this one proves `server` → `web` works), open `/@yourname`, post a verse in
`/moshaere`, and upload a banner of 2 MB or more (proves `client_max_body_size`).

### First admin

Sign up on the site, then give that account the role on the server. Later roles can be set from
`/admin/users`. The same command recovers access if no admin is left.

```bash
docker compose exec server /accounts set-role <username> admin
```

## 7. Updating

Push to `v3`, wait for the workflow, then:

```bash
cd /opt/ganjoorak && docker compose pull && docker compose up -d
```

Database changes are applied automatically when the accounts service starts (new tables and
columns). **Back up first** (next section). To pin a release, use a `sha-…` tag instead of `v3`.

If an older accounts service is already running with real users, keep using **its existing
volume** (put that volume's name under `accounts-data`, with `external: true`), so no account
is lost.

## 8. Backups

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
