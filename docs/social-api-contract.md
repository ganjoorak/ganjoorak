# Social features — API contract (streaks, badges, appearance, quotes, moshaere)

Single source of truth for the Go accounts service (`backend/`), the web client and the
mobile app. All paths are under `/api/account/` (same-origin rewrite to the Go service),
except `/api/poem-lines`, which is a Next.js route.

Conventions (same as the existing service):
- JSON in/out; errors are `{"error": "<Persian, ready to show>"}`.
- Signed-in endpoints answer `401` without a valid `ganjoorak_session` cookie.
- Times are Unix **milliseconds**, stamped by the server. A "day" is a calendar day in
  **Asia/Tehran**, formatted `YYYY-MM-DD` (the binary embeds `time/tzdata`).
- "Public user" means `is_public = 1`. Private accounts never appear in other people's
  lists, rooms, counts or invites; unknown and private look the same (`404`).
- Lists are never `null` in JSON; empty is `[]`.

---

## 0. Poem text resolver

The Go service has no poem corpus. It asks the Next app for a poem's lines, so quote and
moshaere text always comes from the real poem, never from the client.

**Next route** `GET /api/poem-lines?key={source}:{poetSlug}:{id}`
→ `200 {key, source, poetSlug, poetName, title, href, lines: string[]}` · `404` unknown · `400` bad key.

- `lines` = the poem's `plainText` split on `\n`, each trimmed, empty ones dropped —
  **the same order and indexing the poem viewer renders** (line index `i` here is line `i`
  on screen, 0-based). A Ganjoor couplet is two consecutive lines.
