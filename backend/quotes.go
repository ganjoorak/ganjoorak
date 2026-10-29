package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// Quotes: lines a reader picked from a poem and put on their profile. The
// text is cut from the real poem (PoemSource), never taken from the client.

const quotesSchema = `
CREATE TABLE IF NOT EXISTS quotes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	poem_key TEXT NOT NULL,
	href TEXT NOT NULL,
	poet_name TEXT NOT NULL,
	poem_title TEXT NOT NULL,
	line_from INTEGER NOT NULL,
	line_to INTEGER NOT NULL,
	lines TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quotes_user ON quotes(user_id, created_at);
`

func init() { featureSchemas = append(featureSchemas, quotesSchema) }

const (
	maxQuoteLines     = 8
	maxQuotesPerDay   = 20
	maxQuotesKept     = 500
	quotesPageSize    = 20
	storyWindow       = 7 * 24 * time.Hour
	maxStoryQuotes    = 10
	maxStoryPeople    = 50
	quotesPoemDownMsg = "سرویس شعر در دسترس نیست. کمی بعد دوباره امتحان کنید."
)

var errQuoteDailyLimit = errors.New("daily quote limit reached")

const (
	quoteBadKeyMessage   = "شعر نامعتبر است."
	quoteBadRangeMessage = "بخش انتخاب‌شده معتبر نیست؛ حداکثر ۸ مصراع را می‌توان انتخاب کرد."
	quotePoemMissing     = "این شعر پیدا نشد."
	quoteMissingMessage  = "این نقل پیدا نشد."
	quoteLimitMessage    = "سقف ۲۰ نقل در روز پر شده است؛ فردا دوباره امتحان کنید."
)

// Quote is one shared fragment: From and To are inclusive, 0-based indices
// into the poem's lines (/api/poem-lines).
type Quote struct {
	ID        int64    `json:"id"`
	Key       string   `json:"key"`
	Href      string   `json:"href"`
	PoetName  string   `json:"poetName"`
	PoemTitle string   `json:"poemTitle"`
	From      int      `json:"from"`
	To        int      `json:"to"`
	Lines     []string `json:"lines"`
	CreatedAt int64    `json:"createdAt"`
}

// StoryPerson is a followed account with recent quotes, as the stories row shows it.
type StoryPerson struct {
	User     StoryUser `json:"user"`
	Quotes   []Quote   `json:"quotes"`
	LatestAt int64     `json:"latestAt"`
}

type StoryUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Accent      string `json:"accent"`
}

const quoteColumns = `q.id, q.poem_key, q.href, q.poet_name, q.poem_title, q.line_from, q.line_to, q.lines, q.created_at`

type rowScanner interface{ Scan(dest ...any) error }

// scanQuote reads quoteColumns, plus any extra destinations scanned before them.
func scanQuote(row rowScanner, before ...any) (Quote, error) {
	var q Quote
	var lines string
	dest := append(before, &q.ID, &q.Key, &q.Href, &q.PoetName, &q.PoemTitle, &q.From, &q.To, &lines, &q.CreatedAt)
	if err := row.Scan(dest...); err != nil {
		return Quote{}, err
	}
	if err := json.Unmarshal([]byte(lines), &q.Lines); err != nil {
		return Quote{}, err
	}
	if q.Lines == nil {
		q.Lines = []string{}
	}
	return q, nil
}

// startOfDay is midnight of t's Tehran calendar day.
func startOfDay(t time.Time) time.Time {
	t = t.In(tehran)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, tehran)
}

// createQuote stores a quote, or returns the existing one (created false) when
// the same range of the same poem is already there. At most maxQuotesPerDay new
// quotes per Tehran day; only the newest maxQuotesKept are kept.
func (s *Store) createQuote(ctx context.Context, userID int64, poem PoemText, from, to int, lines []string) (q Quote, created bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Quote{}, false, err
	}
	defer tx.Rollback()

	existing, err := scanQuote(tx.QueryRowContext(ctx, `
		SELECT `+quoteColumns+` FROM quotes q
		WHERE q.user_id = ? AND q.poem_key = ? AND q.line_from = ? AND q.line_to = ?
		ORDER BY q.id DESC LIMIT 1`, userID, poem.Key, from, to))
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Quote{}, false, err
	}

	now := s.clock()
	var today int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM quotes WHERE user_id = ? AND created_at >= ?`,
		userID, startOfDay(now).UnixMilli()).Scan(&today); err != nil {
		return Quote{}, false, err
	}
	if today >= maxQuotesPerDay {
		return Quote{}, false, errQuoteDailyLimit
	}

	encoded, err := json.Marshal(lines)
	if err != nil {
		return Quote{}, false, err
	}
	q = Quote{Key: poem.Key, Href: poem.Href, PoetName: poem.PoetName, PoemTitle: poem.Title,
		From: from, To: to, Lines: lines, CreatedAt: now.UnixMilli()}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO quotes (user_id, poem_key, href, poet_name, poem_title, line_from, line_to, lines, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, q.Key, q.Href, q.PoetName, q.PoemTitle, from, to, string(encoded), q.CreatedAt)
	if err != nil {
		return Quote{}, false, err
	}
	if q.ID, err = res.LastInsertId(); err != nil {
		return Quote{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM quotes WHERE user_id = ?1
		AND id NOT IN (SELECT id FROM quotes WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2)`,
		userID, maxQuotesKept); err != nil {
		return Quote{}, false, err
	}
	return q, true, tx.Commit()
}

