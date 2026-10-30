package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const adminBase = "/api/account/admin/"

// staffAPI has an admin, a moderator and a regular account.
func staffAPI(t *testing.T, poems fakePoems) (api *testAPI, admin, mod, user string) {
	t.Helper()
	api = newTestAPI(t, poems)
	admin, mod, user = api.signUp("admin_a"), api.signUp("mod_a"), api.signUp("user_a")
	api.promote("admin_a", roleAdmin)
	api.promote("mod_a", roleModerator)
	return api, admin, mod, user
}

func (a *testAPI) adminDo(method, path, body, cookie string) *httptest.ResponseRecorder {
	return a.do(method, adminBase+path, body, cookie)
}

func auditActions(t *testing.T, api *testAPI, targetID int64) []AuditEntry {
	t.Helper()
	entries, err := api.server.store.auditEntries(t.Context(), auditFilter{targetID: targetID, before: 1<<63 - 1, limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestAdminRouteRoles(t *testing.T) {
	api, admin, mod, user := staffAPI(t, nil)
	routes := []struct {
		method, path, body string
		adminOnly          bool
	}{
		{"GET", "session", "", false},
		{"GET", "overview", "", true},
		{"GET", "audit", "", true},
		{"GET", "users", "", true},
		{"GET", "users/999", "", true},
		{"POST", "users/999/ban", `{"reason":"x"}`, true},
		{"POST", "users/999/unban", `{}`, true},
		{"POST", "users/999/revoke-sessions", `{}`, true},
		{"PUT", "users/999/role", `{"role":""}`, true},
		{"GET", "feedback", "", false},
		{"PUT", "feedback/999/reviewed", `{"reviewed":true}`, false},
		{"GET", "content/profiles", "", false},
		{"GET", "content/quotes", "", false},
		{"GET", "content/moves", "", false},
		{"POST", "content/quotes/999/remove", `{}`, false},
		{"POST", "content/moves/999/remove", `{}`, false},
		{"POST", "content/users/999/clear", `{"field":"bio"}`, false},
	}
	for _, route := range routes {
		name := route.method + " " + route.path
		if got := api.adminDo(route.method, route.path, route.body, "").Code; got != http.StatusUnauthorized {
			t.Errorf("%s anonymous: %d", name, got)
		}
		if got := api.adminDo(route.method, route.path, route.body, user).Code; got != http.StatusForbidden {
			t.Errorf("%s user: %d", name, got)
		}
		got := api.adminDo(route.method, route.path, route.body, mod).Code
		if route.adminOnly != (got == http.StatusForbidden) || got == http.StatusUnauthorized {
			t.Errorf("%s moderator: %d", name, got)
		}
		if got := api.adminDo(route.method, route.path, route.body, admin).Code; got == http.StatusForbidden || got == http.StatusUnauthorized {
			t.Errorf("%s admin: %d", name, got)
		}
	}
}

func TestAdminDemotionAppliesAtOnce(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	expect(t, api.adminDo("GET", "overview", "", admin), http.StatusOK, "")
	api.promote("admin_a", roleModerator)
	expect(t, api.adminDo("GET", "overview", "", admin), http.StatusForbidden, adminForbidden)
}

func TestRoleOnlyOnMe(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	me := api.do("GET", "/api/account/me", "", admin)
	expect(t, me, http.StatusOK, "")
	if fields(t, me)["role"] != roleAdmin {
		t.Fatalf("me: %s", me.Body)
	}
	responses := map[string]*httptest.ResponseRecorder{
		"login":   api.do("POST", "/api/account/login", `{"username":"admin_a","password":"shirazi-1390"}`, ""),
		"profile": api.do("GET", "/api/account/users/admin_a", "", ""),
	}
	for name, rec := range responses {
		expect(t, rec, http.StatusOK, "")
		if strings.Contains(rec.Body.String(), `"role"`) || strings.Contains(rec.Body.String(), `"bannedAt"`) {
			t.Fatalf("%s leaks staff fields: %s", name, rec.Body)
		}
	}
	user, _ := fields(t, me)["user"].(map[string]any)
	if _, leaked := user["role"]; leaked {
		t.Fatalf("user object has a role: %s", me.Body)
	}
}

func TestBanEndsTheAccount(t *testing.T) {
	api, admin, _, user := staffAPI(t, quotePoems())
	id := api.userID("user_a")
	signup := api.do("POST", "/api/account/signup", `{"username":"reader_a","password":"shirazi-1390"}`, "")
	expect(t, signup, http.StatusCreated, "")
	code, _ := fields(t, signup)["recoveryCode"].(string)
	reader := strings.SplitN(signup.Header().Get("Set-Cookie"), ";", 2)[0]
	readerID := api.userID("reader_a")
	expect(t, api.do("PUT", "/api/account/follow/user_a", "", reader), http.StatusOK, "")

	if rec := api.adminDo("POST", fmt.Sprintf("users/%d/ban", id), `{}`, admin); rec.Code != http.StatusBadRequest {
		t.Fatalf("ban without a reason: %d", rec.Code)
	}
	expect(t, api.adminDo("POST", fmt.Sprintf("users/%d/ban", id), `{"reason":"اسپم"}`, admin), http.StatusNoContent, "")
	expect(t, api.adminDo("POST", fmt.Sprintf("users/%d/ban", readerID), `{"reason":"اسپم"}`, admin), http.StatusNoContent, "")

	expect(t, api.do("GET", "/api/account/me", "", user), http.StatusUnauthorized, "")
	expect(t, api.do("POST", "/api/account/login", `{"username":"user_a","password":"wrong-password-1"}`, ""), http.StatusUnauthorized, loginFailedMessage)
	expect(t, api.do("POST", "/api/account/login", `{"username":"user_a","password":"shirazi-1390"}`, ""), http.StatusForbidden, bannedMessage)

	reset := fmt.Sprintf(`{"username":"reader_a","recoveryCode":%q,"newPassword":"shirazi-1391"}`, code)
	expect(t, api.do("POST", "/api/account/reset", reset, ""), http.StatusForbidden, bannedMessage)

	expect(t, api.do("GET", "/api/account/users/user_a", "", ""), http.StatusNotFound, profileNotFoundMessage)
	expect(t, api.do("GET", "/api/account/users/user_a/quotes", "", ""), http.StatusNotFound, profileNotFoundMessage)
	expect(t, api.do("PUT", "/api/account/follow/user_a", "", admin), http.StatusNotFound, profileNotFoundMessage)

	// Feedback from a dead session is anonymous.
	expect(t, api.do("POST", "/api/account/feedback", `{"kind":"bug","message":"پیام آزمایشی"}`, user), http.StatusNoContent, "")
	var sender string
	if err := api.server.store.db.QueryRow(`SELECT username FROM feedback`).Scan(&sender); err != nil {
		t.Fatal(err)
	}
	if sender != "" {
		t.Fatalf("feedback sender %q", sender)
	}

	expect(t, api.adminDo("POST", fmt.Sprintf("users/%d/unban", readerID), `{}`, admin), http.StatusNoContent, "")
	expect(t, api.do("GET", "/api/account/me", "", reader), http.StatusUnauthorized, "")
	// The recovery code survived the refused reset.
	expect(t, api.do("POST", "/api/account/reset", reset, ""), http.StatusOK, "")

	if entries := auditActions(t, api, readerID); len(entries) != 2 || entries[0].Action != auditUnban || entries[1].Action != auditBan || entries[1].Reason != "اسپم" {
		t.Fatalf("audit: %+v", entries)
	}
}

func TestBanAndRoleRules(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	adminID, modID, userID := api.userID("admin_a"), api.userID("mod_a"), api.userID("user_a")
	role := func(id int64, value string) *httptest.ResponseRecorder {
		return api.adminDo("PUT", fmt.Sprintf("users/%d/role", id), `{"role":"`+value+`"}`, admin)
	}
	ban := func(id int64) *httptest.ResponseRecorder {
		return api.adminDo("POST", fmt.Sprintf("users/%d/ban", id), `{"reason":"x"}`, admin)
	}
	expect(t, ban(adminID), http.StatusBadRequest, selfActionMessage)
	expect(t, ban(modID), http.StatusConflict, banStaffMessage)
	expect(t, role(adminID, ""), http.StatusBadRequest, selfActionMessage)
	expect(t, role(userID, "owner"), http.StatusBadRequest, badRoleMessage)
	expect(t, api.adminDo("POST", fmt.Sprintf("users/%d/revoke-sessions", adminID), `{}`, admin), http.StatusBadRequest, selfActionMessage)

	expect(t, role(modID, ""), http.StatusNoContent, "")
	expect(t, ban(modID), http.StatusNoContent, "")
	expect(t, role(modID, roleModerator), http.StatusConflict, roleBannedMessage)

	entries := auditActions(t, api, modID)
	var detail struct{ From, To string }
	if err := json.Unmarshal(entries[1].Detail, &detail); err != nil || entries[1].Action != auditSetRole || detail.From != roleModerator || detail.To != "" {
		t.Fatalf("audit: %+v", entries)
	}
}

func TestLastAdminStays(t *testing.T) {
	api, _, _, _ := staffAPI(t, nil)
	store := api.server.store
	ctx := t.Context()
	if err := store.setRoleByName(ctx, "admin_a", "none"); err == nil || !strings.Contains(err.Error(), lastAdminMessage) {
		t.Fatalf("demoting the last admin: %v", err)
	}
	if err := store.setRoleByName(ctx, "user_a", roleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := store.setRoleByName(ctx, "admin_a", "none"); err != nil {
		t.Fatal(err)
	}
	// Set by the command, so the actor is the server.
	entries := auditActions(t, api, api.userID("admin_a"))
	if len(entries) != 1 || entries[0].ActorID != serverActorID || entries[0].ActorUsername != serverActorName {
		t.Fatalf("audit: %+v", entries)
	}
	if err := store.setRoleByName(ctx, "nobody", roleAdmin); err == nil {
		t.Fatal("an unknown account should fail")
	}
}

func TestRoleChangeNeedsACurrentAdmin(t *testing.T) {
	api, _, _, _ := staffAPI(t, nil)
	store := api.server.store
	// A request that passed the guard as admin, demoted before its transaction.
	stale := User{ID: api.userID("mod_a"), Username: "mod_a", Role: roleAdmin}
	err := store.setRole(t.Context(), stale, api.userID("admin_a"), "", "")
	if failed, ok := err.(*moshaereError); !ok || failed.status != http.StatusForbidden {
		t.Fatalf("stale actor: %v", err)
	}
}

func TestRevokeSessions(t *testing.T) {
	api, admin, _, user := staffAPI(t, nil)
	expect(t, api.adminDo("POST", fmt.Sprintf("users/%d/revoke-sessions", api.userID("user_a")), `{}`, admin), http.StatusNoContent, "")
	expect(t, api.do("GET", "/api/account/me", "", user), http.StatusUnauthorized, "")
	expect(t, api.do("POST", "/api/account/login", `{"username":"user_a","password":"shirazi-1390"}`, ""), http.StatusOK, "")
}

func TestAdminUserSearchAndPaging(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	api.signUp("xayb")
	var page struct {
		Items []AdminUser `json:"items"`
		Next  *int64      `json:"next"`
	}
	read := func(query string) {
		t.Helper()
		page.Items, page.Next = nil, nil
		rec := api.adminDo("GET", "users"+query, "", admin)
		expect(t, rec, http.StatusOK, "")
		if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
	}
	// "_" is a literal, not LIKE's any-character.
	read("?q=" + "x_y")
	if len(page.Items) != 0 {
		t.Fatalf("underscore matched: %+v", page.Items)
	}
	read("?q=a_a")
	if len(page.Items) != 0 {
		t.Fatalf("no such name: %+v", page.Items)
	}
	read("?q=n_a")
	if len(page.Items) != 1 || page.Items[0].Username != "admin_a" {
		t.Fatalf("search: %+v", page.Items)
	}
	read("?filter=staff")
	if len(page.Items) != 2 {
		t.Fatalf("staff: %+v", page.Items)
	}

	store := api.server.store
	for i := range adminPageSize + 5 {
		if _, err := store.db.Exec(`INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, 'x', 'x', 1)`,
			fmt.Sprintf("bulk_%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	read("")
	if len(page.Items) != adminPageSize || page.Next == nil {
		t.Fatalf("page: %d next %v", len(page.Items), page.Next)
	}
	read(fmt.Sprintf("?before=%d", *page.Next))
	if len(page.Items) != 9 || page.Next != nil {
		t.Fatalf("second page: %d next %v", len(page.Items), page.Next)
	}
	expect(t, api.adminDo("GET", "users?before=x", "", admin), http.StatusBadRequest, badPageMessage)
}

func TestAdminUserDetailHidesSecrets(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	rec := api.adminDo("GET", fmt.Sprintf("users/%d", api.userID("user_a")), "", admin)
	expect(t, rec, http.StatusOK, "")
	for _, secret := range []string{"password", "data", "$argon2", "recoveryHash"} {
		if strings.Contains(rec.Body.String(), secret) {
			t.Fatalf("detail contains %q: %s", secret, rec.Body)
		}
	}
	var out struct {
		User AdminUserDetail `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.User.Username != "user_a" || out.User.Sessions != 1 || !out.User.HasRecoveryCode {
		t.Fatalf("detail: %+v", out.User)
	}
	expect(t, api.adminDo("GET", "users/9999", "", admin), http.StatusNotFound, userNotFound)
}

func TestFeedbackInbox(t *testing.T) {
	api, _, mod, user := staffAPI(t, nil)
	expect(t, api.do("POST", "/api/account/feedback", `{"kind":"bug","message":"ایراد اول","contact":"a@b"}`, user), http.StatusNoContent, "")
	expect(t, api.do("POST", "/api/account/feedback", `{"kind":"other","message":"نظر دوم"}`, ""), http.StatusNoContent, "")

	list := func(query string) []AdminFeedback {
		t.Helper()
		rec := api.adminDo("GET", "feedback"+query, "", mod)
		expect(t, rec, http.StatusOK, "")
		var page struct {
			Items []AdminFeedback `json:"items"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page.Items
	}
	items := list("")
	if len(items) != 2 || items[1].Username != "user_a" || items[1].UserID != api.userID("user_a") || items[1].Contact != "a@b" {
		t.Fatalf("inbox: %+v", items)
	}
	if got := list("?kind=bug"); len(got) != 1 || got[0].Kind != "bug" {
		t.Fatalf("kind: %+v", got)
	}

	path := fmt.Sprintf("feedback/%d/reviewed", items[1].ID)
	expect(t, api.adminDo("PUT", path, `{"reviewed":true}`, mod), http.StatusNoContent, "")
	if got := list(""); len(got) != 1 {
		t.Fatalf("open: %+v", got)
	}
	got := list("?status=reviewed")
	if len(got) != 1 || got[0].ReviewedBy != "mod_a" || got[0].ReviewedAt == 0 {
		t.Fatalf("reviewed: %+v", got)
	}
	session := api.adminDo("GET", "session", "", mod)
	if fields(t, session)["openFeedback"] != float64(1) {
		t.Fatalf("session: %s", session.Body)
	}
	expect(t, api.adminDo("PUT", path, `{"reviewed":false}`, mod), http.StatusNoContent, "")
	if got := list("?status=all"); len(got) != 2 || got[0].ReviewedAt != 0 || got[1].ReviewedBy != "" {
		t.Fatalf("reopened: %+v", got)
	}
	expect(t, api.adminDo("PUT", "feedback/999/reviewed", `{"reviewed":true}`, mod), http.StatusNotFound, feedbackMissing)
}

func TestRemovedMoveKeepsTheChain(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	admin, mod, sara, ali := api.signUp("admin_a"), api.signUp("mod_a"), api.signUp("sara"), api.signUp("ali")
	api.promote("admin_a", roleAdmin)
	api.promote("mod_a", roleModerator)

	first := verseOf(0, "ب", "م")
	expect(t, api.say(sara, first), http.StatusCreated, "")
	clock.advance(time.Minute)
	second := verseOf(1, "م", "ن")
	expect(t, api.say(ali, second), http.StatusCreated, "")
	before := api.room("")
	newest := before.Moves[1]

	expect(t, api.adminDo("POST", fmt.Sprintf("content/moves/%d/remove", newest.ID), `{"reason":"نامناسب"}`, mod), http.StatusNoContent, "")
	expect(t, api.adminDo("POST", fmt.Sprintf("content/moves/%d/remove", newest.ID), `{}`, mod), http.StatusNoContent, "")

	after := api.room("")
	if len(after.Moves) != 2 || after.NextLetter != "ن" {
		t.Fatalf("room: %+v", after)
	}
	removed := after.Moves[1]
	if !removed.Removed || removed.ID != newest.ID || removed.Lines[0] != moveRemovedLine || removed.LastLetter != "ن" || after.Moves[0].Removed {
		t.Fatalf("removed move: %+v", removed)
	}
	if len(after.Leaders) != 1 || after.Leaders[0].Username != "sara" {
		t.Fatalf("leaders: %+v", after.Leaders)
	}

	entries := auditActions(t, api, api.userID("ali"))
	if len(entries) != 1 || !strings.Contains(string(entries[0].Detail), second[0]) || entries[0].Reason != "نامناسب" {
		t.Fatalf("audit: %+v", entries)
	}

	// An open client's expect still holds, and the verse can be said again.
	clock.advance(time.Minute)
	body, _ := json.Marshal(map[string]any{"lines": verseOf(2, "ن", "س"), "expect": newest.ID})
	next := api.do("POST", roomPath, string(body), sara)
	expect(t, next, http.StatusCreated, "")
	var out struct {
		Move Move `json:"move"`
	}
	if err := json.Unmarshal(next.Body.Bytes(), &out); err != nil || out.Move.ID <= newest.ID {
		t.Fatalf("next move: %s", next.Body)
	}
	clock.advance(time.Minute)
	expect(t, api.say(ali, []string{"س" + second[0][len("م"):]}), http.StatusCreated, "")

	// Removed verses leave the moderation list.
	list := api.adminDo("GET", "content/moves", "", admin)
	expect(t, list, http.StatusOK, "")
	if strings.Contains(list.Body.String(), moveRemovedLine) {
		t.Fatalf("list: %s", list.Body)
	}
}

func TestModeratorCannotTouchAdminContent(t *testing.T) {
	api, admin, mod, _ := staffAPI(t, quotePoems())
	_, quote := postQuote(t, api, admin, "ganjoor:hafez:1", 0, 1)
	id := api.userID("admin_a")
	expect(t, api.adminDo("POST", fmt.Sprintf("content/quotes/%d/remove", quote.ID), `{}`, mod), http.StatusForbidden, adminForbidden)
	expect(t, api.adminDo("POST", fmt.Sprintf("content/users/%d/clear", id), `{"field":"bio"}`, mod), http.StatusForbidden, adminForbidden)
	expect(t, api.adminDo("POST", fmt.Sprintf("content/quotes/%d/remove", quote.ID), `{}`, admin), http.StatusNoContent, "")
}

func TestRemoveQuote(t *testing.T) {
	api, _, mod, user := staffAPI(t, quotePoems())
	_, quote := postQuote(t, api, user, "ganjoor:hafez:1", 2, 3)
	expect(t, api.adminDo("POST", fmt.Sprintf("content/quotes/%d/remove", quote.ID), `{"reason":"x"}`, mod), http.StatusNoContent, "")
	expect(t, api.adminDo("POST", fmt.Sprintf("content/quotes/%d/remove", quote.ID), `{}`, mod), http.StatusNotFound, quoteMissingMessage)
	entries := auditActions(t, api, api.userID("user_a"))
	if len(entries) != 1 || entries[0].ObjectID != quote.ID || !strings.Contains(string(entries[0].Detail), "خط 2") {
		t.Fatalf("audit: %+v", entries)
	}
}

func TestClearProfile(t *testing.T) {
	api, _, mod, user := staffAPI(t, nil)
	id := api.userID("user_a")
	clear := func(field string) *httptest.ResponseRecorder {
		return api.adminDo("POST", fmt.Sprintf("content/users/%d/clear", id), `{"field":"`+field+`"}`, mod)
	}
	ref := uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(256, 256)), user)
	file := api.server.mediaPath(strings.TrimPrefix(ref, "img:"))
	expect(t, clear("avatar"), http.StatusNoContent, "")
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("file should be gone: %v", err)
	}
	expect(t, clear("avatar"), http.StatusConflict, nothingToClearMessage)
	// A preset motif is no upload; the field holds no image to remove.
	if _, err := api.server.store.db.Exec(`UPDATE users SET avatar = 'moon', bio = 'سلام', display_name = 'ناسزا' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	expect(t, clear("avatar"), http.StatusConflict, nothingToClearMessage)
	expect(t, clear("bio"), http.StatusNoContent, "")
	expect(t, clear("bio"), http.StatusConflict, nothingToClearMessage)
	expect(t, clear("displayName"), http.StatusNoContent, "")
	expect(t, clear("username"), http.StatusBadRequest, badClearFieldMessage)

	var bio, name string
	if err := api.server.store.db.QueryRow(`SELECT bio, display_name FROM users WHERE id = ?`, id).Scan(&bio, &name); err != nil {
		t.Fatal(err)
	}
	if bio != "" || name != "user_a" {
		t.Fatalf("bio %q name %q", bio, name)
	}
}

func TestAdminMigrationFromOldDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
			password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}');
		CREATE TABLE feedback (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL,
			contact TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
		INSERT INTO feedback (kind, message, created_at) VALUES ('bug', 'قدیمی', 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for range 2 {
		store, err := openStore(path)
		if err != nil {
			t.Fatal(err)
		}
		items, err := store.adminFeedback(t.Context(), "", "", 1<<63-1)
		if err != nil || len(items) != 1 || items[0].UserID != 0 {
			t.Fatalf("feedback %+v: %v", items, err)
		}
		var indexes int
		if err := store.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('users_staff', 'reads_day')`).Scan(&indexes); err != nil || indexes != 2 {
			t.Fatalf("indexes %d: %v", indexes, err)
		}
		store.db.Close()
	}
}

func TestOverviewCountsTehranDays(t *testing.T) {
	api, admin, _, _ := staffAPI(t, nil)
	store := api.server.store
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, tehran)
	store.now = func() time.Time { return now }
	if _, err := store.db.Exec(`UPDATE users SET created_at = 1`); err != nil {
		t.Fatal(err)
	}
	// 23:59 and 00:01 Tehran time fall on two days although both are the same
	// UTC day.
	lastNight := time.Date(2026, 3, 14, 23, 59, 0, 0, tehran).UnixMilli()
	today := time.Date(2026, 3, 15, 0, 1, 0, 0, tehran).UnixMilli()
	tooOld := time.Date(2026, 2, 13, 23, 59, 0, 0, tehran).UnixMilli()
	for i, at := range []int64{lastNight, today, tooOld} {
		if _, err := store.db.Exec(`INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, 'x', 'x', ?)`,
			fmt.Sprintf("new_%d", i), at); err != nil {
			t.Fatal(err)
		}
	}
	reader := api.userID("user_a")
	for _, day := range []string{"2026-03-15", "2026-03-14"} {
		if _, err := store.db.Exec(`INSERT INTO reads (user_id, poem_key, day, read_at) VALUES (?, 'k', ?, 1)`, reader, day); err != nil {
			t.Fatal(err)
		}
	}
	rec := api.adminDo("GET", "overview", "", admin)
	expect(t, rec, http.StatusOK, "")
	var out struct {
		Overview AdminOverview `json:"overview"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	o := out.Overview
	if o.Users != 6 || o.Staff != 2 || len(o.Trend) != trendDays {
		t.Fatalf("overview: %+v", o)
	}
	if o.Trend[0].Day != "2026-02-14" || o.Trend[trendDays-1].Day != "2026-03-15" {
		t.Fatalf("trend range: %s..%s", o.Trend[0].Day, o.Trend[trendDays-1].Day)
	}
	if o.Trend[trendDays-1].Signups != 1 || o.Trend[trendDays-2].Signups != 1 || o.Trend[0].Signups != 0 {
		t.Fatalf("trend: %+v", o.Trend[trendDays-2:])
	}
	if o.Signups != (Window{Day: 1, Week: 2, Month: 2}) {
		t.Fatalf("signups: %+v", o.Signups)
	}
	// Two days of one reader is still one active user.
	if o.Active != (Window{Day: 1, Week: 1, Month: 1}) {
		t.Fatalf("active: %+v", o.Active)
	}
}

func TestRunCommandUsage(t *testing.T) {
	for _, args := range [][]string{{"set-role"}, {"other", "a", "b"}} {
		if err := runCommand(args); err == nil {
			t.Fatalf("%v should fail", args)
		}
	}
}
