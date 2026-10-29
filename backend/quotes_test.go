package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// quotePoems has one poem of 30 lines ("خط 0" …) and a short one.
func quotePoems() fakePoems {
	lines := make([]string, 30)
	for i := range lines {
		lines[i] = fmt.Sprintf("خط %d", i)
	}
	return fakePoems{
		"ganjoor:hafez:1": {Source: "ganjoor", PoetSlug: "hafez", PoetName: "حافظ", Title: "غزل ۱", Href: "/poem/1", Lines: lines},
		"ganjoor:hafez:2": {Source: "ganjoor", PoetSlug: "hafez", PoetName: "حافظ", Title: "غزل ۲", Href: "/poem/2", Lines: []string{"الف", "ب", "پ", "ت"}},
	}
}

// downPoems is a poem service that is unreachable.
type downPoems struct{}

func (downPoems) PoemText(context.Context, string) (PoemText, error) {
	return PoemText{}, errors.New("connection refused")
}

func postQuote(t *testing.T, api *testAPI, cookie, key string, from, to int) (int, Quote) {
	t.Helper()
	res := api.do("POST", "/api/account/quotes", fmt.Sprintf(`{"key":%q,"from":%d,"to":%d}`, key, from, to), cookie)
	var out struct {
		Quote Quote `json:"quote"`
	}
	if res.Code == http.StatusOK || res.Code == http.StatusCreated {
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
	}
	return res.Code, out.Quote
}

type quotePage struct {
	Quotes []Quote `json:"quotes"`
	Next   *int64  `json:"next"`
}

