package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateSignup(t *testing.T) {
	in, err := validateSignup(SignupInput{Username: "  Hadi_7 ", Password: "long enough", DisplayName: " \x00هادی "})
	if err != nil || in.Username != "hadi_7" || in.DisplayName != "هادی" {
		t.Fatalf("valid signup rejected or not cleaned: %+v %v", in, err)
	}
	if in, _ := validateSignup(SignupInput{Username: "abc", Password: "12345678"}); in.DisplayName != "abc" {
		t.Fatalf("display name should default to username, got %q", in.DisplayName)
	}
	for _, bad := range []SignupInput{
		{Username: "ab", Password: "12345678"},
		{Username: "حافظ", Password: "12345678"},
		{Username: "a b c", Password: "12345678"},
		{Username: "hadi", Password: "short"},
		{Username: "hadi", Password: strings.Repeat("x", maxPasswordLen+1)},
	} {
		if _, err := validateSignup(bad); err == nil {
			t.Errorf("expected rejection for %+v", bad)
		}
	}
}

func TestPasswordHashing(t *testing.T) {
	hash, err := hashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("unexpected hash format %q", hash)
	}
	other, _ := hashPassword("correct horse")
	if other == hash {
		t.Fatal("salt is not random")
	}
	if !verifyPassword("correct horse", hash) {
		t.Fatal("right password rejected")
	}
	if verifyPassword("wrong horse", hash) || verifyPassword("correct horse", "garbage") {
		t.Fatal("wrong password or malformed hash accepted")
	}
	if verifyPassword("x", "$argon2id$v=19$m=999999999,t=2,p=1$AAAA$AAAA") {
		t.Fatal("absurd parameters accepted")
	}
}

func TestSessionTokens(t *testing.T) {
	a, _ := newSessionToken()
	b, _ := newSessionToken()
	if a == b || len(a) < 40 {
		t.Fatalf("weak tokens %q %q", a, b)
	}
	if hashSessionToken(a) == a || hashSessionToken(a) != hashSessionToken(a) {
		t.Fatal("token hash must be stable and differ from the token")
	}
}

func entry(key string, savedAt int64) Entry {
	return Entry{Key: key, ID: 1, Source: "ganjoor", Href: "/poem/1", Title: key, SavedAt: savedAt}
}

func TestSanitizeAndMerge(t *testing.T) {
	dirty := AccountData{
		Favorites: []Entry{
			entry("a", 1),
			{Key: "x", ID: 1, Href: "javascript:alert(1)", SavedAt: 1},
			{Key: "y", ID: 1, Href: "//evil.example", SavedAt: 1},
			{Key: "z", ID: 1, Href: "/poem/1", SavedAt: 1, Source: "nope"},
		},
		PreferredPoetKeys: []string{"ganjoor:hafez", "ganjoor:hafez", "<script>", "custom:شاعر"},
		InterestKeys:      []string{"love", "LOVE", "wine"},
	}
	clean := sanitizeAccountData(dirty)
	if len(clean.Favorites) != 2 || clean.Favorites[1].Source != "ganjoor" {
		t.Fatalf("unsafe links kept or source not defaulted: %+v", clean.Favorites)
	}
	if strings.Join(clean.PreferredPoetKeys, ",") != "ganjoor:hafez,custom:شاعر" {
		t.Fatalf("preferred keys %v", clean.PreferredPoetKeys)
	}
	if strings.Join(clean.InterestKeys, ",") != "love,wine" {
		t.Fatalf("interest keys %v", clean.InterestKeys)
	}

	device := AccountData{Favorites: []Entry{entry("a", 5), entry("b", 2)}, PreferredPoetKeys: []string{"ganjoor:saadi"}}
	account := AccountData{Favorites: []Entry{entry("a", 1), entry("c", 3)}, PreferredPoetKeys: []string{"ganjoor:hafez"}}
	merged := mergeAccountData(account, device)
	var keys []string
	for _, e := range merged.Favorites {
		keys = append(keys, e.Key)
	}
	if strings.Join(keys, ",") != "a,c,b" || merged.Favorites[0].SavedAt != 5 {
		t.Fatalf("merge should union, dedupe to newest and sort newest first: %v", merged.Favorites)
	}
	if len(merged.PreferredPoetKeys) != 2 {
		t.Fatalf("preferred poets not unioned: %v", merged.PreferredPoetKeys)
	}

	many := make([]Entry, 0, maxHistory+10)
	for i := range maxHistory + 10 {
		many = append(many, entry(string(rune('a'+i)), int64(i+1)))
	}
	if got := len(sanitizeAccountData(AccountData{History: many}).History); got != maxHistory {
		t.Fatalf("history not capped: %d", got)
	}
}

