package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// runCommand runs a server-side subcommand instead of the service:
//
//	accounts set-role <username> <admin|moderator|none>
//
// This is how the first admin is made. It is a command and not a setting: a
// setting would apply again on every start, undoing demotions, and would trust
// a username anyone can claim once it is free.
func runCommand(args []string) error {
	if len(args) != 3 || args[0] != "set-role" {
		return errors.New("usage: accounts set-role <username> <admin|moderator|none>")
	}
	dbPath := getenv("ACCOUNTS_DB", "data/accounts.db")
	store, err := openStore(dbPath)
	if err != nil {
		return fmt.Errorf("open store %s: %w", dbPath, err)
	}
	defer store.db.Close()
	return store.setRoleByName(context.Background(), args[1], args[2])
}

func (st *Store) setRoleByName(ctx context.Context, username, role string) error {
	if role == "none" {
		role = ""
	}
	username = normalizeUsername(username)
	var id int64
	err := st.db.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ?`, username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("no account named %q", username)
	}
	if err != nil {
		return err
	}
	return st.setRole(ctx, User{ID: serverActorID, Username: serverActorName}, id, role, "")
}
