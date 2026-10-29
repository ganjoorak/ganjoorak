package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

type User struct {
	ID          int64  `json:"-"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	CreatedAt   int64  `json:"createdAt"`
	// Whether /@username is visible to others. On by default; the owner can
	// turn it off from their profile.
	IsPublic bool `json:"isPublic"`
	// Profile picture motif; "" picks one from the username.
	Avatar string `json:"avatar"`
	// Whether a recovery code is set; accounts made before codes existed have none.
	HasRecoveryCode bool `json:"hasRecoveryCode"`
}

// userColumns are the User fields every query below selects, in scan order.
const userColumns = `u.id, u.username, u.display_name, u.created_at, u.is_public, u.avatar, u.recovery_hash != ''`

func (u *User) scanTargets() []any {
	return []any{&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &u.IsPublic, &u.Avatar, &u.HasRecoveryCode}
}

var (
	errUsernameTaken = errors.New("username taken")
	errSelfFollow    = errors.New("cannot follow yourself")
	errFollowLimit   = errors.New("follow limit reached")
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	display_name TEXT NOT NULL,
	password_hash TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- Messages from the in-app feedback form. username is '' for signed-out senders
-- and is copied (not a foreign key) so feedback outlives renamed or deleted accounts.
CREATE TABLE IF NOT EXISTS feedback (
	id INTEGER PRIMARY KEY,
	kind TEXT NOT NULL,
	message TEXT NOT NULL,
	contact TEXT NOT NULL DEFAULT '',
	page TEXT NOT NULL DEFAULT '',
	username TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
-- Who follows whom. Keyed by user id, so renaming an account keeps its follows.
CREATE TABLE IF NOT EXISTS follows (
	follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee_id, created_at);
`

// Columns added after the first release, applied once to older databases.
var migrations = []struct{ column, ddl string }{
	{"is_public", `ALTER TABLE users ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1`},
	// Server time (ms) of the last push that changed the history head; drives
	// "now reading" on the public profile.
	{"reading_at", `ALTER TABLE users ADD COLUMN reading_at INTEGER NOT NULL DEFAULT 0`},
	// argon2id hash of the account's recovery code; '' when none is set.
	{"recovery_hash", `ALTER TABLE users ADD COLUMN recovery_hash TEXT NOT NULL DEFAULT ''`},
	{"avatar", `ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''`},
}

func migrate(db *sql.DB) error {
	rows, err := db.Query(`SELECT name FROM pragma_table_info('users')`)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		have[name] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, m := range migrations {
		if have[m.column] {
			continue
		}
		if _, err := db.Exec(m.ddl); err != nil {
			return err
		}
	}
	return nil
}

func openStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// One connection serializes writes, which keeps the read-merge-write in
	// saveData race-free without extra locking. Plenty for this traffic.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) createUser(ctx context.Context, in SignupInput, passwordHash, recoveryHash string) (User, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, display_name, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
		in.Username, in.DisplayName, passwordHash, recoveryHash, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, errUsernameTaken
		}
		return User{}, err
	}
	id, err := res.LastInsertId()
	return User{ID: id, Username: in.Username, DisplayName: in.DisplayName, CreatedAt: now, IsPublic: true, HasRecoveryCode: recoveryHash != ""}, err
}

// userForLogin returns sql.ErrNoRows for unknown usernames.
func (s *Store) userForLogin(ctx context.Context, username string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+`, u.password_hash FROM users u WHERE u.username = ?`, username).
		Scan(append(u.scanTargets(), &hash)...)
	return u, hash, err
}

// userForRecovery returns the recovery-code hash (” when none is set), or
// sql.ErrNoRows for unknown usernames.
func (s *Store) userForRecovery(ctx context.Context, username string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+`, u.recovery_hash FROM users u WHERE u.username = ?`, username).
		Scan(append(u.scanTargets(), &hash)...)
	return u, hash, err
}

func (s *Store) passwordHash(ctx context.Context, userID int64) (string, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = ?`, userID).Scan(&hash)
	return hash, err
}

// setCredentials replaces the password and/or recovery code ("" leaves one as
// it is). A new password signs out every session; the caller starts a fresh one.
func (s *Store) setCredentials(ctx context.Context, userID int64, passwordHash, recoveryHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if passwordHash != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
			return err
		}
	}
	if recoveryHash != "" {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET recovery_hash = ? WHERE id = ?`, recoveryHash, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) updateProfile(ctx context.Context, userID int64, in ProfileInput) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET username = ?, display_name = ?, avatar = ? WHERE id = ?`,
		in.Username, in.DisplayName, in.Avatar, userID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return errUsernameTaken
	}
	return err
}

func (s *Store) createSession(ctx context.Context, userID int64, tokenHash string, expires time.Time) error {
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, now); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, tokenHash, userID, expires.UnixMilli())
	return err
}

func (s *Store) deleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) addFeedback(ctx context.Context, in FeedbackInput, username string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO feedback (kind, message, contact, page, username, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		in.Kind, in.Message, in.Contact, in.Page, username, time.Now().UnixMilli())
	return err
}

// userForSession returns sql.ErrNoRows for unknown or expired sessions.
func (s *Store) userForSession(ctx context.Context, tokenHash string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
		SELECT `+userColumns+`
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, time.Now().UnixMilli()).
		Scan(u.scanTargets()...)
	return u, err
}

func (s *Store) loadData(ctx context.Context, userID int64) (AccountData, error) {
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT data FROM users WHERE id = ?`, userID).Scan(&raw); err != nil {
		return AccountData{}, err
	}
	var data AccountData
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return AccountData{}, err
	}
	return sanitizeAccountData(data), nil
}