func userQuotes(t *testing.T, api *testAPI, username, query string) quotePage {
	t.Helper()
	res := api.do("GET", "/api/account/users/"+username+"/quotes"+query, "", "")
	if res.Code != http.StatusOK {
		t.Fatalf("user quotes: %d %s", res.Code, res.Body)
	}
	var page quotePage
	if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func followingQuotes(t *testing.T, api *testAPI, cookie string) []StoryPerson {
	t.Helper()
	res := api.do("GET", "/api/account/following/quotes", "", cookie)
	if res.Code != http.StatusOK {
		t.Fatalf("following quotes: %d %s", res.Code, res.Body)
	}
	var out struct {
		People []StoryPerson `json:"people"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.People == nil {
		t.Fatal("people must be a list, not null")
	}
	return out.People
}

func TestCreateQuote(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	newReadClock(api)
	cookie := api.signUp("hafez")

	code, q := postQuote(t, api, cookie, "ganjoor:hafez:1", 2, 3)
	if code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	want := Quote{ID: q.ID, Key: "ganjoor:hafez:1", Href: "/poem/1", PoetName: "حافظ", PoemTitle: "غزل ۱",
		From: 2, To: 3, Lines: []string{"خط 2", "خط 3"}, CreatedAt: q.CreatedAt}
	if q.ID == 0 || q.CreatedAt == 0 || fmt.Sprint(q) != fmt.Sprint(want) {
		t.Fatalf("quote: %+v", q)
	}

	// A single line and the longest allowed range (8 lines).
	if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", 5, 5); code != http.StatusCreated {
		t.Fatalf("single line: %d", code)
	}
	if code, q := postQuote(t, api, cookie, "ganjoor:hafez:1", 10, 17); code != http.StatusCreated || len(q.Lines) != 8 {
		t.Fatalf("eight lines: %d %+v", code, q)
	}
}

func TestCreateQuoteSameRangeReturnsExisting(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	newReadClock(api)
	cookie := api.signUp("hafez")

	_, first := postQuote(t, api, cookie, "ganjoor:hafez:1", 0, 1)
	code, again := postQuote(t, api, cookie, "ganjoor:hafez:1", 0, 1)
	if code != http.StatusOK || again.ID != first.ID {
		t.Fatalf("same range: %d %+v (first %+v)", code, again, first)
	}
	// Another range of the same poem, or the same range by someone else, is new.
	if code, other := postQuote(t, api, cookie, "ganjoor:hafez:1", 0, 2); code != http.StatusCreated || other.ID == first.ID {
		t.Fatalf("other range: %d %+v", code, other)
	}
	friend := api.signUp("saadi")
	if code, mine := postQuote(t, api, friend, "ganjoor:hafez:1", 0, 1); code != http.StatusCreated || mine.ID == first.ID {
		t.Fatalf("other user: %d %+v", code, mine)
	}
	if got := userQuotes(t, api, "hafez", ""); len(got.Quotes) != 2 {
		t.Fatalf("dedupe stored a copy: %+v", got.Quotes)
	}
}

func TestCreateQuoteErrors(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	cookie := api.signUp("hafez")

	if res := api.do("POST", "/api/account/quotes", `{"key":"ganjoor:hafez:1","from":0,"to":0}`, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", res.Code)
	}
	for _, c := range []struct {
		name     string
		key      string
		from, to int
	}{
		{"reversed", "ganjoor:hafez:1", 3, 2},
		{"negative", "ganjoor:hafez:1", -1, 1},
		{"past the end", "ganjoor:hafez:2", 2, 4},
		{"nine lines", "ganjoor:hafez:1", 0, 8},
	} {
		if code, _ := postQuote(t, api, cookie, c.key, c.from, c.to); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", c.name, code)
		}
	}
	if code, _ := postQuote(t, api, cookie, "not a key", 0, 0); code != http.StatusBadRequest {
		t.Errorf("bad key: %d", code)
	}
	res := api.do("POST", "/api/account/quotes", `{"key":"ganjoor:hafez:999","from":0,"to":0}`, cookie)
	if res.Code != http.StatusNotFound || !strings.Contains(res.Body.String(), "این شعر پیدا نشد.") {
		t.Fatalf("unknown poem: %d %s", res.Code, res.Body)
	}
	if got := userQuotes(t, api, "hafez", ""); len(got.Quotes) != 0 {
		t.Fatalf("failed requests stored quotes: %+v", got.Quotes)
	}
}

func TestCreateQuotePoemServiceDown(t *testing.T) {
	api := newTestAPI(t, nil)
	api.server.poems = downPoems{}
	cookie := api.signUp("hafez")
	res := api.do("POST", "/api/account/quotes", `{"key":"ganjoor:hafez:1","from":0,"to":0}`, cookie)
	if res.Code != http.StatusBadGateway || !strings.Contains(res.Body.String(), "error") {
		t.Fatalf("poem service down: %d %s", res.Code, res.Body)
	}
}

func TestDeleteQuote(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	newReadClock(api)
	mine := api.signUp("hafez")
	theirs := api.signUp("saadi")
	_, q := postQuote(t, api, mine, "ganjoor:hafez:1", 0, 1)
	path := fmt.Sprintf("/api/account/quotes/%d", q.ID)

	if res := api.do("DELETE", path, "", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", res.Code)
	}
	if res := api.do("DELETE", path, "", theirs); res.Code != http.StatusNotFound {
		t.Fatalf("someone else's quote: %d", res.Code)
	}
	if got := userQuotes(t, api, "hafez", ""); len(got.Quotes) != 1 {
		t.Fatal("another user deleted the quote")
	}
	if res := api.do("DELETE", "/api/account/quotes/abc", "", mine); res.Code != http.StatusNotFound {
		t.Fatalf("bad id: %d", res.Code)
	}
	if res := api.do("DELETE", path, "", mine); res.Code != http.StatusNoContent {
		t.Fatalf("own quote: %d", res.Code)
	}
	if res := api.do("DELETE", path, "", mine); res.Code != http.StatusNotFound {
		t.Fatalf("deleted twice: %d", res.Code)
	}
	if got := userQuotes(t, api, "hafez", ""); len(got.Quotes) != 0 {
		t.Fatalf("quote survived: %+v", got.Quotes)
	}
}

func TestUserQuotesPagination(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	clock := newReadClock(api)
	cookie := api.signUp("hafez")
	// 25 quotes over two days, since 20 is the daily cap.
	for i := 0; i < 25; i++ {
		if i == 15 {
			clock.advance(1)
		}
		if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", i, i); code != http.StatusCreated {
			t.Fatalf("quote %d: %d", i, code)
		}
	}

	first := userQuotes(t, api, "hafez", "")
	if len(first.Quotes) != 20 || first.Next == nil || *first.Next != first.Quotes[19].ID {
		t.Fatalf("first page: %d quotes, next %v", len(first.Quotes), first.Next)
	}
	if first.Quotes[0].From != 24 || first.Quotes[19].From != 5 {
		t.Fatalf("not newest first: %d … %d", first.Quotes[0].From, first.Quotes[19].From)
	}
	second := userQuotes(t, api, "hafez", fmt.Sprintf("?before=%d", *first.Next))
	if len(second.Quotes) != 5 || second.Next != nil || second.Quotes[0].From != 4 || second.Quotes[4].From != 0 {
		t.Fatalf("second page: %+v next %v", second.Quotes, second.Next)
	}
	raw := api.do("GET", "/api/account/users/hafez/quotes?before="+fmt.Sprint(*first.Next), "", "").Body.String()
	if !strings.Contains(raw, `"next":null`) {
		t.Fatalf("next must be null on the last page: %s", raw)
	}
	if res := api.do("GET", "/api/account/users/hafez/quotes?before=x", "", ""); res.Code != http.StatusBadRequest {
		t.Fatalf("bad cursor: %d", res.Code)
	}
}

func TestUserQuotesPublicOnly(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	newReadClock(api)
	cookie := api.signUp("hafez")
	postQuote(t, api, cookie, "ganjoor:hafez:1", 0, 1)

	if res := api.do("GET", "/api/account/users/nobody/quotes", "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("unknown user: %d", res.Code)
	}
	if res := api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, cookie); res.Code != http.StatusOK {
		t.Fatalf("go private: %d", res.Code)
	}
	if res := api.do("GET", "/api/account/users/hafez/quotes", "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("private account: %d", res.Code)
	}
	if res := api.do("GET", "/api/account/users/hafez", "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("private profile: %d", res.Code)
	}
	other := api.signUp("saadi")
	if res := api.do("GET", "/api/account/users/hafez/quotes", "", other); res.Code != http.StatusNotFound {
		t.Fatalf("private account, someone else signed in: %d", res.Code)
	}
	if res := api.do("GET", "/api/account/users/hafez/quotes", "", cookie); res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"from":0`) {
		t.Fatalf("owner of a private account sees their quotes: %d %s", res.Code, res.Body)
	}
}

func TestDailyQuoteLimit(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	clock := newReadClock(api)
	cookie := api.signUp("hafez")
	for i := 0; i < 20; i++ {
		if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", i, i); code != http.StatusCreated {
			t.Fatalf("quote %d: %d", i, code)
		}
	}
	res := api.do("POST", "/api/account/quotes", `{"key":"ganjoor:hafez:1","from":20,"to":20}`, cookie)
	if res.Code != http.StatusTooManyRequests || !strings.Contains(res.Body.String(), "error") {
		t.Fatalf("21st quote: %d %s", res.Code, res.Body)
	}
	// An existing quote is still answered, and other people have their own budget.
	if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", 3, 3); code != http.StatusOK {
		t.Fatalf("existing quote at the limit: %d", code)
	}
	friend := api.signUp("saadi")
	if code, _ := postQuote(t, api, friend, "ganjoor:hafez:1", 20, 20); code != http.StatusCreated {
		t.Fatalf("other user: %d", code)
	}
	// The day is a Tehran day: 23:00 Tehran is still the same day, noon tomorrow is a new one.
	clock.t = clock.t.Add(11 * 60 * 60 * 1e9)
	if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", 20, 20); code != http.StatusTooManyRequests {
		t.Fatalf("same Tehran day: %d", code)
	}
	clock.t = clock.t.Add(2 * 60 * 60 * 1e9)
	if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", 20, 20); code != http.StatusCreated {
		t.Fatalf("next Tehran day: %d", code)
	}
}

