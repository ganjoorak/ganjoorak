package main

import (
	"context"
	"net/http"
)

// Accounts as admins see them: search, details, bans, sessions and roles.

const (
	selfActionMessage = "این کار را نمی‌توانید روی حساب خودتان انجام دهید."
	banStaffMessage   = "ابتدا نقش این کاربر را بردارید."
	roleBannedMessage = "به حساب مسدود نمی‌توان نقش داد."
	lastAdminMessage  = "آخرین مدیر را نمی‌توان برداشت."
	badRoleMessage    = "نقش معتبر نیست."
	adminAuditShown   = 20
)

const (
	auditBan            = "ban"
	auditUnban          = "unban"
	auditRevokeSessions = "revoke_sessions"
	auditSetRole        = "set_role"
)

// AdminUser is one row of the users list. It carries the id, which no public
// response does, so it must stay on staff routes.
type AdminUser struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	Role        string `json:"role"`
	IsPublic    bool   `json:"isPublic"`
	CreatedAt   int64  `json:"createdAt"`
	BannedAt    int64  `json:"bannedAt"`
}

// AdminUserDetail lists fields one by one on purpose: the data blob and the
// hashes never leave the store.
type AdminUserDetail struct {
	AdminUser
	Bio             string       `json:"bio"`
	Banner          string       `json:"banner"`
	HasRecoveryCode bool         `json:"hasRecoveryCode"`
	ReadingAt       int64        `json:"readingAt"`
	Sessions        int          `json:"sessions"`
	Quotes          int          `json:"quotes"`
	Moves           int          `json:"moves"`
	Reads           int          `json:"reads"`
	Followers       int          `json:"followers"`
	Following       int          `json:"following"`
	Audit           []AuditEntry `json:"audit"`
}

const adminUserColumns = `u.id, u.username, u.display_name, u.avatar, u.role, u.is_public, u.created_at, u.banned_at`

func (u *AdminUser) scanTargets() []any {
	return []any{&u.ID, &u.Username, &u.DisplayName, &u.Avatar, &u.Role, &u.IsPublic, &u.CreatedAt, &u.BannedAt}
}

func (st *Store) adminUsers(ctx context.Context, q, filter string, before int64) ([]AdminUser, error) {
	query := `SELECT ` + adminUserColumns + ` FROM users u WHERE u.id < ?`
	args := []any{before}
	switch filter {
	case "banned":
		query += ` AND u.banned_at != 0`
	case "staff":
		query += ` AND u.role != ''`
	}
	if q != "" {
		query += ` AND (u.username LIKE ?2 ESCAPE '\' OR u.display_name LIKE ?2 ESCAPE '\')`
		args = append(args, likePattern(q))
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY u.id DESC LIMIT `+itoa(adminPageSize+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(u.scanTargets()...); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (st *Store) adminUserDetail(ctx context.Context, id int64) (AdminUserDetail, error) {
	var d AdminUserDetail
	dest := append(d.AdminUser.scanTargets(), &d.Bio, &d.Banner, &d.HasRecoveryCode, &d.ReadingAt,
		&d.Sessions, &d.Quotes, &d.Moves, &d.Reads, &d.Followers, &d.Following)
	err := st.db.QueryRowContext(ctx, `
		SELECT `+adminUserColumns+`, u.bio, u.banner, u.recovery_hash != '', u.reading_at,
			(SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?2),
			(SELECT COUNT(*) FROM quotes WHERE user_id = u.id),
			(SELECT COUNT(*) FROM public_moves WHERE user_id = u.id),
			(SELECT COUNT(*) FROM reads WHERE user_id = u.id),
			(SELECT COUNT(*) FROM follows WHERE followee_id = u.id),
			(SELECT COUNT(*) FROM follows WHERE follower_id = u.id)
		FROM users u WHERE u.id = ?1`, id, st.clock().UnixMilli()).Scan(dest...)
	if err != nil {
		return d, err
	}
	d.Audit, err = st.auditEntries(ctx, auditFilter{targetID: id, before: 1<<63 - 1, limit: adminAuditShown})
	return d, err
}

// setBanned bans or unbans a regular account. Staff must be demoted first, so
// an admin can never be locked out by another. Banning ends every session in
// the same transaction, so an unban does not bring old ones back.
func (st *Store) setBanned(ctx context.Context, actor User, id int64, banned bool, reason string) error {
	if id == actor.ID {
		return failure(http.StatusBadRequest, selfActionMessage)
	}
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	target, err := loadUserRow(ctx, tx, id)
	if err != nil {
		return err
	}
	if banned && target.role != "" {
		return failure(http.StatusConflict, banStaffMessage)
	}
	if banned == (target.bannedAt != 0) {
		return nil
	}
	now := st.clock()
	bannedAt, action := int64(0), auditUnban
	if banned {
		bannedAt, action = now.UnixMilli(), auditBan
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET banned_at = ? WHERE id = ?`, bannedAt, id); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, actor, auditEvent{action: action, targetID: id, targetName: target.username, reason: reason}, now); err != nil {
		return err
	}
	return tx.Commit()
}

