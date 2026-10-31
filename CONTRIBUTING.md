# Contributing

## Branch

Start from `main` and open the pull request against `main`.

```bash
git checkout main
git pull
git checkout -b your-name/short-topic
```

## Before you open a pull request

```bash
cd backend && gofmt -l . && go vet ./... && go test ./...
npm run lint
npm run typecheck
```

`gofmt -l .` should print nothing. CI (`.github/workflows/ci.yml`) runs these on every pull request and push. Publishing the GHCR images stays in `.github/workflows/docker-image.yml`, which runs on push to the deploy branches (including `main`), not on pull requests.

## Expectations

- Say what changed and how you checked it.
- Keep the diff to the problem you are solving.
- Do not add poem text, audio, or other third-party content unless you can show the project has the right to ship it. See [CONTENT.md](CONTENT.md). Leave `public/audios/` gitignored.
- A patch is accepted under AGPL-3.0-or-later, the same license as the rest of the code. You keep copyright in what you wrote; the project needs that license to distribute the change.