func TestQuotesKeepNewest500(t *testing.T) {
	lines := make([]string, 600)
	for i := range lines {
		lines[i] = fmt.Sprintf("خط %d", i)
	}
	api := newTestAPI(t, fakePoems{"ganjoor:hafez:1": {PoetName: "حافظ", Title: "غزل", Href: "/poem/1", Lines: lines}})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")
	for i := 0; i < 520; i++ {
		if i > 0 && i%20 == 0 {
			clock.advance(1)
		}
		if code, _ := postQuote(t, api, cookie, "ganjoor:hafez:1", i, i); code != http.StatusCreated {
			t.Fatalf("quote %d: %d", i, code)
		}
	}
	var profile struct {
		Profile PublicProfile `json:"profile"`
	}
	res := api.do("GET", "/api/account/users/hafez", "", "")
	if err := json.Unmarshal(res.Body.Bytes(), &profile); err != nil {
		t.Fatal(err)
	}
	if profile.Profile.QuoteCount != 500 {
		t.Fatalf("quoteCount %d, want 500", profile.Profile.QuoteCount)
	}
	// The oldest 20 are gone: quote 20 is the oldest left.
	var oldest *Quote
	page := userQuotes(t, api, "hafez", "")
	for {
		oldest = &page.Quotes[len(page.Quotes)-1]
		if page.Next == nil {
			break
		}
		page = userQuotes(t, api, "hafez", fmt.Sprintf("?before=%d", *page.Next))
	}
	if oldest.From != 20 {
		t.Fatalf("oldest kept quote is line %d, want 20", oldest.From)
	}
}

