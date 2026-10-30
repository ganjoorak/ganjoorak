package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// The admin dashboard's API. Every route is registered through s.admin, so its
// handler cannot run without the role. Rule violations are moshaereErrors, the
// shared status-plus-message error.

const (
	roleModerator = "moderator"
	roleAdmin     = "admin"
	// Actor of changes made with the server command (admin_cli.go).
	serverActorID   = 0
	serverActorName = "server"
)

const (
	adminPageSize   = 30
	maxAdminReason  = 300
	adminForbidden  = "به این بخش دسترسی ندارید."
	badPageMessage  = "صفحهٔ درخواستی معتبر نیست."
	reasonRequired  = "دلیل را بنویسید."
	userNotFound    = "این کاربر پیدا نشد."
	feedbackMissing = "این بازخورد پیدا نشد."
	moveMissing     = "این بیت پیدا نشد."
)

// admin_audit has no foreign keys and keeps usernames as they were: the record
// must outlive renames and accounts.
const adminSchema = `
CREATE TABLE IF NOT EXISTS admin_audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	actor_id INTEGER NOT NULL,
	actor_username TEXT NOT NULL,
	action TEXT NOT NULL,
	target_user_id INTEGER NOT NULL DEFAULT 0,
	target_username TEXT NOT NULL DEFAULT '',
	object_id INTEGER NOT NULL DEFAULT 0,
	reason TEXT NOT NULL DEFAULT '',
	detail TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
`

func init() {
	featureSchemas = append(featureSchemas, adminSchema)
	featureIndexes = append(featureIndexes,
		`CREATE INDEX IF NOT EXISTS users_staff ON users(role) WHERE role != ''`,
		`CREATE INDEX IF NOT EXISTS users_banned ON users(banned_at) WHERE banned_at != 0`,
		`CREATE INDEX IF NOT EXISTS users_created ON users(created_at)`,
		`CREATE INDEX IF NOT EXISTS reads_day ON reads(day, user_id)`,
		`CREATE INDEX IF NOT EXISTS quotes_time ON quotes(created_at)`,
		`CREATE INDEX IF NOT EXISTS matches_time ON matches(created_at)`,
		`CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_user_id, id)`,
		`CREATE INDEX IF NOT EXISTS admin_audit_actor ON admin_audit(actor_id, id)`,
	)
}

func (s *server) adminRoutes(mux *http.ServeMux) {
	const base = "/api/account/admin/"
	mod := func(pattern string, next adminHandler) {
		method, path, _ := strings.Cut(pattern, " ")
		mux.HandleFunc(method+" "+base+path, s.admin(roleModerator, next))
	}
	adm := func(pattern string, next adminHandler) {
		method, path, _ := strings.Cut(pattern, " ")
		mux.HandleFunc(method+" "+base+path, s.admin(roleAdmin, next))
	}
	mod("GET session", s.handleAdminSession)
	adm("GET overview", s.handleAdminOverview)
	adm("GET audit", s.handleAdminAudit)
	// admin_users.go
	adm("GET users", s.handleAdminUsers)
	adm("GET users/{id}", s.handleAdminUser)
	adm("POST users/{id}/ban", s.handleAdminBan(true))
	adm("POST users/{id}/unban", s.handleAdminBan(false))
	adm("POST users/{id}/revoke-sessions", s.handleAdminRevoke)
	adm("PUT users/{id}/role", s.handleAdminRole)
	// admin_feedback.go
	mod("GET feedback", s.handleAdminFeedback)
	mod("PUT feedback/{id}/reviewed", s.handleAdminFeedbackReviewed)
	// admin_content.go
	mod("GET content/profiles", s.handleAdminProfiles)
	mod("GET content/quotes", s.handleAdminQuotes)
	mod("GET content/moves", s.handleAdminMoves)
	mod("POST content/quotes/{id}/remove", s.handleAdminRemoveQuote)
	mod("POST content/moves/{id}/remove", s.handleAdminRemoveMove)
	mod("POST content/users/{id}/clear", s.handleAdminClearProfile)
}

type adminHandler func(w http.ResponseWriter, r *http.Request, actor User)

func roleRank(role string) int {
	switch role {
	case roleAdmin:
		return 2
	case roleModerator:
		return 1
	}
	return 0
}

// admin guards a route. The role comes from the database on every request, so
// a demotion or a ban takes effect at once.
func (s *server) admin(minRole string, next adminHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := s.currentUser(w, r)
		if !ok {
			return
		}
		if roleRank(actor.Role) < roleRank(minRole) {
			writeError(w, http.StatusForbidden, adminForbidden)
			return
		}
		next(w, r, actor)
	}
}

