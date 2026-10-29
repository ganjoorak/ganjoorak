package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// Private team matches (1 vs 1 is two teams of one). A match is changed only
// through the Store methods below, each in one transaction that first applies a
// missed deadline.

const (
	matchPending   = "pending"
	matchActive    = "active"
	matchFinished  = "finished"
	matchDeclined  = "declined"
	matchCancelled = "cancelled"

	playerInvited  = "invited"
	playerJoined   = "joined"
	playerDeclined = "declined"
	playerLeft     = "left"

	maxPendingInvites  = 5
	recentEndedMatches = 20
	maxTeamSize        = 5
)

var validTurnSeconds = map[int]bool{30: true, 60: true, 180: true, 86400: true}

const (
	matchNotFoundMessage      = "این مسابقه پیدا نشد."
	matchSelfMessage          = "نمی‌توانید خودتان را دعوت کنید."
	matchTurnSecondsText      = "زمان هر نوبت درست نیست."
	matchOpponentsSizeMessage = "تیم مقابل باید یک تا ۵ نفر باشد."
	matchAlliesSizeMessage    = "هم‌تیمی‌ها (جز شما) باید حداکثر ۴ نفر باشند."
	matchDuplicateMessage     = "یک نفر را نمی‌توان دو بار دعوت کرد."
	matchInviteCapMessage     = "حداکثر ۵ دعوتِ بی‌پاسخ می‌توانید بفرستید."
	matchNotYourTurn          = "نوبت تیم شما نیست."
	matchTimedOutMessage      = "زمان نوبت تمام شده است."
	matchOverMessage          = "این مسابقه تمام شده است."
	matchNotActiveMessage     = "این مسابقه فعال نیست."
	matchInviteGoneMessage    = "این دعوت دیگر معتبر نیست."
	matchAnsweredMessage      = "به این دعوت قبلاً پاسخ داده‌اید."
	matchNotHostMessage       = "فقط میزبان می‌تواند دعوت را پس بگیرد."
	matchNotHostStartMessage  = "فقط میزبان می‌تواند مسابقه را شروع کند."
	matchNeedBothMessage      = "برای شروع، از هر دو تیم دست‌کم یک نفر باید پذیرفته باشد."
	matchNotJoinedMessage     = "شما در این مسابقه حضور ندارید."
)

func userNotFoundMessage(username string) string {
	return fmt.Sprintf("کاربر «%s» پیدا نشد.", username)
}

type Player struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Accent      string `json:"accent"`
	State       string `json:"state"`
	MoveCount   int    `json:"moveCount"`
}

type Team struct {
	Players   []Player `json:"players"`
	MoveCount int      `json:"moveCount"`
}

type Match struct {
	ID           int64   `json:"id"`
	Status       string  `json:"status"`
	Assist       bool    `json:"assist"`
	TurnSeconds  int     `json:"turnSeconds"`
	Host         string  `json:"host"`
	Teams        [2]Team `json:"teams"`
	MyTeam       int     `json:"myTeam"`
	MyState      string  `json:"myState"`
	TurnTeam     int     `json:"turnTeam"`
	TurnDeadline int64   `json:"turnDeadline"`
	NextLetter   string  `json:"nextLetter"`
	WinnerTeam   int     `json:"winnerTeam"`
	EndReason    string  `json:"endReason"`
	Moves        []Move  `json:"moves"`
	LastMove     *Move   `json:"lastMove"`
	CreatedAt    int64   `json:"createdAt"`
	UpdatedAt    int64   `json:"updatedAt"`
	Now          int64   `json:"now"`
}

// matchRow is the matches table row; team columns are -1 for "no team".
type matchRow struct {
	id, hostID           int64
	status               string
	assist               bool
	turnSeconds          int
	turnTeam, winnerTeam int
	turnDeadline         int64
	endReason            string
	createdAt, updatedAt int64
}

const matchColumns = `m.id, m.host_id, m.status, m.assist, m.turn_seconds, m.turn_team,
	m.turn_deadline, m.winner_team, m.end_reason, m.created_at, m.updated_at`

func (m *matchRow) scanTargets() []any {
	return []any{&m.id, &m.hostID, &m.status, &m.assist, &m.turnSeconds, &m.turnTeam,
		&m.turnDeadline, &m.winnerTeam, &m.endReason, &m.createdAt, &m.updatedAt}
}

func (m matchRow) timedOut(nowMs int64) bool {
	return m.status == matchActive && nowMs > m.turnDeadline
}

// member is the caller's own match_players row.
type member struct {
	team  int
	state string
}

// tally counts a match's players per team.
type tally struct{ joined, invited [2]int }

func (t tally) answered() bool   { return t.invited[0]+t.invited[1] == 0 }
func (t tally) bothJoined() bool { return t.joined[0] > 0 && t.joined[1] > 0 }

// collapsed reports a team with nobody joined or invited.
func (t tally) collapsed() bool {
	return t.joined[0]+t.invited[0] == 0 || t.joined[1]+t.invited[1] == 0
}

// --- handlers ------------------------------------------------------------------

func matchID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// afterParam is the optional ?after= move id of a match read.
func afterParam(r *http.Request) int64 {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	return after
}

func normalizeUsernames(names []string) []string {
	out := make([]string, len(names))
	for i, name := range names {
		out[i] = normalizeUsername(name)
	}
	return out
}

// checkTeams applies the size and distinctness rules to the invited usernames,
// returning a user-facing message when they do not hold.
func checkTeams(host string, opponents, allies []string, turnSeconds int) string {
	switch {
	case len(opponents) < 1 || len(opponents) > maxTeamSize:
		return matchOpponentsSizeMessage
	case len(allies) > maxTeamSize-1:
		return matchAlliesSizeMessage
	case !validTurnSeconds[turnSeconds]:
		return matchTurnSecondsText
	}
	seen := map[string]bool{host: true}
	for _, name := range append(append([]string{}, opponents...), allies...) {
		if name == host {
			return matchSelfMessage
		}
		if seen[name] {
			return matchDuplicateMessage
		}
		seen[name] = true
	}
	return ""
}