- `href` uses the same rule as `getPoemHref` (`/poem/{id}` for ganjoor, `/{poetSlug}/{id}` otherwise).
- Cached (`Cache-Control: public, max-age=3600`). `502` when the upstream poem source fails.
- Keys are canonical: the key must equal the poem's own library key, so `ganjoor:saadi:2131`
  is `404` (poem 2131 is Hafez's). Fetch keys from the poem itself (`getPoemLibraryKey`).

**Go side** (`backend/poems.go`): `PoemSource` interface, HTTP implementation reading
`POEMS_API_URL` (default `http://127.0.0.1:3000`), 5 s timeout, small in-memory cache.
Tests use a fake.

Key pattern accepted everywhere: `^(ganjoor|custom|echolalia):[\p{L}\p{N}_.\-]+:[0-9]+$`.

---

## 1. Reading streak

A poem counts as **read** when the client has shown it for ≥ 15 s of visible time, or the
reader reached its end. The client reports each read once per poem per page view; the
server dedupes per poem per day.

`POST /api/account/read` `{key}` → `200 {streak: Streak, newBadges: Badge[]}`

```
Streak {
  current: int        // consecutive days ending today, or ending yesterday if today has no read yet
  best: int           // longest run ever
  today: bool         // whether today already counts
  totalPoems: int     // distinct (poem, day) reads ever
  days: string[]      // days with a read among the last 28 days, oldest first ("YYYY-MM-DD")
}
```
- At most 300 reads per user per day are stored; extra ones still answer `200` with the current streak.
- `newBadges` lists badges earned by this very call (show a toast), usually `[]`.
- `400` «شعر نامعتبر است.» for a malformed key.
- Web rule for "read" (`src/hooks/useReadTracker.ts`): 15 s of visible time, or reaching the
  end of the poem after at least 4 s visible; the timer pauses while the page is hidden.

---

## 2. Badges

Rule-based, persisted once earned (`badges(user_id, badge_key, earned_at)`), so changing a
rule never takes a badge away. For now all badges are streak badges, awarded when
`current` reaches the threshold.

```
Badge { key, title, description, icon, tier, earnedAt }   // earnedAt = 0 in the catalog
```

| key | threshold | title | icon | tier |
|---|---|---|---|---|
| `streak-3` | 3 | سه روز پیاپی | `sprout` | 1 |
| `streak-7` | 7 | یک هفته شعر | `flame` | 2 |
| `streak-30` | 30 | یک ماه شعر | `moon` | 3 |
| `streak-100` | 100 | صد روز شعر | `star` | 4 |
| `streak-365` | 365 | یک سال شعر | `crown` | 5 |

Descriptions: «سه روز پشت سر هم شعر خواندید.» / «هفت روز …» / «سی روز …» / «صد روز …» / «یک سال تمام هر روز شعر خواندید.»
`icon` is a neutral key; each client maps it to its own icon set.

`GET /api/account/catalog` (no session) → `{badges: Badge[], banners: Banner[]}`

---

## 3. Profile appearance (banner, accent, background, bio)

New `users` columns: `bio`, `banner`, `accent`, `background` (all `TEXT NOT NULL DEFAULT ''`).

`PUT /api/account/appearance` `{bio, banner, accent, background}` → `200 {user}`
- A separate endpoint so older clients calling `PUT /profile` don't wipe these.
- `bio`: up to 160 characters, newlines become spaces (same `cleanText` rules).
- `banner`: `""` or a catalog key.
- `accent`, `background`: `""` (theme default) or `#rrggbb`; stored lowercase.
- If both colors are set, WCAG contrast(accent, background) must be ≥ 3.0, else `400`
  «رنگ تأکید روی این پس‌زمینه دیده نمی‌شود؛ رنگ دیگری انتخاب کنید.».
- Clients pick text colour on `background` and on `accent` by luminance (black or white,
  whichever has higher contrast).

```
Banner { key, title, image }   // image = "/banners/{key}.svg", same-origin static file
```
Keys: `dawn` سپیده‌دم · `dusk` غروب · `night` شب · `garden` باغ · `desert` کویر · `sea` دریا · `tile` کاشی · `paper` کاغذ.

`User` (everywhere it appears: `/me`, login, signup, profile updates) gains
`bio, banner, accent, background`.

---

### 3.1 Uploaded avatar and banner images

Besides the presets, a user can upload their own profile picture and banner.

**Representation.** An upload is stored in the existing field as `img:<id>`, where `<id>` is
32 lowercase hex characters (random). So `User.avatar` / `User.banner`, `PublicProfile.avatar` /
`.banner`, and every other `avatar` field (FollowUser, StoryPerson.user, Move, Player, leaders)
may now hold `img:<id>` besides a preset key or `""`. Clients turn it into
`/api/account/media/<id>.jpg`. A client that doesn't know the prefix should treat it as `""`
(pick an avatar from the username / no banner).

| Method & path | In | Out | Notes |
|---|---|---|---|
| `POST /uploads/avatar` | raw image body, `Content-Type: image/jpeg` or `image/png` | `201 {user}` | signed in; ≤ 2 MB; at least 128×128 and at most 4096×4096 pixels before processing. The server center-crops to a square, scales to 512×512, re-encodes as JPEG (quality 85, no metadata), stores it, sets `avatar = "img:<id>"` and deletes the user's previous uploaded avatar file |
| `POST /uploads/banner` | same | `201 {user}` | ≤ 4 MB; at least 600×200, at most 6000×6000. Center-crops to 3:1, scales to 1500×500, re-encodes JPEG; sets `banner = "img:<id>"`, deletes the previous uploaded banner |
| `DELETE /uploads/avatar` / `DELETE /uploads/banner` | — | `{user}` | resets the field to `""` and deletes the file |
| `GET /media/{id}.jpg` | — | the JPEG | no session; `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable`; `404` for unknown ids. Files of private accounts are still served (ids are unguessable), but private profiles never expose them |

- Errors: `400` «فقط تصویر JPEG یا PNG.», «تصویر خیلی کوچک است.», «تصویر خیلی بزرگ است.» (also for
  bodies over the size cap, `413`), «این تصویر خوانده نشد.»; `429` more than 20 uploads per hour.
- `PUT /profile` and `PUT /appearance` accept `img:<id>` **only if it equals the value already
  stored** for that user (so editing the name keeps the uploaded avatar); any other `img:` value
  is `400`. Choosing a preset or `""` replaces the upload and deletes its file.
- Files live next to the database: `<dir of ACCOUNTS_DB>/media/<id>.jpg` (the `/data` volume in
  Docker), so backups of `/data` include them.
- Moderation is out of scope for now: anyone signed in can upload. (A report/remove flow is a
  later step.)

## 4. Additions to existing responses

`GET /api/account/me` gains:
```
progress: { streak: Streak, badges: Badge[] }   // badges earned, newest first
```

`PublicProfile` (`GET /api/account/users/{username}`) gains:
```
bio, banner, accent, background: string
streak: { current, best, today }
badges: Badge[]            // earned, newest first
quotes: Quote[]            // newest 20
quoteCount: int
```

---

## 5. Quotes (shared poem fragments)

The reader selects part of a poem → a floating menu → «در صفحهٔ من». The selection is
rounded to whole lines.

```
Quote { id, key, href, poetName, poemTitle, from, to, lines: string[], createdAt }
```
- `from`/`to`: 0-based inclusive line indices into `/api/poem-lines` `lines`; `to - from < 8`.
- `lines` is cut by the server from the real poem.

| Method & path | In | Out | Notes |
|---|---|---|---|
| `POST /quotes` | `{key, from, to}` | `201 {quote}` | signed in; 20/day (`429`), keeps the newest 500 per user; `400` bad range; `404` unknown poem; same key+range again returns the existing quote (`200`) |
| `DELETE /quotes/{id}` | — | `204` | own quotes only; `404` otherwise |
| `GET /users/{username}/quotes?before={id}` | — | `{quotes, next}` | public accounts; the owner also gets their own while private; 20 per page, newest first; `next` is the id to pass as `before`, or `null` |
| `GET /following/quotes` | — | `{people: StoryPerson[]}` | signed in; see below |

```
StoryPerson {
  user: { username, displayName, avatar, accent }
  quotes: Quote[]      // that person's quotes from the last 7 days, newest first, ≤ 10
  latestAt: int
}
```
`people` = public accounts the caller follows that have ≥ 1 quote in the last 7 days,
`latestAt` desc, ≤ 50. Seen/unseen is per device (client stores the newest seen quote id
per username).

---

## 6. Moshaere (مشاعره)

### Letters
Both sides normalize the same way (`backend/moshaere.go`, `src/utils/moshaereLetters.ts`):
- map `ي ى ئ → ی`, `ك → ک`, `ة ۀ → ه`, `أ إ آ ٱ → ا`, `ؤ → و`;
- drop diacritics (U+064B–U+065F, U+0670), tatweel (U+0640), ZWNJ/ZWJ, punctuation,
  digits, Latin, spaces, and a trailing `ء`.
- `firstLetter` = first remaining letter of the first line; `lastLetter` = last remaining
  letter of the last line.
- The next verse must start with the previous verse's `lastLetter`.

### Verses and moves
A move is one verse of 1–2 lines (a couplet is 2), each line 2–120 characters, at least 6
letters in total. Input is **either**
- typed: `{lines: string[]}` (from memory), **or**
- picked from a poem: `{key, from, to}` with `to - from ≤ 1` — the server cuts the lines.

```
Move {
  id, username, displayName, avatar,
  lines: string[], firstLetter, lastLetter,
  key, href, poetName, poemTitle,    // "" for typed verses
  createdAt
}
```
Repeat check: the letters-only normalized text must not repeat within the match / within
the public room's last 500 moves.

Common `400` messages: «بیت باید با «{letter}» شروع شود.» · «این بیت قبلاً خوانده شده است.» ·
«بیت باید یک یا دو مصراع باشد.»

### Public room
One shared chain everyone signed in with a **public** profile can extend. No turns, but
not twice in a row, and one move per 10 s per user.

| Method & path | In | Out | Notes |
|---|---|---|---|
| `GET /moshaere/public?after={id}` | — | `{moves, nextLetter, leaders}` | no session needed. Without `after`: the last 50 moves, oldest first. With `after`: moves newer than it, oldest first (poll every 3–5 s) |
| `POST /moshaere/public` | verse input + optional `expect` | `201 {move, nextLetter}` | `403` private profile «برای مشاعرهٔ عمومی باید نمایه‌تان عمومی باشد.»; `409` you were last «صبر کنید کس دیگری بیتی بخواند.»; `409` someone was faster — body also has `nextLetter`; `429` too fast |

`expect` = the newest move id the client has seen (`0` for an empty room). When it no longer
matches, the answer is `409 {"error": "کسی زودتر بیتی خواند؛ حرف تازه «x» است.", "nextLetter": "x"}`;
without `expect` that check is skipped but the letter is still checked against the real newest move.
`429` «کمی صبر کنید؛ هر ۱۰ ثانیه یک بیت می‌شود خواند.».

`leaders`: `[{username, displayName, avatar, count}]`, moves in the last 7 days, top 10.
`nextLetter` = `lastLetter` of the newest move, `""` for an empty room.

### Matches (مسابقه، تیمی)
Two teams of 1–5 players each; 1 vs 1 is just two teams of one. The host creates the match
and invites everyone else (their own team-mates and the other team); each invitee accepts or
declines. Team 0 is the host's team and moves first.

- **Start:** the match becomes `active` as soon as nobody is still `invited` and both teams
  have ≥ 1 `joined` player. The host may also `start` early once both teams have a joined
  player; invitees who haven't answered then become `declined`.
- **Turns alternate between teams.** Any `joined` member of the team on turn may answer; the
  first valid verse wins the turn and passes it to the other team with a fresh deadline.
- **Losing:** the team on turn loses when the deadline passes (`timeout`). A player can `leave`
  an active match; the team loses (`resign`) only when it has no joined player left.
- **Search** (`assist`, labelled «جست‌وجو» in the UI) is chosen per match: when off, the server
  rejects picked verses (`{key,from,to}`) with «در این مسابقه جست‌وجو خاموش است.» and clients
  hide the search panel. Search results are only ever shown to the player using it.

```
Player { username, displayName, avatar, accent,
         state,               // "invited" | "joined" | "declined" | "left"
         moveCount }
Team   { players: Player[], moveCount }
Match {
  id, status,              // "pending" | "active" | "finished" | "declined" | "cancelled"
  assist: bool,
  turnSeconds: int,        // 30 | 60 | 180 | 86400
  host: string,            // username of the creator (always in team 0)
  teams: [Team, Team],
  myTeam: int,             // 0 | 1 for the caller, -1 if the caller only declined
  myState: string,         // the caller's Player.state
  turnTeam: int,           // 0 | 1 while active, else -1
  turnDeadline: int,       // ms; 0 unless active
  nextLetter: string,      // "" before the first move
  winnerTeam: int,         // 0 | 1 when finished, else -1
  endReason: string,       // "timeout" | "resign" | ""
  moves: Move[],           // oldest first; in list responses always []
  lastMove: Move | null,
  createdAt, updatedAt,
  now: int                 // server clock, for countdowns
}
```
Timeouts are applied lazily on every read or write of the match (and in the list).

| Method & path | In | Out | Notes |
|---|---|---|---|
| `POST /matches` | `{opponents: string[], allies: string[], assist, turnSeconds}` | `201 {match}` | `opponents` 1–5, `allies` 0–4 (team-mates besides the host); all distinct public users, not yourself. `404` «کاربر «x» پیدا نشد.» for an unknown/private one; `400` bad sizes, duplicates, yourself, bad turnSeconds; `409` more than 5 pending matches hosted. A legacy `opponent` string is read as `opponents: [opponent]` |
| `GET /matches` | — | `{matches, invites, yourTurn}` | matches I'm in (any state but `declined`): all pending + active, plus the last 20 ended; newest `updatedAt` first. `invites` = pending where I'm `invited`; `yourTurn` = active where my team is on turn and I'm `joined` |
| `GET /matches/{id}?after={moveId}` | — | `{match}` | players only, including declined ones (`404` otherwise). With `after`, `moves` holds only newer moves. Poll every 2 s while pending or active |
| `POST /matches/{id}/accept` | — | `{match}` | invited → joined; may start the match |
| `POST /matches/{id}/decline` | — | `{match}` | invited → declined; if a team is left with nobody joined or invited, the match becomes `declined` |
| `POST /matches/{id}/start` | — | `{match}` | host, pending, both teams have a joined player → active |
| `POST /matches/{id}/cancel` | — | `{match}` | host, pending → cancelled |
| `POST /matches/{id}/leave` | — | `{match}` | joined, active → left (alias: `/resign`) |
| `POST /matches/{id}/moves` | verse input | `201 {match}` | a joined player of the team on turn, before the deadline; `409` «نوبت تیم شما نیست.»; `409` «زمان نوبت تمام شده است.» |

---

## 7. Storage (SQLite, created with `CREATE TABLE IF NOT EXISTS`)

```
reads(user_id, poem_key, day, read_at, PRIMARY KEY(user_id, poem_key, day))
badges(user_id, badge_key, earned_at, PRIMARY KEY(user_id, badge_key))
quotes(id, user_id, poem_key, href, poet_name, poem_title, line_from, line_to, lines, created_at)   -- lines = JSON array
public_moves(id, user_id, lines, norm, first_letter, last_letter, poem_key, href, poet_name, poem_title, created_at)
matches(id, host_id, status, assist, turn_seconds, turn_team, turn_deadline, winner_team, end_reason, created_at, updated_at)
match_players(match_id, user_id, team, state, move_count, joined_at, PRIMARY KEY(match_id, user_id))
match_moves(id, match_id, user_id, lines, norm, first_letter, last_letter, poem_key, href, poet_name, poem_title, created_at)
users += bio, banner, accent, background
```
All `user_id` columns reference `users(id) ON DELETE CASCADE`.

New environment variable for the Go service: `POEMS_API_URL` (the Next app's origin).
