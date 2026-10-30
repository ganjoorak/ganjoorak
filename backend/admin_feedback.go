package main

import (
	"context"
	"net/http"
)

// The feedback inbox. Marking a message reviewed is routine and stored on the
// message itself, so unlike moderation it does not go to the audit log.

// AdminFeedback is one message. Contact is what the sender chose to leave.
type AdminFeedback struct {
	ID         int64  `json:"id"`
	Kind       string `json:"kind"`
	Message    string `json:"message"`
	Contact    string `json:"contact"`
	Page       string `json:"page"`
	Username   string `json:"username"`
	UserID     int64  `json:"userId"`
	CreatedAt  int64  `json:"createdAt"`
	ReviewedAt int64  `json:"reviewedAt"`
	ReviewedBy string `json:"reviewedBy"`
}

func (st *Store) adminFeedback(ctx context.Context, status, kind string, before int64) ([]AdminFeedback, error) {
	query := `
		SELECT f.id, f.kind, f.message, f.contact, f.page, f.username, f.user_id, f.created_at, f.reviewed_at,
			COALESCE(u.username, '')
		FROM feedback f LEFT JOIN users u ON u.id = f.reviewed_by
		WHERE f.id < ?`
	args := []any{before}
	switch status {
	case "reviewed":
		query += ` AND f.reviewed_at != 0`
	case "all":
	default:
		query += ` AND f.reviewed_at = 0`
	}
	if feedbackKinds[kind] {
		query += ` AND f.kind = ?`
		args = append(args, kind)
	}
	rows, err := st.db.QueryContext(ctx, query+` ORDER BY f.id DESC LIMIT ?`, append(args, adminPageSize+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AdminFeedback{}
	for rows.Next() {
		var f AdminFeedback
		if err := rows.Scan(&f.ID, &f.Kind, &f.Message, &f.Contact, &f.Page, &f.Username, &f.UserID, &f.CreatedAt,
			&f.ReviewedAt, &f.ReviewedBy); err != nil {
			return nil, err
		}
		items = append(items, f)
	}
	return items, rows.Err()
}

// setFeedbackReviewed reports whether the message exists.
func (st *Store) setFeedbackReviewed(ctx context.Context, id, actorID int64, reviewed bool) (bool, error) {
	reviewedAt, reviewedBy := int64(0), int64(0)
	if reviewed {
		reviewedAt, reviewedBy = st.clock().UnixMilli(), actorID
	}
	res, err := st.db.ExecContext(ctx, `UPDATE feedback SET reviewed_at = ?, reviewed_by = ? WHERE id = ?`, reviewedAt, reviewedBy, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *server) handleAdminFeedback(w http.ResponseWriter, r *http.Request, _ User) {
	before, ok := pageBefore(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	items, err := s.store.adminFeedback(r.Context(), query.Get("status"), query.Get("kind"), before)
	if err != nil {
		internalError(w, err)
		return
	}
	items, next := adminPage(items, func(f AdminFeedback) int64 { return f.ID })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next})
}

func (s *server) handleAdminFeedbackReviewed(w http.ResponseWriter, r *http.Request, actor User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusNotFound, feedbackMissing)
		return
	}
	var in struct {
		Reviewed bool `json:"reviewed"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	found, err := s.store.setFeedbackReviewed(r.Context(), id, actor.ID, in.Reviewed)
	if err != nil {
		internalError(w, err)
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, feedbackMissing)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
