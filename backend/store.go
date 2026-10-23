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
}

var errUsernameTaken = errors.New("username taken")

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
`

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
	return &Store{db: db}, nil
}

func (s *Store) createUser(ctx context.Context, in SignupInput, passwordHash string) (User, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		in.Username, in.DisplayName, passwordHash, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, errUsernameTaken
		}
		return User{}, err
	}
	id, err := res.LastInsertId()
	return User{ID: id, Username: in.Username, DisplayName: in.DisplayName, CreatedAt: now}, err
}

// userForLogin returns sql.ErrNoRows for unknown usernames.
func (s *Store) userForLogin(ctx context.Context, username string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, username, display_name, created_at, password_hash FROM users WHERE username = ?`, username).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt, &hash)
	return u, hash, err
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

// userForSession returns sql.ErrNoRows for unknown or expired sessions.
func (s *Store) userForSession(ctx context.Context, tokenHash string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.display_name, u.created_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, time.Now().UnixMilli()).
		Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt)
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
	if merge {
		var raw string
		if err := tx.QueryRowContext(ctx, `SELECT data FROM users WHERE id = ?`, userID).Scan(&raw); err != nil {
			return AccountData{}, err
		}
		var stored AccountData
		if err := json.Unmarshal([]byte(raw), &stored); err != nil {
			return AccountData{}, err
		}
		data = mergeAccountData(stored, data)
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return AccountData{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET data = ? WHERE id = ?`, string(encoded), userID); err != nil {
		return AccountData{}, err
	}
	return data, tx.Commit()
}