// TestHTTPFlow runs the real handlers against a temporary database.
func TestHTTPFlow(t *testing.T) {
	store, err := openStore(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	handler := newServer(store).routes()

	do := func(method, path, body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	res := do("POST", "/api/account/signup", `{"username":"Hafez","password":"shirazi-1390","displayName":"حافظ"}`, "")
	if res.Code != http.StatusCreated {
		t.Fatalf("signup: %d %s", res.Code, res.Body)
	}
	setCookie := res.Header().Get("Set-Cookie")
	for _, flag := range []string{"HttpOnly", "Secure", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(setCookie, flag) {
			t.Fatalf("cookie missing %s: %s", flag, setCookie)
		}
	}
	cookie := strings.SplitN(setCookie, ";", 2)[0]

	if res := do("POST", "/api/account/signup", `{"username":"hafez","password":"another-pass"}`, ""); res.Code != http.StatusConflict {
		t.Fatalf("duplicate signup: %d", res.Code)
	}

	unknown := do("POST", "/api/account/login", `{"username":"nobody","password":"shirazi-1390"}`, "")
	wrong := do("POST", "/api/account/login", `{"username":"hafez","password":"wrong-pass"}`, "")
	if unknown.Code != http.StatusUnauthorized || wrong.Code != http.StatusUnauthorized || unknown.Body.String() != wrong.Body.String() {
		t.Fatalf("login failures must be identical 401s: %d %s / %d %s", unknown.Code, unknown.Body, wrong.Code, wrong.Body)
	}

	if res := do("POST", "/api/account/login", `{"username":"hafez"}`, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("missing password: %d", res.Code)
	}
	req := httptest.NewRequest("POST", "/api/account/login", strings.NewReader("username=hafez"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("form posts must be refused (CSRF): %d", rec.Code)
	}

	if res := do("PUT", "/api/account/data", `{"merge":true,"data":{"favorites":[{"key":"ganjoor:hafez:1","id":1,"href":"/poem/1","savedAt":10}],"interestKeys":["love"]}}`, cookie); res.Code != http.StatusOK {
		t.Fatalf("save data: %d %s", res.Code, res.Body)
	}
	me := do("GET", "/api/account/me", "", cookie)
	var body struct {
		User User        `json:"user"`
		Data AccountData `json:"data"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &body); err != nil || me.Code != http.StatusOK {
		t.Fatalf("me: %d %s", me.Code, me.Body)
	}
	if body.User.Username != "hafez" || body.User.DisplayName != "حافظ" || len(body.Data.Favorites) != 1 || body.Data.InterestKeys[0] != "love" {
		t.Fatalf("unexpected profile %+v", body)
	}
	if strings.Contains(me.Body.String(), "argon2") {
		t.Fatal("password hash leaked")
	}

	// Public profile: no cookie, allow-listed fields only, "now reading" after a new history head.
	do("PUT", "/api/account/data", `{"merge":false,"data":{"favorites":[{"key":"ganjoor:hafez:1","id":1,"href":"/poem/1","savedAt":10}],"history":[{"key":"ganjoor:hafez:2","id":2,"href":"/poem/2","savedAt":20}],"preferredPoetKeys":["ganjoor:saadi"]}}`, cookie)
	public := do("GET", "/api/account/users/Hafez", "", "")
	var pub struct{ Profile PublicProfile }
	if err := json.Unmarshal(public.Body.Bytes(), &pub); err != nil || public.Code != http.StatusOK {
		t.Fatalf("public profile: %d %s", public.Code, public.Body)
	}
	if pub.Profile.NowReading == nil || pub.Profile.NowReading.ID != 2 || pub.Profile.FavoriteCount != 1 {
		t.Fatalf("unexpected public profile %+v", pub.Profile)
	}
	for _, private := range []string{"saadi", "preferredPoetKeys", "followedPoetKeys", "history", "interest", "isPublic"} {
		if strings.Contains(public.Body.String(), private) {
			t.Fatalf("public profile leaks %q: %s", private, public.Body)
		}
	}
	if res := do("GET", "/api/account/users/nobody", "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("unknown profile: %d", res.Code)
	}
	if res := do("PUT", "/api/account/visibility", `{"isPublic":false}`, cookie); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"isPublic":false`) {
		t.Fatalf("visibility: %d %s", res.Code, res.Body)
	}
	if res := do("GET", "/api/account/users/hafez", "", ""); res.Code != http.StatusNotFound || res.Body.String() != do("GET", "/api/account/users/nobody", "", "").Body.String() {
		t.Fatalf("private profile must look like an unknown one: %d %s", res.Code, res.Body)
	}
	if res := do("PUT", "/api/account/visibility", `{"isPublic":true}`, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("visibility without session: %d", res.Code)
	}

	if res := do("POST", "/api/account/logout", "", cookie); res.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", res.Code)
	}
	if res := do("GET", "/api/account/me", "", cookie); res.Code != http.StatusUnauthorized {
		t.Fatalf("session should be gone after logout: %d", res.Code)
	}
}

func TestPublicProfile(t *testing.T) {
	u := User{Username: "hafez", DisplayName: "حافظ"}
	d := AccountData{
		Favorites:         []Entry{entry("f", 1)},
		History:           []Entry{entry("new", 9), entry("old", 5)},
		PreferredPoetKeys: []string{"ganjoor:saadi"},
	}
	now := int64(100 * 60_000)
	live := buildPublicProfile(u, d, now-60_000, now)
	if live.NowReading == nil || live.NowReading.Key != "new" || live.LastPoem == nil || live.LastPoem.Key != "old" {
		t.Fatalf("recent push should show now reading + previous poem: %+v", live)
	}
	idle := buildPublicProfile(u, d, now-readingWindow.Milliseconds()-1, now)
	if idle.NowReading != nil || idle.LastPoem == nil || idle.LastPoem.Key != "new" {
		t.Fatalf("stale push should only show the last poem: %+v", idle)
	}
	empty := buildPublicProfile(u, AccountData{}, 0, now)
	if empty.NowReading != nil || empty.LastPoem != nil || empty.Favorites == nil {
		t.Fatalf("empty account: %+v", empty)
	}
	if !historyHeadChanged(nil, d.History) || historyHeadChanged(d.History, d.History) ||
		!historyHeadChanged(d.History, []Entry{entry("new", 10)}) || historyHeadChanged(d.History, nil) {
		t.Fatal("historyHeadChanged")
	}
}

func TestRateLimiter(t *testing.T) {
	l := newRateLimiter(2, 60_000_000_000)
	if !l.allow("ip") || !l.allow("ip") || l.allow("ip") || !l.allow("other") {
		t.Fatal("limiter should allow 2 per key")
	}
}

func TestMigrateOldDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
		password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}');
		INSERT INTO users (username, display_name, password_hash, created_at) VALUES ('saadi', 'سعدی', 'x', 1)`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for range 2 { // the second open must be a no-op
		store, err := openStore(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.publicProfile(t.Context(), "saadi"); err != nil {
			t.Fatalf("existing users should default to public: %v", err)
		}
		store.db.Close()
	}
}

func TestRecoveryCodes(t *testing.T) {
	code, err := newRecoveryCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 19 || strings.Count(code, "-") != 3 || strings.ContainsAny(code, "ILOU") {
		t.Fatalf("unexpected code format %q", code)
	}
	hash, err := hashRecoveryCode(code)
	if err != nil {
		t.Fatal(err)
	}
	typed := strings.ToLower(strings.ReplaceAll(code, "-", " "))
	if !verifyRecoveryCode(code, hash) || !verifyRecoveryCode(typed, hash) {
		t.Fatal("a code should verify however it is typed")
	}
	if normalizeRecoveryCode("o1l-i") != "0111" {
		t.Fatalf("Crockford look-alikes: %q", normalizeRecoveryCode("o1l-i"))
	}
	if verifyRecoveryCode("", hash) || verifyRecoveryCode(code[:18], hash) {
		t.Fatal("empty or short codes must not verify")
	}
}

func TestValidateProfile(t *testing.T) {
	in, err := validateProfile(ProfileInput{Username: " Saadi ", DisplayName: "", Avatar: "tulip"})
	if err != nil || in.Username != "saadi" || in.DisplayName != "saadi" || in.Avatar != "tulip" {
		t.Fatalf("valid profile rejected or not cleaned: %+v %v", in, err)
	}
	for _, bad := range []ProfileInput{{Username: "ab"}, {Username: "saadi", Avatar: "moon"}} {
		if _, err := validateProfile(bad); err == nil {
			t.Errorf("expected rejection for %+v", bad)
		}
	}
}

func TestCredentialsFlow(t *testing.T) {
	store, err := openStore(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	handler := newServer(store).routes()
	do := func(method, path, body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	cookieOf := func(res *httptest.ResponseRecorder) string {
		return strings.SplitN(res.Header().Get("Set-Cookie"), ";", 2)[0]
	}
	var withCode struct {
		User         User   `json:"user"`
		RecoveryCode string `json:"recoveryCode"`
	}

	res := do("POST", "/api/account/signup", `{"username":"rumi","password":"masnavi-123"}`, "")
	if err := json.Unmarshal(res.Body.Bytes(), &withCode); err != nil || res.Code != http.StatusCreated || withCode.RecoveryCode == "" || !withCode.User.HasRecoveryCode {
		t.Fatalf("signup should return a recovery code: %d %s", res.Code, res.Body)
	}
	firstCode, cookie := withCode.RecoveryCode, cookieOf(res)

	// Forgot password: unknown user and wrong code fail identically.
	unknown := do("POST", "/api/account/reset", `{"username":"nobody","recoveryCode":"`+firstCode+`","newPassword":"new-password-1"}`, "")
	wrong := do("POST", "/api/account/reset", `{"username":"rumi","recoveryCode":"0000-0000-0000-0000","newPassword":"new-password-1"}`, "")
	if unknown.Code != http.StatusUnauthorized || wrong.Code != http.StatusUnauthorized || unknown.Body.String() != wrong.Body.String() {
		t.Fatalf("reset failures must be identical 401s: %d %s / %d %s", unknown.Code, unknown.Body, wrong.Code, wrong.Body)
	}
	res = do("POST", "/api/account/reset", `{"username":"RUMI","recoveryCode":"`+strings.ToLower(firstCode)+`","newPassword":"new-password-1"}`, "")
	if err := json.Unmarshal(res.Body.Bytes(), &withCode); err != nil || res.Code != http.StatusOK || withCode.RecoveryCode == firstCode {
		t.Fatalf("reset with the code: %d %s", res.Code, res.Body)
	}
	secondCode, resetCookie := withCode.RecoveryCode, cookieOf(res)
	if do("GET", "/api/account/me", "", cookie).Code != http.StatusUnauthorized {
		t.Fatal("a reset must sign out existing sessions")
	}
	if do("GET", "/api/account/me", "", resetCookie).Code != http.StatusOK {
		t.Fatal("the reset should leave the user signed in")
	}
	if do("POST", "/api/account/reset", `{"username":"rumi","recoveryCode":"`+firstCode+`","newPassword":"new-password-2"}`, "").Code != http.StatusUnauthorized {
		t.Fatal("a used recovery code must not work twice")
	}
	if do("POST", "/api/account/login", `{"username":"rumi","password":"new-password-1"}`, "").Code != http.StatusOK {
		t.Fatal("login with the new password")
	}

	// Change password: needs the current one.
	if res := do("PUT", "/api/account/password", `{"currentPassword":"masnavi-123","newPassword":"third-password"}`, resetCookie); res.Code != http.StatusForbidden {
		t.Fatalf("wrong current password: %d", res.Code)
	}
	res = do("PUT", "/api/account/password", `{"currentPassword":"new-password-1","newPassword":"third-password"}`, resetCookie)
	if res.Code != http.StatusOK {
		t.Fatalf("change password: %d %s", res.Code, res.Body)
	}
	cookie = cookieOf(res)
	if do("GET", "/api/account/me", "", resetCookie).Code != http.StatusUnauthorized || do("GET", "/api/account/me", "", cookie).Code != http.StatusOK {
		t.Fatal("changing the password should replace the session")
	}

	// New recovery code: needs the password; the previous code stops working.
	if res := do("POST", "/api/account/recovery-code", `{"password":"wrong"}`, cookie); res.Code != http.StatusForbidden {
		t.Fatalf("recovery code without the password: %d", res.Code)
	}
	res = do("POST", "/api/account/recovery-code", `{"password":"third-password"}`, cookie)
	if err := json.Unmarshal(res.Body.Bytes(), &withCode); err != nil || res.Code != http.StatusOK || withCode.RecoveryCode == secondCode {
		t.Fatalf("new recovery code: %d %s", res.Code, res.Body)
	}
	if do("POST", "/api/account/reset", `{"username":"rumi","recoveryCode":"`+secondCode+`","newPassword":"new-password-2"}`, "").Code != http.StatusUnauthorized {
		t.Fatal("a replaced recovery code must not work")
	}

	// Profile: rename, avatar, conflicts.
	do("POST", "/api/account/signup", `{"username":"saadi","password":"golestan-12"}`, "")
	if res := do("PUT", "/api/account/profile", `{"username":"saadi","displayName":"x","avatar":""}`, cookie); res.Code != http.StatusConflict {
		t.Fatalf("taken username: %d", res.Code)
	}
	if res := do("PUT", "/api/account/profile", `{"username":"rumi","displayName":"x","avatar":"moon"}`, cookie); res.Code != http.StatusBadRequest {
		t.Fatalf("unknown avatar: %d", res.Code)
	}
	if res := do("PUT", "/api/account/profile", `{"username":"Molana","displayName":"مولانا","avatar":"candle"}`, cookie); res.Code != http.StatusOK {
		t.Fatalf("update profile: %d %s", res.Code, res.Body)
	}
	me := do("GET", "/api/account/me", "", cookie).Body.String()
	if !strings.Contains(me, `"username":"molana"`) || !strings.Contains(me, `"avatar":"candle"`) {
		t.Fatalf("profile not updated: %s", me)
	}
	if public := do("GET", "/api/account/users/molana", "", "").Body.String(); !strings.Contains(public, `"avatar":"candle"`) || strings.Contains(public, "recovery") {
		t.Fatalf("public profile: %s", public)
	}
}

func TestFeedback(t *testing.T) {
	store, err := openStore(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	handler := newServer(store).routes()
	do := func(body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/account/feedback", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	for _, bad := range []string{`{"kind":"spam","message":"سلام دنیا"}`, `{"kind":"bug","message":"  ه  "}`} {
		if res := do(bad, ""); res.Code != http.StatusBadRequest {
			t.Fatalf("invalid feedback %s: %d", bad, res.Code)
		}
	}
	if res := do(`{"kind":"bug","message":"صفحه\r\nباز نمی‌شود\u0007","page":"/hafez"}`, ""); res.Code != http.StatusNoContent {
		t.Fatalf("anonymous feedback: %d %s", res.Code, res.Body)
	}

	signup := httptest.NewRequest("POST", "/api/account/signup", strings.NewReader(`{"username":"saadi","password":"golestan-12"}`))
	signup.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, signup)
	cookie := strings.SplitN(rec.Header().Get("Set-Cookie"), ";", 2)[0]
	if res := do(`{"kind":"suggestion","message":"پیشنهادی دارم","contact":"a@b.c"}`, cookie); res.Code != http.StatusNoContent {
		t.Fatalf("signed-in feedback: %d %s", res.Code, res.Body)
	}

	rows, err := store.db.Query(`SELECT kind, message, username FROM feedback ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var kind, message, username string
		if err := rows.Scan(&kind, &message, &username); err != nil {
			t.Fatal(err)
		}
		got = append(got, kind+"|"+message+"|"+username)
	}
	want := []string{"bug|صفحه\nباز نمی‌شود|", "suggestion|پیشنهادی دارم|saadi"}
	if strings.Join(got, ";") != strings.Join(want, ";") {
		t.Fatalf("stored feedback = %q, want %q", got, want)
	}

	// Two invalid + two accepted so far; the hourly budget is 5 per IP.
	do(`{"kind":"other","message":"سوم"}`, "")
	if res := do(`{"kind":"other","message":"چهارم"}`, ""); res.Code != http.StatusTooManyRequests {
		t.Fatalf("rate limit: %d", res.Code)
	}
}