// saveData replaces the stored data, or unions it in when merge is true.
func (s *Store) saveData(ctx context.Context, userID int64, data AccountData, merge bool) (AccountData, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AccountData{}, err
	}
	defer tx.Rollback()
	data = sanitizeAccountData(data)
	var raw string
	if err := tx.QueryRowContext(ctx, `SELECT data FROM users WHERE id = ?`, userID).Scan(&raw); err != nil {
		return AccountData{}, err
	}
	var stored AccountData
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return AccountData{}, err
	}
	stored = sanitizeAccountData(stored)
	if merge {
		data = mergeAccountData(stored, data)
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return AccountData{}, err
	}
	// Opening a poem pushes a new history head within seconds (AccountSync),
	// so this stamp is "last seen reading".
	query := `UPDATE users SET data = ? WHERE id = ?`
	args := []any{string(encoded), userID}
	if historyHeadChanged(stored.History, data.History) {
		query = `UPDATE users SET data = ?, reading_at = ? WHERE id = ?`
		args = []any{string(encoded), time.Now().UnixMilli(), userID}
	}
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return AccountData{}, err
	}
	return data, tx.Commit()
}

func (s *Store) setPublic(ctx context.Context, userID int64, public bool) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET is_public = ? WHERE id = ?`, public, userID)
	return err
}

// publicProfile returns sql.ErrNoRows for unknown usernames and for accounts
// that turned their profile off, so the two look the same from outside.
func (s *Store) publicProfile(ctx context.Context, username string) (PublicProfile, error) {
	var u User
	var raw string
	var readingAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, username, display_name, avatar, created_at, data, reading_at
		FROM users WHERE username = ? AND is_public = 1`, username).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.Avatar, &u.CreatedAt, &raw, &readingAt)
	if err != nil {
		return PublicProfile{}, err
	}
	var data AccountData
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return PublicProfile{}, err
	}
	profile := buildPublicProfile(u, sanitizeAccountData(data), readingAt, time.Now().UnixMilli())
	profile.FollowerCount, profile.FollowingCount, err = s.followCounts(ctx, u.ID)
	return profile, err
}

// --- follows -------------------------------------------------------------------

// FollowUser is one row of a followers / following list.
type FollowUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
	FollowedAt  int64  `json:"followedAt"`
}

// followUser returns sql.ErrNoRows for unknown and private accounts, so the two
// look the same from outside, as with publicProfile. Following twice is fine.
func (s *Store) followUser(ctx context.Context, followerID int64, username string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var targetID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ? AND is_public = 1`, username).Scan(&targetID); err != nil {
		return err
	}
	if targetID == followerID {
		return errSelfFollow
	}
	var already, total int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FILTER (WHERE followee_id = ?), COUNT(*) FROM follows WHERE follower_id = ?`,
		targetID, followerID).Scan(&already, &total); err != nil {
		return err
	}
	if already > 0 {
		return nil
	}
	if total >= maxFollowing {
		return errFollowLimit
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)`,
		followerID, targetID, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

// unfollowUser works for private accounts too, so a follow never gets stuck.
func (s *Store) unfollowUser(ctx context.Context, followerID int64, username string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM follows WHERE follower_id = ?
		AND followee_id = (SELECT id FROM users WHERE username = ?)`, followerID, username)
	return err
}

func (s *Store) isFollowing(ctx context.Context, followerID int64, username string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.followee_id
		WHERE f.follower_id = ? AND u.username = ?`, followerID, username).Scan(&count)
	return count > 0, err
}

// followCounts counts only public accounts on the other side: a private
// account does not appear in anyone's counts or lists.
func (s *Store) followCounts(ctx context.Context, userID int64) (followers, following int, err error) {
	err = s.db.QueryRowContext(ctx, `
		SELECT
			(SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?1 AND u.is_public = 1),
			(SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?1 AND u.is_public = 1)`,
		userID).Scan(&followers, &following)
	return
}

// followList is who follows userID (followers) or whom userID follows, newest first.
func (s *Store) followList(ctx context.Context, userID int64, followers bool) ([]FollowUser, error) {
	other, own := "follower_id", "followee_id"
	if !followers {
		other, own = own, other
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.username, u.display_name, u.avatar, f.created_at
		FROM follows f JOIN users u ON u.id = f.`+other+`
		WHERE f.`+own+` = ? AND u.is_public = 1
		ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?`, userID, maxFollowList)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []FollowUser{}
	for rows.Next() {
		var f FollowUser
		if err := rows.Scan(&f.Username, &f.DisplayName, &f.Avatar, &f.FollowedAt); err != nil {
			return nil, err
		}
		list = append(list, f)
	}
	return list, rows.Err()
}
