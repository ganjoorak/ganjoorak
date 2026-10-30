package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

// Moderation of what people put on the site: profiles, quotes and the verses
// of the public room. Private match verses are not reviewed.

const (
	nothingToClearMessage = "چیزی برای پاک کردن نیست."
	badClearFieldMessage  = "این بخش را نمی‌توان پاک کرد."
	moveRemovedLine       = "این بیت حذف شد."
)

const (
	auditRemoveQuote  = "remove_quote"
	auditRemoveMove   = "remove_move"
	auditClearProfile = "clear_profile"
)

// AdminProfile is what a moderator reviews on an account. It is narrower than
// AdminUser on purpose: moderators do not manage accounts.
type AdminProfile struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Banner      string `json:"banner"`
	Bio         string `json:"bio"`
	Role        string `json:"role"`
	CreatedAt   int64  `json:"createdAt"`
}

type AdminQuote struct {
	Quote
	UserID      int64  `json:"userId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

type AdminMove struct {
	ID          int64    `json:"id"`
	UserID      int64    `json:"userId"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Role        string   `json:"role"`
	Lines       []string `json:"lines"`
	Typed       bool     `json:"typed"`
	PoetName    string   `json:"poetName"`
	PoemTitle   string   `json:"poemTitle"`
	CreatedAt   int64    `json:"createdAt"`
}

// mayModerate answers whether actor can act on an account with ownerRole:
// moderators cannot touch an admin's content.
func mayModerate(actor User, ownerRole string) error {
	if ownerRole == roleAdmin && actor.Role != roleAdmin {
		return failure(http.StatusForbidden, adminForbidden)
	}
	return nil
}