func (s *server) handleCreateMatch(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var in struct {
		Opponents   []string `json:"opponents"`
		Allies      []string `json:"allies"`
		Opponent    string   `json:"opponent"` // legacy 1 vs 1 form
		Assist      bool     `json:"assist"`
		TurnSeconds int      `json:"turnSeconds"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Opponents) == 0 && in.Opponent != "" {
		in.Opponents = []string{in.Opponent}
	}
	teams := newMatch{
		opponents: normalizeUsernames(in.Opponents), allies: normalizeUsernames(in.Allies),
		assist: in.Assist, turnSeconds: in.TurnSeconds,
	}
	if message := checkTeams(user.Username, teams.opponents, teams.allies, teams.turnSeconds); message != "" {
		writeError(w, http.StatusBadRequest, message)
		return
	}
	id, err := s.store.createMatch(r.Context(), user, teams, s.store.clock())
	if err != nil {
		writeMoshaereError(w, err)
		return
	}
	s.writeMatch(w, r, http.StatusCreated, user, id, 0)
}

func (s *server) handleListMatches(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	matches, err := s.store.listMatches(r.Context(), user.ID, s.store.clock())
	if err != nil {
		internalError(w, err)
		return
	}
	invites, yourTurn := 0, 0
	for _, m := range matches {
		switch {
		case m.Status == matchPending && m.MyState == playerInvited:
			invites++
		case m.Status == matchActive && m.MyState == playerJoined && m.MyTeam == m.TurnTeam:
			yourTurn++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches, "invites": invites, "yourTurn": yourTurn})
}

func (s *server) handleGetMatch(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	id, ok := matchID(r)
	if !ok {
		writeError(w, http.StatusNotFound, matchNotFoundMessage)
		return
	}
	s.writeMatch(w, r, http.StatusOK, user, id, afterParam(r))
}

// writeMatch answers with the match as the user sees it now (after any lazy timeout).
func (s *server) writeMatch(w http.ResponseWriter, r *http.Request, status int, user User, id, after int64) {
	match, err := s.store.matchFor(r.Context(), user.ID, id, after, s.store.clock())
	if err != nil {
		writeMoshaereError(w, err)
		return
	}
	writeJSON(w, status, map[string]any{"match": match})
}

// matchOp changes a match on behalf of a participant.
type matchOp func(st *Store, ctx context.Context, userID, id int64, now time.Time) error

var (
	acceptMatchOp  matchOp = (*Store).acceptMatch
	declineMatchOp matchOp = (*Store).declineMatch
	startMatchOp   matchOp = (*Store).startMatch
	cancelMatchOp  matchOp = (*Store).cancelMatch
	leaveMatchOp   matchOp = (*Store).leaveMatch
)

// handleMatchAction serves the body-less accept/decline/start/cancel/leave posts.
func (s *server) handleMatchAction(op matchOp) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(w, r)
		if !ok {
			return
		}
		id, ok := matchID(r)
		if !ok {
			writeError(w, http.StatusNotFound, matchNotFoundMessage)
			return
		}
		if err := op(s.store, r.Context(), user.ID, id, s.store.clock()); err != nil {
			writeMoshaereError(w, err)
			return
		}
		s.writeMatch(w, r, http.StatusOK, user, id, afterParam(r))
	}
}

func (s *server) handleMatchMove(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	id, ok := matchID(r)
	if !ok {
		writeError(w, http.StatusNotFound, matchNotFoundMessage)
		return
	}
	var in verseRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	// The poem is fetched before the transaction, which holds the only database
	// connection; the transaction checks everything again.
	assist, err := s.store.matchAssist(r.Context(), user.ID, id)
	if err != nil {
		writeMoshaereError(w, err)
		return
	}
	v, ok := s.readVerse(w, r, in, assist)
	if !ok {
		return
	}
	if err := s.store.addMatchMove(r.Context(), user, id, v, s.store.clock()); err != nil {
		writeMoshaereError(w, err)
		return
	}
	s.writeMatch(w, r, http.StatusCreated, user, id, 0)
}

// --- store: reading ------------------------------------------------------------

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return failure(http.StatusNotFound, matchNotFoundMessage)
	}
	return err
}

// isPlayer is an SQL condition (user id as ?1, match alias m) for "has a seat in the match".
const isPlayer = `EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = ?1`

// matchAssist reports whether the match allows picked verses; 404 for non-players.
func (st *Store) matchAssist(ctx context.Context, userID, id int64) (bool, error) {
	var assist bool
	err := st.db.QueryRowContext(ctx,
		`SELECT m.assist FROM matches m WHERE m.id = ?2 AND `+isPlayer+`)`, userID, id).Scan(&assist)
	return assist, notFound(err)
}

// lockMatch loads a match for one of its players (404 for anyone else, declined
// players included) and applies a missed deadline, reporting whether it just did.
func lockMatch(ctx context.Context, tx *sql.Tx, userID, id int64, now time.Time) (m matchRow, me member, expired bool, err error) {
	err = tx.QueryRowContext(ctx, `SELECT `+matchColumns+` FROM matches m WHERE m.id = ?`, id).Scan(m.scanTargets()...)
	if err != nil {
		return m, me, false, notFound(err)
	}
	err = tx.QueryRowContext(ctx, `SELECT team, state FROM match_players WHERE match_id = ? AND user_id = ?`, id, userID).
		Scan(&me.team, &me.state)
	if err != nil {
		return m, me, false, notFound(err)
	}
	if m.timedOut(now.UnixMilli()) {
		return m, me, true, finishByTimeout(ctx, tx, &m)
	}
	return m, me, false, nil
}

// finish ends a match with the given winner, as of at.
func finish(ctx context.Context, tx *sql.Tx, m *matchRow, winnerTeam int, reason string, at int64) error {
	m.status, m.winnerTeam, m.endReason, m.updatedAt = matchFinished, winnerTeam, reason, at
	m.turnTeam, m.turnDeadline = -1, 0
	_, err := tx.ExecContext(ctx, `
		UPDATE matches SET status = 'finished', winner_team = ?, end_reason = ?, turn_team = -1,
			turn_deadline = 0, updated_at = ? WHERE id = ?`, winnerTeam, reason, at, m.id)
	return err
}

// finishByTimeout ends an active match whose team on turn ran out of time: the
// other team wins, as of the deadline.
func finishByTimeout(ctx context.Context, tx *sql.Tx, m *matchRow) error {
	return finish(ctx, tx, m, 1-m.turnTeam, "timeout", m.turnDeadline)
}

// matchFor is one match as its player sees it; with after, only newer moves.
func (st *Store) matchFor(ctx context.Context, userID, id, after int64, now time.Time) (Match, error) {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return Match{}, err
	}
	defer tx.Rollback()
	m, _, _, err := lockMatch(ctx, tx, userID, id, now)
	if err != nil {
		return Match{}, err
	}
	match, err := buildMatch(ctx, tx, m, userID, after, true, now)
	if err != nil {
		return Match{}, err
	}
	return match, tx.Commit()
}

// listMatches are the user's pending and active matches plus the latest ended
// ones (matches they declined are left out), newest first, without their moves.
func (st *Store) listMatches(ctx context.Context, userID int64, now time.Time) ([]Match, error) {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	const visible = ` AND ` + isPlayer + ` AND p.state != 'declined')`
	overdue, err := selectMatchRows(ctx, tx, `
		SELECT `+matchColumns+` FROM matches m
		WHERE m.status = 'active' AND m.turn_deadline < ?2`+visible, userID, now.UnixMilli())
	if err != nil {
		return nil, err
	}
	for i := range overdue {
		if err := finishByTimeout(ctx, tx, &overdue[i]); err != nil {
			return nil, err
		}
	}
	rows, err := selectMatchRows(ctx, tx, `
		SELECT `+matchColumns+` FROM matches m WHERE m.status IN ('pending', 'active')`+visible, userID)
	if err != nil {
		return nil, err
	}
	ended, err := selectMatchRows(ctx, tx, `
		SELECT `+matchColumns+` FROM matches m WHERE m.status IN ('finished', 'declined', 'cancelled')`+visible+`
		ORDER BY m.updated_at DESC, m.id DESC LIMIT ?2`, userID, recentEndedMatches)
	if err != nil {
		return nil, err
	}
	rows = append(rows, ended...)
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].updatedAt != rows[j].updatedAt {
			return rows[i].updatedAt > rows[j].updatedAt
		}
		return rows[i].id > rows[j].id
	})
	matches := make([]Match, 0, len(rows))
	for _, m := range rows {
		match, err := buildMatch(ctx, tx, m, userID, 0, false, now)
		if err != nil {
			return nil, err
		}
		matches = append(matches, match)
	}
	return matches, tx.Commit()
}

func selectMatchRows(ctx context.Context, q moshaereDB, query string, args ...any) ([]matchRow, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []matchRow
	for rows.Next() {
		var m matchRow
		if err := rows.Scan(m.scanTargets()...); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// teamTally counts the players of a match by team and state.
func teamTally(ctx context.Context, q moshaereDB, id int64) (tally, error) {
	var t tally
	rows, err := q.QueryContext(ctx, `
		SELECT team, state, COUNT(*) FROM match_players WHERE match_id = ? GROUP BY team, state`, id)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	for rows.Next() {
		var team, n int
		var state string
		if err := rows.Scan(&team, &state, &n); err != nil {
			return t, err
		}
		switch state {
		case playerJoined:
			t.joined[team] = n
		case playerInvited:
			t.invited[team] = n
		}
	}
	return t, rows.Err()
}

// readPlayers fills the teams of match (and the host and the caller's seat) from
// match_players, the host first and the others in invitation order.
func readPlayers(ctx context.Context, q moshaereDB, match *Match, hostID, userID int64) error {
	rows, err := q.QueryContext(ctx, `
		SELECT u.id, u.username, u.display_name, u.avatar, u.accent, p.team, p.state, p.move_count
		FROM match_players p JOIN users u ON u.id = p.user_id
		WHERE p.match_id = ? ORDER BY p.team, p.rowid`, match.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var team int
		var p Player
		if err := rows.Scan(&id, &p.Username, &p.DisplayName, &p.Avatar, &p.Accent, &team, &p.State, &p.MoveCount); err != nil {
			return err
		}
		match.Teams[team].Players = append(match.Teams[team].Players, p)
		match.Teams[team].MoveCount += p.MoveCount
		if id == hostID {
			match.Host = p.Username
		}
		if id == userID {
			match.MyState = p.State
			// Someone who only declined belongs to neither team.
			if p.State != playerDeclined {
				match.MyTeam = team
			}
		}
	}
	return rows.Err()
}

// buildMatch assembles the JSON view of a match for a player: teams with move
// counts, the last move, and (when withMoves) the moves newer than after.
func buildMatch(ctx context.Context, q moshaereDB, m matchRow, userID, after int64, withMoves bool, now time.Time) (Match, error) {
	match := Match{
		ID: m.id, Status: m.status, Assist: m.assist, TurnSeconds: m.turnSeconds, MyTeam: -1,
		Teams:    [2]Team{{Players: []Player{}}, {Players: []Player{}}},
		TurnTeam: m.turnTeam, TurnDeadline: m.turnDeadline, WinnerTeam: m.winnerTeam, EndReason: m.endReason,
		Moves: []Move{}, CreatedAt: m.createdAt, UpdatedAt: m.updatedAt, Now: now.UnixMilli(),
	}
	if err := readPlayers(ctx, q, &match, m.hostID, userID); err != nil {
		return Match{}, err
	}
	last, err := scanMoves(q.QueryContext(ctx, `
		SELECT `+moveColumns+` FROM match_moves m JOIN users u ON u.id = m.user_id
		WHERE m.match_id = ? ORDER BY m.id DESC LIMIT 1`, m.id))
	if err != nil {
		return Match{}, err
	}
	if len(last) > 0 {
		match.LastMove, match.NextLetter = &last[0], last[0].LastLetter
	}
	if withMoves {
		match.Moves, err = scanMoves(q.QueryContext(ctx, `
			SELECT `+moveColumns+` FROM match_moves m JOIN users u ON u.id = m.user_id
			WHERE m.match_id = ? AND m.id > ? ORDER BY m.id`, m.id, after))
	}
	return match, err
}

// --- store: changing -----------------------------------------------------------

// transition runs fn on a player's match inside one transaction. A deadline
// applied on the way is kept even when fn then refuses.
func (st *Store) transition(ctx context.Context, userID, id int64, now time.Time, fn func(tx *sql.Tx, m *matchRow, me member, expired bool) error) error {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	m, me, expired, err := lockMatch(ctx, tx, userID, id, now)
	if err != nil {
		return err
	}
	if err := fn(tx, &m, me, expired); err != nil {
		if expired {
			_ = tx.Commit()
		}
		return err
	}
	return tx.Commit()
}

// newMatch is a validated create request: usernames are normalized and distinct.
type newMatch struct {
	opponents, allies []string // allies are the host's team-mates besides the host
	assist            bool
	turnSeconds       int
}

// publicUserID finds a public account by username, or answers 404 naming it.
func publicUserID(ctx context.Context, tx *sql.Tx, username string) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ? AND is_public = 1`, username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, failure(http.StatusNotFound, userNotFoundMessage(username))
	}
	return id, err
}