// deleteQuote reports whether userID owned a quote with that id.
func (s *Store) deleteQuote(ctx context.Context, userID, id int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM quotes WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// userQuotes pages through a user's quotes, newest first. before is the id of
// the last quote of the previous page (0 for the first); next is the id to pass
// as before for the following page, nil on the last one.
func (s *Store) userQuotes(ctx context.Context, userID, before int64, limit int) ([]Quote, *int64, error) {
	if before <= 0 {
		before = 1<<63 - 1
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+quoteColumns+` FROM quotes q
		WHERE q.user_id = ? AND q.id < ? ORDER BY q.id DESC LIMIT ?`, userID, before, limit+1)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	quotes := []Quote{}
	for rows.Next() {
		q, err := scanQuote(rows)
		if err != nil {
			return nil, nil, err
		}
		quotes = append(quotes, q)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var next *int64
	if len(quotes) > limit {
		quotes = quotes[:limit]
		next = &quotes[limit-1].ID
	}
	return quotes, next, nil
}

// fillQuotes adds the newest quotes and the total a public profile shows.
func (s *Store) fillQuotes(ctx context.Context, p *PublicProfile, userID int64) error {
	quotes, _, err := s.userQuotes(ctx, userID, 0, quotesPageSize)
	if err != nil {
		return err
	}
	p.Quotes = quotes
	return s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM quotes WHERE user_id = ?`, userID).Scan(&p.QuoteCount)
}

// followingQuotes groups the last week's quotes of the public accounts userID
// follows by person, most recently quoting first.
func (s *Store) followingQuotes(ctx context.Context, userID int64) ([]StoryPerson, error) {
	since := s.clock().Add(-storyWindow).UnixMilli()
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.username, u.display_name, u.avatar, u.accent, `+quoteColumns+`
		FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn
			FROM quotes
			WHERE created_at >= ?1 AND user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?2)
		) q JOIN users u ON u.id = q.user_id
		WHERE q.rn <= ?3 AND u.is_public = 1
		ORDER BY q.id DESC`, since, userID, maxStoryQuotes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	people := []StoryPerson{}
	index := map[string]int{}
	for rows.Next() {
		var who StoryUser
		q, err := scanQuote(rows, &who.Username, &who.DisplayName, &who.Avatar, &who.Accent)
		if err != nil {
			return nil, err
		}
		i, seen := index[who.Username]
		if !seen {
			i = len(people)
			index[who.Username] = i
			people = append(people, StoryPerson{User: who, Quotes: []Quote{}})
		}
		people[i].Quotes = append(people[i].Quotes, q)
		people[i].LatestAt = max(people[i].LatestAt, q.CreatedAt)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(people, func(a, b int) bool { return people[a].LatestAt > people[b].LatestAt })
	if len(people) > maxStoryPeople {
		people = people[:maxStoryPeople]
	}
	return people, nil
}

// --- handlers ------------------------------------------------------------------

func (s *server) handleCreateQuote(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var in struct {
		Key  string `json:"key"`
		From int    `json:"from"`
		To   int    `json:"to"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !poemKeyPattern.MatchString(in.Key) {
		writeError(w, http.StatusBadRequest, quoteBadKeyMessage)
		return
	}
	poem, err := s.poems.PoemText(r.Context(), in.Key)
	if errors.Is(err, errPoemNotFound) {
		writeError(w, http.StatusNotFound, quotePoemMissing)
		return
	}
	if err != nil {
		// The poem service being down is not our crash.
		log.Printf("accounts: quote poem %s: %v", in.Key, err)
		writeError(w, http.StatusBadGateway, quotesPoemDownMsg)
		return
	}
	lines, ok := poemLines(poem, in.From, in.To, maxQuoteLines)
	if !ok {
		writeError(w, http.StatusBadRequest, quoteBadRangeMessage)
		return
	}
	poem.Key = in.Key
	quote, created, err := s.store.createQuote(r.Context(), user.ID, poem, in.From, in.To, lines)
	if errors.Is(err, errQuoteDailyLimit) {
		writeError(w, http.StatusTooManyRequests, quoteLimitMessage)
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"quote": quote})
}

func (s *server) handleDeleteQuote(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, quoteMissingMessage)
		return
	}
	deleted, err := s.store.deleteQuote(r.Context(), user.ID, id)
	if err != nil {
		internalError(w, err)
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, quoteMissingMessage)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleUserQuotes pages a public profile's quotes; no session needed.
func (s *server) handleUserQuotes(w http.ResponseWriter, r *http.Request) {
	username := normalizeUsername(r.PathValue("username"))
	if !usernamePattern.MatchString(username) {
		writeError(w, http.StatusNotFound, profileNotFoundMessage)
		return
	}
	var before int64
	if raw := r.URL.Query().Get("before"); raw != "" {
		var err error
		if before, err = strconv.ParseInt(raw, 10, 64); err != nil || before < 0 {
			writeError(w, http.StatusBadRequest, "صفحهٔ درخواستی معتبر نیست.")
			return
		}
	}
	// The owner still sees their own quotes while their profile is private.
	var ownerID int64
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		if viewer, err := s.store.userForSession(r.Context(), hashSessionToken(cookie.Value)); err == nil && viewer.Username == username {
			ownerID = viewer.ID
		}
	}
	var userID int64
	err := s.store.db.QueryRowContext(r.Context(),
		`SELECT id FROM users WHERE username = ? AND (is_public = 1 OR id = ?)`, username, ownerID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, profileNotFoundMessage)
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	quotes, next, err := s.store.userQuotes(r.Context(), userID, before, quotesPageSize)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"quotes": quotes, "next": next})
}

func (s *server) handleFollowingQuotes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	people, err := s.store.followingQuotes(r.Context(), user.ID)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"people": people})
}
