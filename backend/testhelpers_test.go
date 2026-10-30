package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// fakePoems is a PoemSource backed by a map, keyed like poem keys.
type fakePoems map[string]PoemText

func (f fakePoems) PoemText(_ context.Context, key string) (PoemText, error) {
	poem, ok := f[key]
	if !ok {
		return PoemText{}, errPoemNotFound
	}
	poem.Key = key
	return poem, nil
}

type testAPI struct {
	t       *testing.T
	server  *server
	handler http.Handler
}

// newTestAPI runs the real handlers against a temporary database and poems.
func newTestAPI(t *testing.T, poems fakePoems) *testAPI {
	t.Helper()
	store, err := openStore(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.db.Close() })
	s := newServer(store)
	s.poems = poems
	s.mediaDir = filepath.Join(t.TempDir(), "media")
	return &testAPI{t: t, server: s, handler: s.routes()}
}

func (a *testAPI) do(method, path, body, cookie string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// signUp creates a public account and returns its session cookie.
func (a *testAPI) signUp(username string) string {
	a.t.Helper()
	res := a.do("POST", "/api/account/signup", `{"username":"`+username+`","password":"shirazi-1390"}`, "")
	if res.Code != http.StatusCreated {
		a.t.Fatalf("signup %s: %d %s", username, res.Code, res.Body)
	}
	return strings.SplitN(res.Header().Get("Set-Cookie"), ";", 2)[0]
}

// userID finds an account's id, which no public response carries.
func (a *testAPI) userID(username string) int64 {
	a.t.Helper()
	var id int64
	if err := a.server.store.db.QueryRow(`SELECT id FROM users WHERE username = ?`, username).Scan(&id); err != nil {
		a.t.Fatal(err)
	}
	return id
}

// promote gives an account a role directly in the database.
func (a *testAPI) promote(username, role string) {
	a.t.Helper()
	if _, err := a.server.store.db.Exec(`UPDATE users SET role = ? WHERE username = ?`, role, username); err != nil {
		a.t.Fatal(err)
	}
}
