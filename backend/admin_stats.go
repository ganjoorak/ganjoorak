package main

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

// The overview's numbers. The service has one database connection, so each
// figure is its own short statement and other requests can run between them.

const trendDays = 30

// Window counts something over the last 1, 7 and 30 Tehran days, today included.
type Window struct {
	Day   int `json:"day"`
	Week  int `json:"week"`
	Month int `json:"month"`
}

// TrendDay is one day of the chart; days without activity are present with zeros.
type TrendDay struct {
	Day     string `json:"day"`
	Signups int    `json:"signups"`
	Active  int    `json:"active"`
	Quotes  int    `json:"quotes"`
	Moves   int    `json:"moves"`
	Matches int    `json:"matches"`
}

type AdminOverview struct {
	Users         int        `json:"users"`
	PublicUsers   int        `json:"publicUsers"`
	BannedUsers   int        `json:"bannedUsers"`
	Staff         int        `json:"staff"`
	Signups       Window     `json:"signups"`
	Active        Window     `json:"active"`
	Quotes        int        `json:"quotes"`
	NewQuotes     Window     `json:"newQuotes"`
	Moves         int        `json:"moves"`
	NewMoves      Window     `json:"newMoves"`
	Matches       int        `json:"matches"`
	ActiveMatches int        `json:"activeMatches"`
	OpenFeedback  int        `json:"openFeedback"`
	Trend         []TrendDay `json:"trend"`
}

// dailyCounts buckets a table's rows by Tehran day over the last trendDays. The
// table name is a constant of the caller. Iran has one fixed offset now, so
// adding it to the timestamp gives the day without a function call per row.
func (st *Store) dailyCounts(ctx context.Context, table string, first time.Time) (map[string]int, error) {
	_, offset := first.In(tehran).Zone()
	const dayMs = 24 * 60 * 60 * 1000
	offsetMs := int64(offset) * 1000
	rows, err := st.db.QueryContext(ctx, `
		SELECT (created_at + ?1) / ?2, COUNT(*) FROM `+table+` WHERE created_at >= ?3 GROUP BY 1`,
		offsetMs, dayMs, first.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var bucket int64
		var count int
		if err := rows.Scan(&bucket, &count); err != nil {
			return nil, err
		}
		counts[time.UnixMilli(bucket*dayMs).UTC().Format(dayLayout)] = count
	}
	return counts, rows.Err()
}

// activeByDay is the number of distinct readers per day from firstDay on.
func (st *Store) activeByDay(ctx context.Context, firstDay string) (map[string]int, error) {
	rows, err := st.db.QueryContext(ctx, `
		SELECT day, COUNT(DISTINCT user_id) FROM reads WHERE day >= ? GROUP BY day`, firstDay)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var day string
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, err
		}
		counts[day] = count
	}
	return counts, rows.Err()
}

func windowOf(trend []TrendDay, value func(TrendDay) int) Window {
	sum := func(days int) int {
		total := 0
		for _, d := range trend[len(trend)-days:] {
			total += value(d)
		}
		return total
	}
	return Window{Day: sum(1), Week: sum(7), Month: sum(trendDays)}
}

func (st *Store) adminOverview(ctx context.Context) (AdminOverview, error) {
	now := st.clock()
	today := dayOf(now)
	firstDay := shiftDay(today, -(trendDays - 1))
	first := startOfDay(now).AddDate(0, 0, -(trendDays - 1))

	var o AdminOverview
	for _, stat := range []struct {
		query string
		dest  *int
	}{
		{`SELECT COUNT(*) FROM users`, &o.Users},
		{`SELECT COUNT(*) FROM users WHERE is_public = 1`, &o.PublicUsers},
		{`SELECT COUNT(*) FROM users WHERE banned_at != 0`, &o.BannedUsers},
		{`SELECT COUNT(*) FROM users WHERE role != ''`, &o.Staff},
		{`SELECT COUNT(*) FROM quotes`, &o.Quotes},
		{`SELECT COUNT(*) FROM public_moves WHERE norm != ''`, &o.Moves},
		{`SELECT COUNT(*) FROM matches`, &o.Matches},
		{`SELECT COUNT(*) FROM feedback WHERE reviewed_at = 0`, &o.OpenFeedback},
	} {
		if err := st.db.QueryRowContext(ctx, stat.query).Scan(stat.dest); err != nil {
			return o, err
		}
	}
	// A match's status is only updated when someone looks at it; the deadline
	// tells which ones are really still running.
	err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM matches WHERE status = ? AND turn_deadline > ?`,
		matchActive, now.UnixMilli()).Scan(&o.ActiveMatches)
	if err != nil {
		return o, err
	}

	signups, err := st.dailyCounts(ctx, "users", first)
	if err != nil {
		return o, err
	}
	quotes, err := st.dailyCounts(ctx, "quotes", first)
	if err != nil {
		return o, err
	}
	moves, err := st.dailyCounts(ctx, "public_moves", first)
	if err != nil {
		return o, err
	}
	matches, err := st.dailyCounts(ctx, "matches", first)
	if err != nil {
		return o, err
	}
	active, err := st.activeByDay(ctx, firstDay)
	if err != nil {
		return o, err
	}

	o.Trend = make([]TrendDay, trendDays)
	for i := range o.Trend {
		day := shiftDay(firstDay, i)
		o.Trend[i] = TrendDay{Day: day, Signups: signups[day], Active: active[day],
			Quotes: quotes[day], Moves: moves[day], Matches: matches[day]}
	}
	o.Signups = windowOf(o.Trend, func(d TrendDay) int { return d.Signups })
	o.NewQuotes = windowOf(o.Trend, func(d TrendDay) int { return d.Quotes })
	o.NewMoves = windowOf(o.Trend, func(d TrendDay) int { return d.Moves })

	// A reader of two days is one active user, so the windows cannot be summed.
	today7, today30 := shiftDay(today, -6), firstDay
	err = st.db.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT user_id) FILTER (WHERE day = ?1),
			COUNT(DISTINCT user_id) FILTER (WHERE day >= ?2),
			COUNT(DISTINCT user_id)
		FROM reads WHERE day >= ?3`, today, today7, today30).Scan(&o.Active.Day, &o.Active.Week, &o.Active.Month)
	return o, err
}

func (s *server) handleAdminOverview(w http.ResponseWriter, r *http.Request, _ User) {
	overview, err := s.store.adminOverview(r.Context())
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"overview": overview})
}

func itoa(n int) string { return strconv.Itoa(n) }
