package main

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

// Reading streak and badges. A "day" is a calendar day in Asia/Tehran written
// YYYY-MM-DD; the client reports each poem it showed long enough (POST /read).

const progressSchema = `
CREATE TABLE IF NOT EXISTS reads (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	poem_key TEXT NOT NULL,
	day TEXT NOT NULL,
	read_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, poem_key, day)
);
CREATE TABLE IF NOT EXISTS badges (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	badge_key TEXT NOT NULL,
	earned_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, badge_key)
);
`

func init() { featureSchemas = append(featureSchemas, progressSchema) }

const (
	maxReadsPerDay = 300
	// How many days (today included) Streak.Days covers.
	streakWindowDays = 28
	dayLayout        = "2006-01-02"
)

// Iran has no daylight saving time since 2022, so a fixed offset is a safe
// fallback if the zone database is missing.
var tehran = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Tehran"); err == nil {
		return loc
	}
	return time.FixedZone("Asia/Tehran", 3*3600+1800)
}()

// Badge is one catalog entry; EarnedAt is 0 in the catalog itself.
type Badge struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Tier        int    `json:"tier"`
	EarnedAt    int64  `json:"earnedAt"`
}

// badgeRule is a streak badge: awarded once the current streak reaches Streak.
type badgeRule struct {
	Badge
	Streak int
}

var badgeRules = []badgeRule{
	{Badge{Key: "streak-3", Title: "سه روز پیاپی", Description: "سه روز پشت سر هم شعر خواندید.", Icon: "sprout", Tier: 1}, 3},
	{Badge{Key: "streak-7", Title: "یک هفته شعر", Description: "هفت روز پشت سر هم شعر خواندید.", Icon: "flame", Tier: 2}, 7},
	{Badge{Key: "streak-30", Title: "یک ماه شعر", Description: "سی روز پشت سر هم شعر خواندید.", Icon: "moon", Tier: 3}, 30},
	{Badge{Key: "streak-100", Title: "صد روز شعر", Description: "صد روز پشت سر هم شعر خواندید.", Icon: "star", Tier: 4}, 100},
	{Badge{Key: "streak-365", Title: "یک سال شعر", Description: "یک سال تمام هر روز شعر خواندید.", Icon: "crown", Tier: 5}, 365},
}

func badgeByKey(key string) (Badge, bool) {
	for _, rule := range badgeRules {
		if rule.Key == key {
			return rule.Badge, true
		}
	}
	return Badge{}, false
}

// Streak is the reading streak as the client shows it.
type Streak struct {
	// Consecutive days ending today, or yesterday while today has no read yet.
	Current int `json:"current"`
	// Longest run ever.
	Best int `json:"best"`
	// Whether today already counts.
	Today bool `json:"today"`
	// Distinct (poem, day) reads ever.
	TotalPoems int `json:"totalPoems"`
	// Days with a read among the last 28, oldest first.
	Days []string `json:"days"`
}

// ProfileStreak is the part of a Streak a public profile shows.
type ProfileStreak struct {
	Current int  `json:"current"`
	Best    int  `json:"best"`
	Today   bool `json:"today"`
}

// dayOf is the Tehran calendar day of t.
func dayOf(t time.Time) string { return t.In(tehran).Format(dayLayout) }

// shiftDay moves a YYYY-MM-DD day by n days. Days are plain dates, so the
// arithmetic runs in UTC and never meets a daylight-saving jump.
func shiftDay(day string, n int) string {
	t, err := time.Parse(dayLayout, day)
	if err != nil {
		return day
	}
	return t.AddDate(0, 0, n).Format(dayLayout)
}

// computeStreak derives a Streak from the distinct days with a read, sorted
// ascending, the number of reads ever and today's day.
func computeStreak(days []string, total int, today string) Streak {
	st := Streak{TotalPoems: total, Days: []string{}}
	have := make(map[string]bool, len(days))
	for _, d := range days {
		have[d] = true
	}
	st.Today = have[today]

	start := today
	if !st.Today {
		start = shiftDay(today, -1)
	}
	for d := start; have[d]; d = shiftDay(d, -1) {
		st.Current++
	}

	run, prev := 0, ""
	for _, d := range days {
		if prev != "" && shiftDay(prev, 1) == d {
			run++
		} else {
			run = 1
		}
		st.Best = max(st.Best, run)
		prev = d
	}

	oldest := shiftDay(today, -(streakWindowDays - 1))
	for _, d := range days {
		if d >= oldest && d <= today {
			st.Days = append(st.Days, d)
		}
	}
	return st
}