// TestLegacyFollowedPoetKeys covers rows and clients from before poets were "preferred" rather than followed.
func TestLegacyFollowedPoetKeys(t *testing.T) {
	var d AccountData
	if err := json.Unmarshal([]byte(`{"followedPoetKeys":["ganjoor:saadi"],"preferredPoetKeys":["ganjoor:hafez"]}`), &d); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(sanitizeAccountData(d).PreferredPoetKeys, ","); got != "ganjoor:hafez,ganjoor:saadi" {
		t.Fatalf("legacy key not read: %q", got)
	}
	out, _ := json.Marshal(d)
	if strings.Contains(string(out), "followedPoetKeys") {
		t.Fatalf("legacy name must not be written back: %s", out)
	}
}

func TestFollowUsers(t *testing.T) {
	store, err := openStore(filepath.Join(t.TempDir(), "accounts.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	handler := newServer(store).routes()

	do := func(method, path, body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	signup := func(username string) string {
		res := do("POST", "/api/account/signup", `{"username":"`+username+`","password":"long enough pass"}`, "")
		if res.Code != http.StatusCreated {
			t.Fatalf("signup %s: %d %s", username, res.Code, res.Body)
		}
		return strings.SplitN(res.Header().Get("Set-Cookie"), ";", 2)[0]
	}
	counts := func(username string) (int, int) {
		var pub struct{ Profile PublicProfile }
		res := do("GET", "/api/account/users/"+username, "", "")
		if err := json.Unmarshal(res.Body.Bytes(), &pub); err != nil || res.Code != http.StatusOK {
			t.Fatalf("profile %s: %d %s", username, res.Code, res.Body)
		}
		return pub.Profile.FollowerCount, pub.Profile.FollowingCount
	}
	hafez, saadi, rumi := signup("hafez"), signup("saadi"), signup("rumi")

	if res := do("PUT", "/api/account/follow/saadi", "", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("follow without session: %d", res.Code)
	}
	if res := do("PUT", "/api/account/follow/hafez", "", hafez); res.Code != http.StatusBadRequest {
		t.Fatalf("following yourself: %d", res.Code)
	}
	if res := do("PUT", "/api/account/follow/nobody", "", hafez); res.Code != http.StatusNotFound {
		t.Fatalf("following an unknown user: %d", res.Code)
	}

	for range 2 { // following twice is the same as once
		if res := do("PUT", "/api/account/follow/Saadi", "", hafez); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"following":true`) {
			t.Fatalf("follow: %d %s", res.Code, res.Body)
		}
	}
	do("PUT", "/api/account/follow/saadi", "", rumi)
	do("PUT", "/api/account/follow/rumi", "", saadi)
	if followers, following := counts("saadi"); followers != 2 || following != 1 {
		t.Fatalf("saadi counts: %d followers, %d following", followers, following)
	}
	if res := do("GET", "/api/account/follow/saadi", "", hafez); !strings.Contains(res.Body.String(), `"following":true`) {
		t.Fatalf("follow state: %s", res.Body)
	}
	if res := do("GET", "/api/account/follow/hafez", "", saadi); !strings.Contains(res.Body.String(), `"following":false`) {
		t.Fatalf("follow state: %s", res.Body)
	}

	var list struct{ Users []FollowUser }
	res := do("GET", "/api/account/followers", "", saadi)
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil || len(list.Users) != 2 || list.Users[0].Username != "rumi" {
		t.Fatalf("followers newest first: %d %s", res.Code, res.Body)
	}
	for _, private := range []string{"password", "createdAt", "isPublic"} {
		if strings.Contains(res.Body.String(), private) {
			t.Fatalf("follower list leaks %q: %s", private, res.Body)
		}
	}
	res = do("GET", "/api/account/following", "", hafez)
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil || len(list.Users) != 1 || list.Users[0].Username != "saadi" {
		t.Fatalf("following: %d %s", res.Code, res.Body)
	}
	if res := do("GET", "/api/account/followers", "", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("lists are private to their owner: %d", res.Code)
	}

	// A private account drops out of counts and lists, and cannot be followed anew.
	do("PUT", "/api/account/visibility", `{"isPublic":false}`, rumi)
	if followers, _ := counts("saadi"); followers != 1 {
		t.Fatalf("private follower still counted: %d", followers)
	}
	if res := do("PUT", "/api/account/follow/rumi", "", hafez); res.Code != http.StatusNotFound {
		t.Fatalf("following a private account: %d", res.Code)
	}
	// ...but an existing follow can still be undone.
	if res := do("DELETE", "/api/account/follow/rumi", "", saadi); res.Code != http.StatusOK {
		t.Fatalf("unfollow private: %d", res.Code)
	}
	if res := do("DELETE", "/api/account/follow/saadi", "", hafez); !strings.Contains(res.Body.String(), `"following":false`) {
		t.Fatalf("unfollow: %d %s", res.Code, res.Body)
	}
	if followers, _ := counts("saadi"); followers != 0 {
		t.Fatalf("follower count after unfollow: %d", followers)
	}

	me := do("GET", "/api/account/me", "", saadi)
	if !strings.Contains(me.Body.String(), `"follows":{"followers":0,"following":0}`) {
		t.Fatalf("me should carry follow counts: %s", me.Body)
	}
}

func TestLovedCollections(t *testing.T) {
	book := func(key string, id int64, savedAt int64) CollectionEntry {
		return CollectionEntry{Key: key, Source: "ganjoor", CategoryID: id, PoetSlug: "hafez", Title: "دیوان", Href: "/hafez", SavedAt: savedAt}
	}
	dirty := AccountData{LovedCollections: []CollectionEntry{
		book("ganjoor:hafez:1", 1, 5),
		book("ganjoor:hafez:1", 1, 9), // newer copy of the same book wins
		book("ganjoor:hafez:nocat", 0, 3),
		{Key: "x", Source: "ganjoor", CategoryID: 2, Title: "t", Href: "//evil.example", SavedAt: 1},
		{Key: "custom:rahmani:یاد", Source: "custom", CategoryID: 77, PoetSlug: "rahmani", Title: "یاد", Href: "/rahmani", SavedAt: 7},
		{Key: "notitle", Source: "custom", Href: "/rahmani", SavedAt: 1},
	}}
	clean := sanitizeAccountData(dirty).LovedCollections
	if len(clean) != 2 || clean[0].SavedAt != 9 || clean[1].Source != "custom" || clean[1].CategoryID != 0 {
		t.Fatalf("books not sanitized: %+v", clean)
	}

	merged := mergeAccountData(
		AccountData{LovedCollections: []CollectionEntry{book("a", 1, 1)}},
		AccountData{LovedCollections: []CollectionEntry{book("b", 2, 2)}},
	)
	if len(merged.LovedCollections) != 2 || merged.LovedCollections[0].Key != "b" {
		t.Fatalf("books not unioned: %+v", merged.LovedCollections)
	}

	many := make([]CollectionEntry, 0, maxPublicBooks+5)
	for i := range maxPublicBooks + 5 {
		many = append(many, book(string(rune('a'+i)), int64(i+1), int64(i+1)))
	}
	profile := buildPublicProfile(User{Username: "hafez"}, AccountData{LovedCollections: many}, 0, 1)
	if len(profile.LovedCollections) != maxPublicBooks {
		t.Fatalf("public books not capped: %d", len(profile.LovedCollections))
	}
	if empty := buildPublicProfile(User{}, AccountData{}, 0, 1); empty.LovedCollections == nil {
		t.Fatal("empty books must serialize as []")
	}
}