func TestProfileEmbedsQuotes(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	clock := newReadClock(api)
	cookie := api.signUp("hafez")

	empty := api.do("GET", "/api/account/users/hafez", "", "").Body.String()
	if !strings.Contains(empty, `"quotes":[]`) || !strings.Contains(empty, `"quoteCount":0`) {
		t.Fatalf("empty profile: %s", empty)
	}

	for i := 0; i < 25; i++ {
		if i == 15 {
			clock.advance(1)
		}
		postQuote(t, api, cookie, "ganjoor:hafez:1", i, i)
	}
	var out struct {
		Profile PublicProfile `json:"profile"`
	}
	res := api.do("GET", "/api/account/users/hafez", "", "")
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	p := out.Profile
	if p.QuoteCount != 25 || len(p.Quotes) != 20 || p.Quotes[0].From != 24 || p.Quotes[0].Lines[0] != "خط 24" {
		t.Fatalf("profile quotes: count %d, %d quotes, %+v", p.QuoteCount, len(p.Quotes), p.Quotes[:1])
	}
}

func TestFollowingQuotes(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	clock := newReadClock(api)
	viewer := api.signUp("viewer")
	ada := api.signUp("ada")
	bob := api.signUp("bob")
	cyrus := api.signUp("cyrus")
	dee := api.signUp("dee")
	api.signUp("eve") // quotes, but is not followed

	if res := api.do("GET", "/api/account/following/quotes", "", ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", res.Code)
	}
	if got := followingQuotes(t, api, viewer); len(got) != 0 {
		t.Fatalf("follows nobody: %+v", got)
	}

	if res := api.do("PUT", "/api/account/appearance", `{"bio":"","banner":"","accent":"#aa3355","background":""}`, ada); res.Code != http.StatusOK {
		t.Fatalf("appearance: %d %s", res.Code, res.Body)
	}
	// bob quoted 8 days ago, so he is outside the window.
	clock.advance(-8)
	postQuote(t, api, bob, "ganjoor:hafez:1", 0, 0)
	clock.advance(8)
	// Over three days: cyrus first, then dee, then ada last (12 quotes, only 10 are shown).
	clock.advance(-3)
	postQuote(t, api, cyrus, "ganjoor:hafez:2", 0, 1)
	clock.advance(1)
	postQuote(t, api, dee, "ganjoor:hafez:2", 2, 3)
	clock.advance(2)
	for i := 0; i < 12; i++ {
		postQuote(t, api, ada, "ganjoor:hafez:1", i, i)
	}
	postQuote(t, api, api.signUp("eve2"), "ganjoor:hafez:1", 0, 0)

	for _, name := range []string{"ada", "bob", "cyrus", "dee"} {
		if res := api.do("PUT", "/api/account/follow/"+name, "", viewer); res.Code != http.StatusNoContent && res.Code != http.StatusOK {
			t.Fatalf("follow %s: %d", name, res.Code)
		}
	}
	// dee goes private after being followed: gone from the row.
	if res := api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, dee); res.Code != http.StatusOK {
		t.Fatalf("dee private: %d", res.Code)
	}

	people := followingQuotes(t, api, viewer)
	if len(people) != 2 || people[0].User.Username != "ada" || people[1].User.Username != "cyrus" {
		t.Fatalf("people: %+v", people)
	}
	a := people[0]
	if len(a.Quotes) != 10 || a.Quotes[0].From != 11 || a.Quotes[9].From != 2 {
		t.Fatalf("ada's quotes: %d, first from %d", len(a.Quotes), a.Quotes[0].From)
	}
	if a.LatestAt != a.Quotes[0].CreatedAt || a.User.Accent != "#aa3355" || a.User.DisplayName != "ada" || people[1].User.Accent != "" {
		t.Fatalf("ada: latestAt %d, user %+v", a.LatestAt, a.User)
	}
	if people[1].LatestAt >= a.LatestAt || len(people[1].Quotes) != 1 {
		t.Fatalf("cyrus: %+v", people[1])
	}

	// A week later cyrus's quote has aged out too; the 7-day window is rolling.
	clock.advance(5)
	people = followingQuotes(t, api, viewer)
	if len(people) != 1 || people[0].User.Username != "ada" {
		t.Fatalf("after the window: %+v", people)
	}
	clock.advance(3)
	if people = followingQuotes(t, api, viewer); len(people) != 0 {
		t.Fatalf("everything aged out: %+v", people)
	}
}