func (s *server) handleAdminSession(w http.ResponseWriter, r *http.Request, actor User) {
	var open int
	err := s.store.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM feedback WHERE reviewed_at = 0`).Scan(&open)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"role": actor.Role, "openFeedback": open})
}

// --- request helpers -----------------------------------------------------------

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// pageBefore reads the ?before= cursor, or answers the error itself.
func pageBefore(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.URL.Query().Get("before")
	if raw == "" {
		return 1<<63 - 1, true
	}
	before, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || before <= 0 {
		writeError(w, http.StatusBadRequest, badPageMessage)
		return 0, false
	}
	return before, true
}

// adminPage cuts the extra row a list query asked for into the next cursor.
func adminPage[T any](items []T, id func(T) int64) ([]T, *int64) {
	if len(items) <= adminPageSize {
		return items, nil
	}
	items = items[:adminPageSize]
	next := id(items[adminPageSize-1])
	return items, &next
}

// readReason reads the {reason} body every moderation action carries.
func readReason(w http.ResponseWriter, r *http.Request, required bool) (string, bool) {
	var in struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &in) {
		return "", false
	}
	reason := cleanText(in.Reason, maxAdminReason)
	if required && reason == "" {
		writeError(w, http.StatusBadRequest, reasonRequired)
		return "", false
	}
	return reason, true
}

// likePattern is a LIKE contains-pattern for ESCAPE '\'; "_" is valid in usernames.
func likePattern(q string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}

// searchTerm reads ?q=, cleaned the way stored text is.
func searchTerm(r *http.Request) string { return cleanText(r.URL.Query().Get("q"), 64) }

// --- audit ---------------------------------------------------------------------

// auditEvent is one line of the audit log, written in the transaction of the
// change it records.
type auditEvent struct {
	action     string
	targetID   int64
	targetName string
	objectID   int64
	reason     string
	detail     map[string]any
}

func writeAudit(ctx context.Context, db moshaereDB, actor User, e auditEvent, now time.Time) error {
	detail := []byte("{}")
	if e.detail != nil {
		var err error
		if detail, err = json.Marshal(e.detail); err != nil {
			return err
		}
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO admin_audit (actor_id, actor_username, action, target_user_id, target_username, object_id, reason, detail, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		actor.ID, actor.Username, e.action, e.targetID, e.targetName, e.objectID, e.reason, string(detail), now.UnixMilli())
	return err
}

// AuditEntry is a stored auditEvent.
type AuditEntry struct {
	ID             int64           `json:"id"`
	ActorID        int64           `json:"actorId"`
	ActorUsername  string          `json:"actorUsername"`
	Action         string          `json:"action"`
	TargetID       int64           `json:"targetId"`
	TargetUsername string          `json:"targetUsername"`
	ObjectID       int64           `json:"objectId"`
	Reason         string          `json:"reason"`
	Detail         json.RawMessage `json:"detail"`
	CreatedAt      int64           `json:"createdAt"`
}

type auditFilter struct {
	actorID, targetID int64
	action            string
	before            int64
	limit             int
}

func (st *Store) auditEntries(ctx context.Context, f auditFilter) ([]AuditEntry, error) {
	query := `
		SELECT id, actor_id, actor_username, action, target_user_id, target_username, object_id, reason, detail, created_at
		FROM admin_audit WHERE id < ?`
	args := []any{f.before}
	if f.actorID > 0 {
		query += ` AND actor_id = ?`
		args = append(args, f.actorID)
	}
	if f.targetID > 0 {
		query += ` AND target_user_id = ?`
		args = append(args, f.targetID)
	}
	if f.action != "" {
		query += ` AND action = ?`
		args = append(args, f.action)
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY id DESC LIMIT ?`, append(args, f.limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var detail string
		if err := rows.Scan(&e.ID, &e.ActorID, &e.ActorUsername, &e.Action, &e.TargetID, &e.TargetUsername,
			&e.ObjectID, &e.Reason, &detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Detail = json.RawMessage(detail)
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *server) handleAdminAudit(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	f := auditFilter{action: cleanText(query.Get("action"), 32), before: before, limit: adminPageSize + 1}
	// Unknown numbers just match nothing, as in any other filter.
	f.actorID, _ = strconv.ParseInt(query.Get("actor"), 10, 64)
	f.targetID, _ = strconv.ParseInt(query.Get("target"), 10, 64)
	entries, err := s.store.auditEntries(r.Context(), f)
	if err != nil {
		internalError(w, err)
		return
	}
	entries, next := adminPage(entries, func(e AuditEntry) int64 { return e.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": entries, "next": next})
}

// userRow is the part of a user the rule checks below need.
type userRow struct {
	id                    int64
	username, displayName string
	role                  string
	bannedAt              int64
}

func loadUserRow(ctx context.Context, db moshaereDB, id int64) (userRow, error) {
	u := userRow{id: id}
	err := db.QueryRowContext(ctx, `SELECT username, display_name, role, banned_at FROM users WHERE id = ?`, id).
		Scan(&u.username, &u.displayName, &u.role, &u.bannedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return u, failure(http.StatusNotFound, userNotFound)
	}
	return u, err
}

func isNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }
