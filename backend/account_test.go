package main

import (
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
		FollowedPoetKeys: []string{"ganjoor:hafez", "ganjoor:hafez", "<script>", "custom:شاعر"},
		InterestKeys:     []string{"love", "LOVE", "wine"},
	}
	clean := sanitizeAccountData(dirty)
	if len(clean.Favorites) != 2 || clean.Favorites[1].Source != "ganjoor" {
		t.Fatalf("unsafe links kept or source not defaulted: %+v", clean.Favorites)
	}
	if strings.Join(clean.FollowedPoetKeys, ",") != "ganjoor:hafez,custom:شاعر" {
		t.Fatalf("followed keys %v", clean.FollowedPoetKeys)
	}
	if strings.Join(clean.InterestKeys, ",") != "love,wine" {
		t.Fatalf("interest keys %v", clean.InterestKeys)
	}

	device := AccountData{Favorites: []Entry{entry("a", 5), entry("b", 2)}, FollowedPoetKeys: []string{"ganjoor:saadi"}}
	account := AccountData{Favorites: []Entry{entry("a", 1), entry("c", 3)}, FollowedPoetKeys: []string{"ganjoor:hafez"}}
	merged := mergeAccountData(account, device)
	var keys []string
	for _, e := range merged.Favorites {
		keys = append(keys, e.Key)
	}
	if strings.Join(keys, ",") != "a,c,b" || merged.Favorites[0].SavedAt != 5 {
		t.Fatalf("merge should union, dedupe to newest and sort newest first: %v", merged.Favorites)
	}
	if len(merged.FollowedPoetKeys) != 2 {
		t.Fatalf("followed poets not unioned: %v", merged.FollowedPoetKeys)
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

	if res := do("POST", "/api/account/logout", "", cookie); res.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", res.Code)
	}
	if res := do("GET", "/api/account/me", "", cookie); res.Code != http.StatusUnauthorized {
		t.Fatalf("session should be gone after logout: %d", res.Code)
	}
}

func TestRateLimiter(t *testing.T) {
	l := newRateLimiter(2, 60_000_000_000)
	if !l.allow("ip") || !l.allow("ip") || l.allow("ip") || !l.allow("other") {
		t.Fatal("limiter should allow 2 per key")
	}
}