// querier is what *sql.DB and *sql.Tx share, so the helpers below work in both.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Store) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func loadStreak(ctx context.Context, q querier, userID int64, today string) (Streak, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT day, COUNT(*) FROM reads WHERE user_id = ? GROUP BY day ORDER BY day`, userID)
	if err != nil {
		return Streak{}, err
	}
	defer rows.Close()
	var days []string
	total := 0
	for rows.Next() {
		var day string
		var n int
		if err := rows.Scan(&day, &n); err != nil {
			return Streak{}, err
		}
		days = append(days, day)
		total += n
	}
	if err := rows.Err(); err != nil {
		return Streak{}, err
	}
	return computeStreak(days, total, today), nil
}

// loadBadges returns the badges a user earned, newest first.
func loadBadges(ctx context.Context, q querier, userID int64) ([]Badge, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT badge_key, earned_at FROM badges WHERE user_id = ?
		ORDER BY earned_at DESC, rowid DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	badges := []Badge{}
	for rows.Next() {
		var key string
		var earnedAt int64
		if err := rows.Scan(&key, &earnedAt); err != nil {
			return nil, err
		}
		// A badge whose rule was dropped from the catalog is kept in the table
		// but no longer shown.
		if badge, ok := badgeByKey(key); ok {
			badge.EarnedAt = earnedAt
			badges = append(badges, badge)
		}
	}
	return badges, rows.Err()
}

// progress is the signed-in user's streak and earned badges.
func (s *Store) progress(ctx context.Context, userID int64) (Streak, []Badge, error) {
	streak, err := loadStreak(ctx, s.db, userID, dayOf(s.clock()))
	if err != nil {
		return Streak{}, nil, err
	}
	badges, err := loadBadges(ctx, s.db, userID)
	return streak, badges, err
}

// fillProgress adds the streak and badges a public profile shows.
func (s *Store) fillProgress(ctx context.Context, p *PublicProfile, userID int64) error {
	streak, badges, err := s.progress(ctx, userID)
	if err != nil {
		return err
	}
	p.Streak = ProfileStreak{Current: streak.Current, Best: streak.Best, Today: streak.Today}
	p.Badges = badges
	return nil
}

// recordRead stores one read (once per poem per day, at most maxReadsPerDay a
// day) and awards the badges the new streak reaches.
func (s *Store) recordRead(ctx context.Context, userID int64, key string) (Streak, []Badge, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Streak{}, nil, err
	}
	defer tx.Rollback()

	now := s.clock()
	today := dayOf(now)
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM reads WHERE user_id = ? AND day = ?`, userID, today).Scan(&count); err != nil {
		return Streak{}, nil, err
	}
	if count < maxReadsPerDay {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO reads (user_id, poem_key, day, read_at) VALUES (?, ?, ?, ?)`,
			userID, key, today, now.UnixMilli()); err != nil {
			return Streak{}, nil, err
		}
	}
	streak, err := loadStreak(ctx, tx, userID, today)
	if err != nil {
		return Streak{}, nil, err
	}

	earned := []Badge{}
	for _, rule := range badgeRules {
		if streak.Current < rule.Streak {
			continue
		}
		res, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO badges (user_id, badge_key, earned_at) VALUES (?, ?, ?)`,
			userID, rule.Key, now.UnixMilli())
		if err != nil {
			return Streak{}, nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			badge := rule.Badge
			badge.EarnedAt = now.UnixMilli()
			earned = append(earned, badge)
		}
	}
	return streak, earned, tx.Commit()
}

func (s *server) handleRead(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var in struct {
		Key string `json:"key"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !poemKeyPattern.MatchString(in.Key) {
		writeError(w, http.StatusBadRequest, "شعر نامعتبر است.")
		return
	}
	streak, newBadges, err := s.store.recordRead(r.Context(), user.ID, in.Key)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"streak": streak, "newBadges": newBadges})
}

// handleCatalog lists what can be earned or picked; no session needed.
func (s *server) handleCatalog(w http.ResponseWriter, _ *http.Request) {
	badges := make([]Badge, len(badgeRules))
	for i, rule := range badgeRules {
		badges[i] = rule.Badge
	}
	writeJSON(w, http.StatusOK, map[string]any{"badges": badges, "banners": bannerCatalog()})
}