func (st *Store) adminProfiles(ctx context.Context, q, has string, before int64) ([]AdminProfile, error) {
	query := `SELECT u.id, u.username, u.display_name, u.avatar, u.banner, u.bio, u.role, u.created_at FROM users u WHERE u.id < ?`
	args := []any{before}
	switch has {
	case "image":
		query += ` AND (u.avatar LIKE 'img:%' OR u.banner LIKE 'img:%')`
	case "text":
		query += ` AND (u.bio != '' OR u.display_name != u.username)`
	}
	if q != "" {
		query += ` AND (u.username LIKE ?2 ESCAPE '\' OR u.display_name LIKE ?2 ESCAPE '\' OR u.bio LIKE ?2 ESCAPE '\')`
		args = append(args, likePattern(q))
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY u.id DESC LIMIT `+itoa(adminPageSize+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AdminProfile{}
	for rows.Next() {
		var p AdminProfile
		if err := rows.Scan(&p.ID, &p.Username, &p.DisplayName, &p.Avatar, &p.Banner, &p.Bio, &p.Role, &p.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

func (st *Store) adminQuotes(ctx context.Context, q string, before int64) ([]AdminQuote, error) {
	query := `
		SELECT q.user_id, u.username, u.display_name, u.role, ` + quoteColumns + `
		FROM quotes q JOIN users u ON u.id = q.user_id WHERE q.id < ?`
	args := []any{before}
	if q != "" {
		query += ` AND (u.username LIKE ?2 ESCAPE '\' OR q.lines LIKE ?2 ESCAPE '\' OR q.poet_name LIKE ?2 ESCAPE '\')`
		args = append(args, likePattern(q))
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY q.id DESC LIMIT `+itoa(adminPageSize+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AdminQuote{}
	for rows.Next() {
		var item AdminQuote
		quote, err := scanQuote(rows, &item.UserID, &item.Username, &item.DisplayName, &item.Role)
		if err != nil {
			return nil, err
		}
		item.Quote = quote
		items = append(items, item)
	}
	return items, rows.Err()
}

// adminMoves lists the room's verses, leaving out those already removed.
func (st *Store) adminMoves(ctx context.Context, q string, typed bool, before int64) ([]AdminMove, error) {
	query := `
		SELECT m.id, m.user_id, u.username, u.display_name, u.role, m.lines, m.poem_key = '', m.poet_name, m.poem_title, m.created_at
		FROM public_moves m JOIN users u ON u.id = m.user_id
		WHERE m.id < ? AND m.norm != ''`
	args := []any{before}
	if typed {
		query += ` AND m.poem_key = ''`
	}
	if q != "" {
		query += ` AND (u.username LIKE ?2 ESCAPE '\' OR m.lines LIKE ?2 ESCAPE '\')`
		args = append(args, likePattern(q))
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY m.id DESC LIMIT `+itoa(adminPageSize+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AdminMove{}
	for rows.Next() {
		var m AdminMove
		var lines string
		if err := rows.Scan(&m.ID, &m.UserID, &m.Username, &m.DisplayName, &m.Role, &lines, &m.Typed, &m.PoetName, &m.PoemTitle, &m.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(lines), &m.Lines); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

// removeQuote deletes the quote; the audit log keeps its text.
func (st *Store) removeQuote(ctx context.Context, actor User, id int64, reason string) error {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ownerID int64
	var owner, role string
	quote, err := scanQuote(tx.QueryRowContext(ctx, `
		SELECT q.user_id, u.username, u.role, `+quoteColumns+`
		FROM quotes q JOIN users u ON u.id = q.user_id WHERE q.id = ?`, id), &ownerID, &owner, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return failure(http.StatusNotFound, quoteMissingMessage)
	}
	if err != nil {
		return err
	}
	if err := mayModerate(actor, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM quotes WHERE id = ?`, id); err != nil {
		return err
	}
	event := auditEvent{action: auditRemoveQuote, targetID: ownerID, targetName: owner, objectID: id, reason: reason,
		detail: map[string]any{"lines": quote.Lines, "href": quote.Href, "poetName": quote.PoetName, "poemTitle": quote.PoemTitle}}
	if err := writeAudit(ctx, tx, actor, event, st.clock()); err != nil {
		return err
	}
	return tx.Commit()
}

// removeMove blanks a verse of the room but keeps its row. The chain lives on
// ids and letters: open clients send the newest id as expect and derive the next
// letter from their list, so a deleted row would leave them failing, and
// public_moves could hand the id out again. An empty norm is the removed mark.
func (st *Store) removeMove(ctx context.Context, actor User, id int64, reason string) error {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ownerID int64
	var owner, role, lines, norm, href, poet, title string
	err = tx.QueryRowContext(ctx, `
		SELECT m.user_id, u.username, u.role, m.lines, m.norm, m.href, m.poet_name, m.poem_title
		FROM public_moves m JOIN users u ON u.id = m.user_id WHERE m.id = ?`, id).
		Scan(&ownerID, &owner, &role, &lines, &norm, &href, &poet, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return failure(http.StatusNotFound, moveMissing)
	}
	if err != nil {
		return err
	}
	if err := mayModerate(actor, role); err != nil {
		return err
	}
	if norm == "" {
		return nil
	}
	placeholder, err := json.Marshal([]string{moveRemovedLine})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE public_moves SET lines = ?, norm = '', poem_key = '', href = '', poet_name = '', poem_title = ''
		WHERE id = ?`, string(placeholder), id); err != nil {
		return err
	}
	event := auditEvent{action: auditRemoveMove, targetID: ownerID, targetName: owner, objectID: id, reason: reason,
		detail: map[string]any{"lines": json.RawMessage(lines), "href": href, "poetName": poet, "poemTitle": title}}
	if err := writeAudit(ctx, tx, actor, event, st.clock()); err != nil {
		return err
	}
	return tx.Commit()
}

// clearProfileField resets one field of a profile and returns the image
// reference to delete, if any. The file goes after the commit, as in
// handleDeleteUpload: a failed transaction must not lose it.
func (st *Store) clearProfileField(ctx context.Context, actor User, id int64, field, reason string) (string, error) {
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	target, err := loadUserRow(ctx, tx, id)
	if err != nil {
		return "", err
	}
	if err := mayModerate(actor, target.role); err != nil {
		return "", err
	}
	var avatar, banner, bio string
	if err := tx.QueryRowContext(ctx, `SELECT avatar, banner, bio FROM users WHERE id = ?`, id).Scan(&avatar, &banner, &bio); err != nil {
		return "", err
	}
	// The column comes from this switch, never from the request.
	var column, old, value string
	switch field {
	case "avatar":
		column, old = "avatar", avatar
	case "banner":
		column, old = "banner", banner
	case "bio":
		column, old = "bio", bio
	case "displayName":
		column, old, value = "display_name", target.displayName, target.username
	default:
		return "", failure(http.StatusBadRequest, badClearFieldMessage)
	}
	image := field == "avatar" || field == "banner"
	if old == value || (image && !isMediaRef(old)) {
		return "", failure(http.StatusConflict, nothingToClearMessage)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET `+column+` = ? WHERE id = ?`, value, id); err != nil {
		return "", err
	}
	event := auditEvent{action: auditClearProfile, targetID: id, targetName: target.username, reason: reason,
		detail: map[string]any{"field": field, "old": old}}
	if err := writeAudit(ctx, tx, actor, event, st.clock()); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	if image {
		return old, nil
	}
	return "", nil
}

// --- handlers ------------------------------------------------------------------

func (s *server) handleAdminProfiles(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	items, err := s.store.adminProfiles(r.Context(), searchTerm(r), r.URL.Query().Get("has"), before)
	if err != nil {
		internalError(w, err)
		return
	}
	items, next := adminPage(items, func(p AdminProfile) int64 { return p.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next})
}

func (s *server) handleAdminQuotes(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	items, err := s.store.adminQuotes(r.Context(), searchTerm(r), before)
	if err != nil {
		internalError(w, err)
		return
	}
	items, next := adminPage(items, func(q AdminQuote) int64 { return q.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next})
}

func (s *server) handleAdminMoves(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	typed := r.URL.Query().Get("typed") == "1"
	items, err := s.store.adminMoves(r.Context(), searchTerm(r), typed, before)
	if err != nil {
		internalError(w, err)
		return
	}
	items, next := adminPage(items, func(m AdminMove) int64 { return m.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next})
}

func (s *server) handleAdminRemoveQuote(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, quoteMissingMessage)
		return
	}
	reason, ok := readReason(w, r, false)
	if !ok {
		return
	}
	if err := s.store.removeQuote(r.Context(), actor, id, reason); err != nil {
		writeMoshaereError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleAdminRemoveMove(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, moveMissing)
		return
	}
	reason, ok := readReason(w, r, false)
	if !ok {
		return
	}
	if err := s.store.removeMove(r.Context(), actor, id, reason); err != nil {
		writeMoshaereError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleAdminClearProfile(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, userNotFound)
		return
	}
	var in struct {
		Field  string `json:"field"`
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	reason := cleanText(in.Reason, maxAdminReason)
	ref, err := s.store.clearProfileField(r.Context(), actor, id, in.Field, reason)
	if err != nil {
		writeMoshaereError(w, err)
		return
	}
	s.removeUpload(ref)
	w.WriteHeader(http.StatusNoContent)
}
