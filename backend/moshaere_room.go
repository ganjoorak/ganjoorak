package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

// The public room: one chain of verses any public account can extend.

const (
	roomPageSize      = 50
	roomPollLimit     = 200
	roomRepeatWindow  = 500
	roomMoveGap       = 10 * time.Second
	roomLeadersWindow = 7 * 24 * time.Hour
	roomLeaderCount   = 10
)

const (
	roomPrivateMessage = "برای مشاعرهٔ عمومی باید نمایه‌تان عمومی باشد."
	roomWaitMessage    = "صبر کنید کس دیگری بیتی بخواند."
	roomTooFastMessage = "کمی صبر کنید؛ هر ۱۰ ثانیه یک بیت می‌شود خواند."
)

type Leader struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Count       int    `json:"count"`
}

func (s *server) handlePublicRoom(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	moves, nextLetter, leaders, err := s.store.publicRoom(r.Context(), after, s.store.clock())
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"moves": moves, "nextLetter": nextLetter, "leaders": leaders})
}

func (s *server) handlePublicMove(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	if !user.IsPublic {
		writeError(w, http.StatusForbidden, roomPrivateMessage)
		return
	}
	var in verseRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	v, ok := s.readVerse(w, r, in, true)
	if !ok {
		return
	}
	move, nextLetter, err := s.store.addPublicMove(r.Context(), user, in.Expect, v, s.store.clock())
	if err != nil {
		writeMoshaereError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"move": move, "nextLetter": nextLetter})
}

// publicRoom returns the moves to show (the last page, or those after the
// given id), the letter the next verse must start with, and the week's leaders.
func (st *Store) publicRoom(ctx context.Context, after int64, now time.Time) ([]Move, string, []Leader, error) {
	var moves []Move
	var err error
	if after > 0 {
		moves, err = scanMoves(st.db.QueryContext(ctx, `
			SELECT `+moveColumns+` FROM public_moves m JOIN users u ON u.id = m.user_id
			WHERE m.id > ? ORDER BY m.id LIMIT ?`, after, roomPollLimit))
	} else {
		moves, err = scanMoves(st.db.QueryContext(ctx, `
			SELECT * FROM (
				SELECT `+moveColumns+` FROM public_moves m JOIN users u ON u.id = m.user_id
				ORDER BY m.id DESC LIMIT ?) ORDER BY id`, roomPageSize))
	}
	if err != nil {
		return nil, "", nil, err
	}
	_, _, nextLetter, err := newestPublicMoveBy(ctx, st.db)
	if err != nil {
		return nil, "", nil, err
	}
	leaders, err := st.roomLeaders(ctx, now)
	return moves, nextLetter, leaders, err
}

// newestPublicMoveBy is the latest move of the room: its id, author and last
// letter; all zero for an empty room.
func newestPublicMoveBy(ctx context.Context, q moshaereDB) (id, userID int64, letter string, err error) {
	err = q.QueryRowContext(ctx, `SELECT id, user_id, last_letter FROM public_moves ORDER BY id DESC LIMIT 1`).
		Scan(&id, &userID, &letter)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, "", nil
	}
	return
}

// moshaereDB is what *sql.DB and *sql.Tx share, so helpers work in or out of a transaction.
type moshaereDB interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// roomLeaders are the public accounts with the most moves in the last week.
func (st *Store) roomLeaders(ctx context.Context, now time.Time) ([]Leader, error) {
	rows, err := st.db.QueryContext(ctx, `
		SELECT u.username, u.display_name, u.avatar, COUNT(*) AS moves
		FROM public_moves m JOIN users u ON u.id = m.user_id
		WHERE m.created_at >= ? AND u.is_public = 1
		GROUP BY u.id
		ORDER BY moves DESC, MAX(m.id) DESC
		LIMIT ?`, now.Add(-roomLeadersWindow).UnixMilli(), roomLeaderCount)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	leaders := []Leader{}
	for rows.Next() {
		var l Leader
		if err := rows.Scan(&l.Username, &l.DisplayName, &l.Avatar, &l.Count); err != nil {
			return nil, err
		}
		leaders = append(leaders, l)
	}
	return leaders, rows.Err()
}

// addPublicMove appends a verse to the room. expect, when given, is the id of
// the newest move the client has seen; anything newer means it lost a race.
func (st *Store) addPublicMove(ctx context.Context, user User, expect *int64, v verse, now time.Time) (Move, string, error) {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return Move{}, "", err
	}
	defer tx.Rollback()

	newestID, newestUser, nextLetter, err := newestPublicMoveBy(ctx, tx)
	if err != nil {
		return Move{}, "", err
	}
	if newestUser == user.ID {
		return Move{}, "", failure(http.StatusConflict, roomWaitMessage)
	}
	if expect != nil && *expect != newestID {
		return Move{}, "", lostRace(nextLetter)
	}
	var lastAt int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(created_at), 0) FROM public_moves WHERE user_id = ?`, user.ID).Scan(&lastAt); err != nil {
		return Move{}, "", err
	}
	if now.UnixMilli()-lastAt < roomMoveGap.Milliseconds() {
		return Move{}, "", failure(http.StatusTooManyRequests, roomTooFastMessage)
	}
	if nextLetter != "" && v.first != nextLetter {
		return Move{}, "", failure(http.StatusBadRequest, wrongLetterMessage(nextLetter))
	}
	var seen int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (SELECT norm FROM public_moves ORDER BY id DESC LIMIT ?) WHERE norm = ?`,
		roomRepeatWindow, v.norm).Scan(&seen); err != nil {
		return Move{}, "", err
	}
	if seen > 0 {
		return Move{}, "", failure(http.StatusBadRequest, repeatedVerseMessage)
	}

	lines, err := json.Marshal(v.lines)
	if err != nil {
		return Move{}, "", err
	}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO public_moves (user_id, lines, norm, first_letter, last_letter, poem_key, href, poet_name, poem_title, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, string(lines), v.norm, v.first, v.last, v.poemKey, v.href, v.poet, v.poemTitle, now.UnixMilli())
	if err != nil {
		return Move{}, "", err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Move{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Move{}, "", err
	}
	return v.newMove(id, user, now.UnixMilli()), v.last, nil
}

// lostRace is the 409 for a move made on a stale view of the room; the body
// carries the letter the chain now needs.
func lostRace(nextLetter string) *moshaereError {
	message := "کسی زودتر بیتی خواند."
	if nextLetter != "" {
		message = "کسی زودتر بیتی خواند؛ حرف تازه «" + nextLetter + "» است."
	}
	e := failure(http.StatusConflict, message)
	e.extra = map[string]any{"nextLetter": nextLetter}
	return e
}