func TestFollowingQuotesCapsPeople(t *testing.T) {
	api := newTestAPI(t, quotePoems())
	newReadClock(api)
	viewer := api.signUp("viewer")
	// Insert straight into the store; signing up 55 accounts through argon2 would be slow.
	now := api.server.store.clock().UnixMilli()
	for i := 0; i < 55; i++ {
		res, err := api.server.store.db.Exec(`INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, 'x', 0)`,
			fmt.Sprintf("user%02d", i), fmt.Sprintf("user%02d", i))
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		if _, err := api.server.store.db.Exec(`INSERT INTO follows (follower_id, followee_id, created_at) SELECT id, ?, 0 FROM users WHERE username = 'viewer'`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := api.server.store.db.Exec(`INSERT INTO quotes (user_id, poem_key, href, poet_name, poem_title, line_from, line_to, lines, created_at)
			VALUES (?, 'ganjoor:hafez:1', '/poem/1', 'حافظ', 'غزل', 0, 0, '["خط 0"]', ?)`, id, now-int64(i)); err != nil {
			t.Fatal(err)
		}
	}
	people := followingQuotes(t, api, viewer)
	if len(people) != 50 || people[0].User.Username != "user00" || people[49].User.Username != "user49" {
		t.Fatalf("%d people, first %s", len(people), people[0].User.Username)
	}
}
