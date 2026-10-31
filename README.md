# Ganjoorak (گنجورک)

راحت‌تر شعر بخوانیم و شعر گوش دهیم. A Next.js app for reading Persian poetry, with a Go service for accounts, quotes, and مشاعره.

The **code** is [GNU AGPL-3.0-or-later](LICENSE). If you run a modified version as a network service, you must offer users the corresponding source (AGPL section 13). Poem text, audio, and third-party mirrors are not part of that grant. Read [CONTENT.md](CONTENT.md) before you redistribute or host this tree.

## Data from sibling repos

The Echolalia mirror and the update videos live in their own repos. Clone them into place:

```bash
git clone https://github.com/ganjoorak/echolalia-data.git data/echolalia
git clone https://github.com/ganjoorak/videos.git public/videos
```

## Run with Docker

```bash
git clone https://github.com/ganjoorak/website.git website && cd website
git clone https://github.com/ganjoorak/echolalia-data.git data/echolalia
git clone https://github.com/ganjoorak/videos.git public/videos
docker compose up --build
```

The app is on <http://localhost:3000> and the accounts service on <http://localhost:8787>. Accounts data (SQLite) is kept in the `accounts-data` volume.

## Run locally

You need Node.js 20 and Go 1.26 (see `backend/go.mod`).

Accounts service. It listens on `127.0.0.1:8787` and stores `backend/data/accounts.db`:

```bash
cd backend
TRUSTED_PROXY_HOPS=none go run .
```

Web app at <http://localhost:3000>. `/api/account/*` is rewritten to `ACCOUNTS_API_URL`, which defaults to `http://127.0.0.1:8787`, so a local `go run` needs no extra web env:

```bash
npm ci
npm run dev
```

`next dev` reads `ACCOUNTS_API_URL` from the environment at startup. A production image bakes the same variable in at `npm run build` (the Docker default is `http://server:8787`).

Copy [.env.example](.env.example) to `.env.local` when you need to override something. `.env.local` is gitignored. Do not commit secrets.

`TRUSTED_PROXY_HOPS=none` makes the accounts service ignore `X-Forwarded-For` and rate-limit by the TCP peer. Use that whenever you are not behind an nginx reverse proxy. The default `0` matches that nginx config: Next.js forwards the header unchanged, and nginx has already replaced it with the visitor address.

## Checks

```bash
cd backend && gofmt -l . && go vet ./... && go test ./...
npm run lint
npm run typecheck
```

`gofmt -l .` should print nothing. Pull requests run the same checks in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