// revokeSessions works on anyone but the actor, other admins included: it is
// the answer to a stolen session.
func (st *Store) revokeSessions(ctx context.Context, actor User, id int64, reason string) error {
	if id == actor.ID {
		return failure(http.StatusBadRequest, selfActionMessage)
	}
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	target, err := loadUserRow(ctx, tx, id)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
		return err
	}
	if err := writeAudit(ctx, tx, actor, auditEvent{action: auditRevokeSessions, targetID: id, targetName: target.username, reason: reason}, st.clock()); err != nil {
		return err
	}
	return tx.Commit()
}

// setRole changes a role, from the dashboard or the server command. The
// actor's role is read again inside the transaction: of two admins demoting
// each other at once, the second no longer has the right.
func (st *Store) setRole(ctx context.Context, actor User, id int64, role, reason string) error {
	if role != "" && role != roleModerator && role != roleAdmin {
		return failure(http.StatusBadRequest, badRoleMessage)
	}
	if id == actor.ID {
		return failure(http.StatusBadRequest, selfActionMessage)
	}
	tx, err := st.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if actor.ID != serverActorID {
		current, err := loadUserRow(ctx, tx, actor.ID)
		if err != nil {
			return err
		}
		if current.role != roleAdmin {
			return failure(http.StatusForbidden, adminForbidden)
		}
	}
	target, err := loadUserRow(ctx, tx, id)
	if err != nil {
		return err
	}
	if target.bannedAt != 0 {
		return failure(http.StatusConflict, roleBannedMessage)
	}
	if target.role == role {
		return nil
	}
	if target.role == roleAdmin {
		var admins int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = ?`, roleAdmin).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 {
			return failure(http.StatusConflict, lastAdminMessage)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET role = ? WHERE id = ?`, role, id); err != nil {
		return err
	}
	event := auditEvent{action: auditSetRole, targetID: id, targetName: target.username, reason: reason,
		detail: map[string]any{"from": target.role, "to": role}}
	if err := writeAudit(ctx, tx, actor, event, st.clock()); err != nil {
		return err
	}
	return tx.Commit()
}

// --- handlers ------------------------------------------------------------------

func (s *server) handleAdminUsers(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	users, err := s.store.adminUsers(r.Context(), searchTerm(r), r.URL.Query().Get("filter"), before)
	if err != nil {
		internalError(w, err)
		return
	}
	users, next := adminPage(users, func(u AdminUser) int64 { return u.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": users, "next": next})
}

func (s *server) handleAdminUser(w http.ResponseWriter, r *http.Request, _ User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, userNotFound)
		return
	}
	user, err := s.store.adminUserDetail(r.Context(), id)
	if isNoRows(err) {
		writeError(w, http.StatusNotFound, userNotFound)
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *server) handleAdminBan(banned bool) adminHandler {
	return func(w http.ResponseWriter, r *http.Request, actor User) {
		id, ok := pathID(r)
		if !ok {
			writeError(w, http.StatusNotFound, userNotFound)
			return
		}
		reason, ok := readReason(w, r, banned)
		if !ok {
			return
		}
		if err := s.store.setBanned(r.Context(), actor, id, banned, reason); err != nil {
			writeMoshaereError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *server) handleAdminRevoke(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, userNotFound)
		return
	}
	reason, ok := readReason(w, r, false)
	if !ok {
		return
	}
	if err := s.store.revokeSessions(r.Context(), actor, id, reason); err != nil {
		writeMoshaereError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleAdminRole(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, userNotFound)
		return
	}
	var in struct {
		Role   string `json:"role"`
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	reason := cleanText(in.Reason, maxAdminReason)
	if err := s.store.setRole(r.Context(), actor, id, in.Role, reason); err != nil {
		writeMoshaereError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