func (st *Store) createMatch(ctx context.Context, host User, in newMatch, now time.Time) (int64, error) {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	// The first unknown or private username is the one named; opponents come first.
	var opponentIDs, allyIDs []int64
	for _, group := range []struct {
		names []string
		ids   *[]int64
	}{{in.opponents, &opponentIDs}, {in.allies, &allyIDs}} {
		for _, name := range group.names {
			id, err := publicUserID(ctx, tx, name)
			if err != nil {
				return 0, err
			}
			*group.ids = append(*group.ids, id)
		}
	}
	var pending int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM matches WHERE host_id = ? AND status = 'pending'`, host.ID).Scan(&pending); err != nil {
		return 0, err
	}
	if pending >= maxPendingInvites {
		return 0, failure(http.StatusConflict, matchInviteCapMessage)
	}
	nowMs := now.UnixMilli()
	res, err := tx.ExecContext(ctx, `
		INSERT INTO matches (host_id, status, assist, turn_seconds, created_at, updated_at)
		VALUES (?, 'pending', ?, ?, ?, ?)`, host.ID, in.assist, in.turnSeconds, nowMs, nowMs)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	seat := func(userID int64, team int, state string) error {
		joinedAt := int64(0)
		if state == playerJoined {
			joinedAt = nowMs
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO match_players (match_id, user_id, team, state, joined_at) VALUES (?, ?, ?, ?, ?)`,
			id, userID, team, state, joinedAt)
		return err
	}
	if err := seat(host.ID, 0, playerJoined); err != nil {
		return 0, err
	}
	for team, ids := range [][]int64{allyIDs, opponentIDs} {
		for _, userID := range ids {
			if err := seat(userID, team, playerInvited); err != nil {
				return 0, err
			}
		}
	}
	return id, tx.Commit()
}

// requirePending refuses a pending-only action on a match that has moved on.
func requirePending(m *matchRow) error {
	if m.status != matchPending {
		return failure(http.StatusConflict, matchInviteGoneMessage)
	}
	return nil
}

// touch records that the match changed.
func touch(ctx context.Context, tx *sql.Tx, id, now int64) error {
	_, err := tx.ExecContext(ctx, `UPDATE matches SET updated_at = ? WHERE id = ?`, now, id)
	return err
}

// activate starts a pending match: team 0 is on turn, and invitees who never
// answered are out.
func activate(ctx context.Context, tx *sql.Tx, m *matchRow, now time.Time) error {
	nowMs := now.UnixMilli()
	if _, err := tx.ExecContext(ctx, `UPDATE match_players SET state = 'declined' WHERE match_id = ? AND state = 'invited'`, m.id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE matches SET status = 'active', turn_team = 0, turn_deadline = ?, updated_at = ? WHERE id = ?`,
		nowMs+int64(m.turnSeconds)*1000, nowMs, m.id)
	return err
}

// settleInvites applies the consequences of an answered invite: a team nobody
// is left in ends the match, and the last answer starts it.
func settleInvites(ctx context.Context, tx *sql.Tx, m *matchRow, now time.Time) error {
	t, err := teamTally(ctx, tx, m.id)
	if err != nil {
		return err
	}
	switch {
	case t.collapsed():
		_, err = tx.ExecContext(ctx, `UPDATE matches SET status = 'declined', updated_at = ? WHERE id = ?`, now.UnixMilli(), m.id)
		return err
	case t.answered() && t.bothJoined():
		return activate(ctx, tx, m, now)
	}
	return touch(ctx, tx, m.id, now.UnixMilli())
}

// answerInvite turns the caller's invitation into state and settles the match.
func (st *Store) answerInvite(ctx context.Context, userID, id int64, now time.Time, state string) error {
	return st.transition(ctx, userID, id, now, func(tx *sql.Tx, m *matchRow, me member, _ bool) error {
		if err := requirePending(m); err != nil {
			return err
		}
		if me.state != playerInvited {
			return failure(http.StatusConflict, matchAnsweredMessage)
		}
		joinedAt := int64(0)
		if state == playerJoined {
			joinedAt = now.UnixMilli()
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE match_players SET state = ?, joined_at = ? WHERE match_id = ? AND user_id = ?`, state, joinedAt, id, userID)
		if err != nil {
			return err
		}
		return settleInvites(ctx, tx, m, now)
	})
}

func (st *Store) acceptMatch(ctx context.Context, userID, id int64, now time.Time) error {
	return st.answerInvite(ctx, userID, id, now, playerJoined)
}

func (st *Store) declineMatch(ctx context.Context, userID, id int64, now time.Time) error {
	return st.answerInvite(ctx, userID, id, now, playerDeclined)
}

// startMatch lets the host open a pending match before everyone has answered.
func (st *Store) startMatch(ctx context.Context, userID, id int64, now time.Time) error {
	return st.transition(ctx, userID, id, now, func(tx *sql.Tx, m *matchRow, _ member, _ bool) error {
		if userID != m.hostID {
			return failure(http.StatusForbidden, matchNotHostStartMessage)
		}
		if err := requirePending(m); err != nil {
			return err
		}
		t, err := teamTally(ctx, tx, id)
		if err != nil {
			return err
		}
		if !t.bothJoined() {
			return failure(http.StatusConflict, matchNeedBothMessage)
		}
		return activate(ctx, tx, m, now)
	})
}

func (st *Store) cancelMatch(ctx context.Context, userID, id int64, now time.Time) error {
	return st.transition(ctx, userID, id, now, func(tx *sql.Tx, m *matchRow, _ member, _ bool) error {
		if userID != m.hostID {
			return failure(http.StatusForbidden, matchNotHostMessage)
		}
		if err := requirePending(m); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE matches SET status = 'cancelled', updated_at = ? WHERE id = ?`, now.UnixMilli(), id)
		return err
	})
}

// leaveMatch takes a joined player out of an active match; the team loses only
// when nobody on it is left.
func (st *Store) leaveMatch(ctx context.Context, userID, id int64, now time.Time) error {
	return st.transition(ctx, userID, id, now, func(tx *sql.Tx, m *matchRow, me member, _ bool) error {
		if m.status != matchActive {
			if m.status == matchFinished {
				return failure(http.StatusConflict, matchOverMessage)
			}
			return failure(http.StatusConflict, matchNotActiveMessage)
		}
		if me.state != playerJoined {
			return failure(http.StatusConflict, matchNotJoinedMessage)
		}
		_, err := tx.ExecContext(ctx, `UPDATE match_players SET state = 'left' WHERE match_id = ? AND user_id = ?`, id, userID)
		if err != nil {
			return err
		}
		t, err := teamTally(ctx, tx, id)
		if err != nil {
			return err
		}
		if t.joined[me.team] == 0 {
			return finish(ctx, tx, m, 1-me.team, "resign", now.UnixMilli())
		}
		return touch(ctx, tx, id, now.UnixMilli())
	})
}

func (st *Store) addMatchMove(ctx context.Context, user User, id int64, v verse, now time.Time) error {
	return st.transition(ctx, user.ID, id, now, func(tx *sql.Tx, m *matchRow, me member, expired bool) error {
		if expired && m.winnerTeam != me.team {
			return failure(http.StatusConflict, matchTimedOutMessage)
		}
		if m.status == matchFinished {
			return failure(http.StatusConflict, matchOverMessage)
		}
		if m.status != matchActive {
			return failure(http.StatusConflict, matchNotActiveMessage)
		}
		if me.state != playerJoined || me.team != m.turnTeam {
			return failure(http.StatusConflict, matchNotYourTurn)
		}
		var next string
		err := tx.QueryRowContext(ctx, `SELECT last_letter FROM match_moves WHERE match_id = ? ORDER BY id DESC LIMIT 1`, id).Scan(&next)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		// The first move of a match may start with any letter.
		if next != "" && v.first != next {
			return failure(http.StatusBadRequest, wrongLetterMessage(next))
		}
		var seen int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM match_moves WHERE match_id = ? AND norm = ?`, id, v.norm).Scan(&seen); err != nil {
			return err
		}
		if seen > 0 {
			return failure(http.StatusBadRequest, repeatedVerseMessage)
		}
		lines, err := json.Marshal(v.lines)
		if err != nil {
			return err
		}
		nowMs := now.UnixMilli()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO match_moves (match_id, user_id, lines, norm, first_letter, last_letter, poem_key, href, poet_name, poem_title, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, user.ID, string(lines), v.norm, v.first, v.last, v.poemKey, v.href, v.poet, v.poemTitle, nowMs); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE match_players SET move_count = move_count + 1 WHERE match_id = ? AND user_id = ?`, id, user.ID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE matches SET turn_team = ?, turn_deadline = ?, updated_at = ? WHERE id = ?`,
			1-me.team, nowMs+int64(m.turnSeconds)*1000, nowMs, id)
		return err
	})
}
