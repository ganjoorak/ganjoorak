package main

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// readClock is a test clock set to noon in Tehran on a chosen day.
type readClock struct{ t time.Time }

func newReadClock(api *testAPI) *readClock {
	c := &readClock{t: time.Date(2026, 3, 1, 12, 0, 0, 0, tehran)}
	api.server.store.now = func() time.Time { return c.t }
	return c
}

func (c *readClock) advance(days int) { c.t = c.t.AddDate(0, 0, days) }

type readResult struct {
	Streak    Streak  `json:"streak"`
	NewBadges []Badge `json:"newBadges"`
}

func readPoem(t *testing.T, api *testAPI, cookie, key string) readResult {
	t.Helper()
	res := api.do("POST", "/api/account/read", `{"key":"`+key+`"}`, cookie)
	if res.Code != http.StatusOK {
		t.Fatalf("read %s: %d %s", key, res.Code, res.Body)
	}
	var out readResult
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestReadStreakCounting(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")

	first := readPoem(t, api, cookie, "ganjoor:hafez:1")
	if first.Streak.Current != 1 || first.Streak.Best != 1 || !first.Streak.Today || first.Streak.TotalPoems != 1 {
		t.Fatalf("first read: %+v", first.Streak)
	}
	if len(first.Streak.Days) != 1 || first.Streak.Days[0] != "2026-03-01" {
		t.Fatalf("days: %v", first.Streak.Days)
	}
	if first.NewBadges == nil || len(first.NewBadges) != 0 {
		t.Fatalf("newBadges must be an empty list: %+v", first.NewBadges)
	}

	// The same poem on the same day, and a second poem: dedupe vs. total.
	again := readPoem(t, api, cookie, "ganjoor:hafez:1")
	if again.Streak.TotalPoems != 1 {
		t.Fatalf("same poem twice a day counted twice: %+v", again.Streak)
	}
	other := readPoem(t, api, cookie, "ganjoor:hafez:2")
	if other.Streak.TotalPoems != 2 || other.Streak.Current != 1 {
		t.Fatalf("second poem: %+v", other.Streak)
	}

	// The same poem on the next day counts again, and extends the streak.
	clock.advance(1)
	next := readPoem(t, api, cookie, "ganjoor:hafez:1")
	if next.Streak.Current != 2 || next.Streak.TotalPoems != 3 || len(next.Streak.Days) != 2 {
		t.Fatalf("next day: %+v", next.Streak)
	}
}

func TestStreakGapAndYesterday(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")
	meStreak := func() Streak {
		t.Helper()
		var me struct{ Progress struct{ Streak Streak } }
		res := api.do("GET", "/api/account/me", "", cookie)
		if err := json.Unmarshal(res.Body.Bytes(), &me); err != nil || res.Code != http.StatusOK {
			t.Fatalf("me: %d %s", res.Code, res.Body)
		}
		return me.Progress.Streak
	}

	for i := 0; i < 3; i++ {
		readPoem(t, api, cookie, "ganjoor:hafez:1")
		clock.advance(1)
	}
	// Three days read, now it is day 4 with nothing read yet: yesterday still counts.
	st := meStreak()
	if st.Current != 3 || st.Best != 3 || st.Today {
		t.Fatalf("yesterday should still count: %+v", st)
	}

	// Skip a whole day: the current streak is gone, the best stays.
	clock.advance(1)
	st = meStreak()
	if st.Current != 0 || st.Best != 3 || st.Today {
		t.Fatalf("gap should reset current: %+v", st)
	}
	restart := readPoem(t, api, cookie, "ganjoor:hafez:2")
	if restart.Streak.Current != 1 || restart.Streak.Best != 3 || !restart.Streak.Today {
		t.Fatalf("restart: %+v", restart.Streak)
	}
	if len(restart.Streak.Days) != 4 {
		t.Fatalf("days: %v", restart.Streak.Days)
	}
}

func TestReadWindowAndDailyCap(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")

	readPoem(t, api, cookie, "ganjoor:hafez:1")
	clock.advance(40)
	st := readPoem(t, api, cookie, "ganjoor:hafez:1").Streak
	if len(st.Days) != 1 || st.Days[0] != "2026-04-10" || st.Best != 1 || st.TotalPoems != 2 {
		t.Fatalf("days outside the last 28 must be left out: %+v", st)
	}

	for i := 1; i <= maxReadsPerDay+5; i++ {
		res := api.do("POST", "/api/account/read", `{"key":"ganjoor:saadi:`+strconv.Itoa(i)+`"}`, cookie)
		if res.Code != http.StatusOK {
			t.Fatalf("read %d: %d", i, res.Code)
		}
	}
	st = readPoem(t, api, cookie, "ganjoor:hafez:999").Streak
	// 1 earlier day + 300 today; the rest are answered but not stored.
	if st.TotalPoems != 1+maxReadsPerDay {
		t.Fatalf("daily cap: total %d", st.TotalPoems)
	}
}

func TestReadValidation(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	cookie := api.signUp("hafez")
	if res := api.do("POST", "/api/account/read", `{"key":"ganjoor:hafez:1"}`, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d", res.Code)
	}
	for _, body := range []string{`{"key":""}`, `{"key":"bogus"}`, `{"key":"ganjoor:hafez:x"}`, `{}`} {
		if res := api.do("POST", "/api/account/read", body, cookie); res.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d", body, res.Code)
		}
	}
}

func TestBadgesAwardedOnce(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")

	var earned []string
	for day := 1; day <= 8; day++ {
		res := readPoem(t, api, cookie, "ganjoor:hafez:1")
		for _, b := range res.NewBadges {
			earned = append(earned, b.Key)
			if b.Title == "" || b.EarnedAt != clock.t.UnixMilli() {
				t.Fatalf("badge incomplete: %+v", b)
			}
		}
		// Reading again the same day never repeats a badge.
		if again := readPoem(t, api, cookie, "ganjoor:hafez:2"); len(again.NewBadges) != 0 {
			t.Fatalf("day %d: badge repeated: %+v", day, again.NewBadges)
		}
		if day == 3 && (len(res.NewBadges) != 1 || res.NewBadges[0].Key != "streak-3") {
			t.Fatalf("day 3: %+v", res.NewBadges)
		}
		clock.advance(1)
	}
	if strings.Join(earned, ",") != "streak-3,streak-7" {
		t.Fatalf("earned %v", earned)
	}

	// A gap and a fresh streak do not take badges away or award them twice.
	clock.advance(3)
	for day := 1; day <= 4; day++ {
		if res := readPoem(t, api, cookie, "ganjoor:hafez:1"); len(res.NewBadges) != 0 {
			t.Fatalf("restart day %d: %+v", day, res.NewBadges)
		}
		clock.advance(1)
	}

	var me struct {
		Progress struct {
			Streak Streak
			Badges []Badge
		}
	}
	res := api.do("GET", "/api/account/me", "", cookie)
	if err := json.Unmarshal(res.Body.Bytes(), &me); err != nil {
		t.Fatal(err)
	}
	badges := me.Progress.Badges
	if len(badges) != 2 || badges[0].Key != "streak-7" || badges[1].Key != "streak-3" || badges[0].Icon != "flame" || badges[0].Tier != 2 {
		t.Fatalf("badges newest first: %+v", badges)
	}
}

func TestMeProgressShape(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	cookie := api.signUp("hafez")
	res := api.do("GET", "/api/account/me", "", cookie)
	var raw struct {
		Progress map[string]json.RawMessage `json:"progress"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if string(raw.Progress["badges"]) != "[]" {
		t.Fatalf("badges: %s", raw.Progress["badges"])
	}
	if !strings.Contains(string(raw.Progress["streak"]), `"days":[]`) {
		t.Fatalf("streak: %s", raw.Progress["streak"])
	}
	for _, field := range []string{`"bio":""`, `"banner":""`, `"accent":""`, `"background":""`} {
		if !strings.Contains(res.Body.String(), field) {
			t.Fatalf("me user is missing %s: %s", field, res.Body)
		}
	}
}

func TestPublicProfileProgressAndAppearance(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	clock := newReadClock(api)
	cookie := api.signUp("hafez")
	for i := 0; i < 3; i++ {
		readPoem(t, api, cookie, "ganjoor:hafez:1")
		clock.advance(1)
	}
	body := `{"bio":"عاشقی\nپیشه","banner":"sea","accent":"#B00020","background":"#FFFFFF"}`
	if res := api.do("PUT", "/api/account/appearance", body, cookie); res.Code != http.StatusOK {
		t.Fatalf("appearance: %d %s", res.Code, res.Body)
	}

	res := api.do("GET", "/api/account/users/hafez", "", "")
	var pub struct{ Profile PublicProfile }
	if err := json.Unmarshal(res.Body.Bytes(), &pub); err != nil || res.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", res.Code, res.Body)
	}
	p := pub.Profile
	if p.Streak.Current != 3 || p.Streak.Best != 3 || p.Streak.Today {
		t.Fatalf("streak: %+v", p.Streak)
	}
	if len(p.Badges) != 1 || p.Badges[0].Key != "streak-3" {
		t.Fatalf("badges: %+v", p.Badges)
	}
	if p.Bio != "عاشقی پیشه" || p.Banner != "sea" || p.Accent != "#b00020" || p.Background != "#ffffff" {
		t.Fatalf("appearance: %+v", p)
	}
	// Only the three streak numbers are public, not the reading log.
	for _, private := range []string{"totalPoems", "newBadges", `"days"`, "ganjoor:hafez:1"} {
		if strings.Contains(res.Body.String(), private) {
			t.Fatalf("public profile leaks %q: %s", private, res.Body)
		}
	}

	// Without any reading, badges are still an empty list.
	api.signUp("saadi")
	empty := api.do("GET", "/api/account/users/saadi", "", "")
	if !strings.Contains(empty.Body.String(), `"badges":[]`) {
		t.Fatalf("empty badges: %s", empty.Body)
	}
}

func TestAppearanceValidation(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	cookie := api.signUp("hafez")
	put := func(body string) (int, string) {
		res := api.do("PUT", "/api/account/appearance", body, cookie)
		return res.Code, res.Body.String()
	}

	if res := api.do("PUT", "/api/account/appearance", `{}`, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d", res.Code)
	}
	for name, body := range map[string]string{
		"bad hex":      `{"accent":"red"}`,
		"short hex":    `{"background":"#fff"}`,
		"hex chars":    `{"accent":"#gg0000"}`,
		"unknown":      `{"banner":"nope"}`,
		"low contrast": `{"accent":"#777777","background":"#808080"}`,
	} {
		if code, out := put(body); code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, code, out)
		}
	}
	if _, out := put(`{"accent":"#777777","background":"#808080"}`); !strings.Contains(out, "رنگ تأکید روی این پس‌زمینه دیده نمی‌شود؛ رنگ دیگری انتخاب کنید.") {
		t.Fatalf("contrast message: %s", out)
	}

	// A single colour has nothing to contrast with.
	if code, out := put(`{"accent":"#777777"}`); code != http.StatusOK {
		t.Fatalf("single colour: %d %s", code, out)
	}

	long := strings.Repeat("ا", 200)
	code, out := put(`{"bio":"` + long + `","banner":"tile","accent":"#0A5C36","background":"#F5EFE0"}`)
	if code != http.StatusOK {
		t.Fatalf("good: %d %s", code, out)
	}
	var got struct{ User User }
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatal(err)
	}
	u := got.User
	if len([]rune(u.Bio)) != 160 || u.Banner != "tile" || u.Accent != "#0a5c36" || u.Background != "#f5efe0" {
		t.Fatalf("stored: %+v", u)
	}
	if strings.Contains(out, "argon2") || strings.Contains(out, "hash") {
		t.Fatalf("private field leaked: %s", out)
	}

	// Stored values survive a new session (read back through /me), and a
	// profile update does not wipe them.
	if res := api.do("PUT", "/api/account/profile", `{"username":"hafez","displayName":"حافظ","avatar":""}`, cookie); res.Code != http.StatusOK {
		t.Fatalf("profile: %d %s", res.Code, res.Body)
	}
	me := api.do("GET", "/api/account/me", "", cookie)
	if !strings.Contains(me.Body.String(), `"banner":"tile"`) || !strings.Contains(me.Body.String(), `"accent":"#0a5c36"`) {
		t.Fatalf("me: %s", me.Body)
	}

	// Clearing everything is allowed.
	if code, out := put(`{"bio":"","banner":"","accent":"","background":""}`); code != http.StatusOK || !strings.Contains(out, `"banner":""`) {
		t.Fatalf("clear: %d %s", code, out)
	}

	// Private accounts keep their appearance out of the public profile.
	if res := api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, cookie); res.Code != http.StatusOK {
		t.Fatalf("visibility: %d", res.Code)
	}
	if res := api.do("GET", "/api/account/users/hafez", "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("private profile: %d", res.Code)
	}
}

func TestCatalog(t *testing.T) {
	api := newTestAPI(t, fakePoems{})
	res := api.do("GET", "/api/account/catalog", "", "")
	if res.Code != http.StatusOK {
		t.Fatalf("catalog: %d %s", res.Code, res.Body)
	}
	var cat struct {
		Badges  []Badge  `json:"badges"`
		Banners []Banner `json:"banners"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &cat); err != nil {
		t.Fatal(err)
	}
	keys := []string{}
	for i, b := range cat.Badges {
		keys = append(keys, b.Key)
		if b.Title == "" || b.Description == "" || b.Icon == "" || b.Tier != i+1 || b.EarnedAt != 0 {
			t.Fatalf("badge %d: %+v", i, b)
		}
	}
	if strings.Join(keys, ",") != "streak-3,streak-7,streak-30,streak-100,streak-365" {
		t.Fatalf("badge keys: %v", keys)
	}
	if len(cat.Banners) != 8 || cat.Banners[0] != (Banner{Key: "dawn", Title: "سپیده‌دم", Image: "/banners/dawn.svg"}) || cat.Banners[7].Key != "paper" {
		t.Fatalf("banners: %+v", cat.Banners)
	}
	// Every catalog banner is accepted by the appearance endpoint.
	cookie := api.signUp("hafez")
	for _, b := range cat.Banners {
		if res := api.do("PUT", "/api/account/appearance", `{"banner":"`+b.Key+`"}`, cookie); res.Code != http.StatusOK {
			t.Fatalf("banner %s: %d", b.Key, res.Code)
		}
	}
}

func TestContrastRatio(t *testing.T) {
	near := func(got, want float64) bool { return math.Abs(got-want) < 0.01 }
	if got := contrastRatio("#000000", "#ffffff"); !near(got, 21) {
		t.Fatalf("black/white: %v", got)
	}
	if got := contrastRatio("#ffffff", "#000000"); !near(got, 21) {
		t.Fatalf("white/black: %v", got)
	}
	if got := contrastRatio("#123456", "#123456"); !near(got, 1) {
		t.Fatalf("same colour: %v", got)
	}
	// #777777 on white is the textbook 4.48:1.
	if got := contrastRatio("#777777", "#ffffff"); !near(got, 4.48) {
		t.Fatalf("grey on white: %v", got)
	}
	if got := contrastRatio("#FFFFFF", "#000000"); !near(got, 21) {
		t.Fatalf("upper case: %v", got)
	}
	if got := contrastRatio("nope", "#ffffff"); got != 0 {
		t.Fatalf("malformed: %v", got)
	}
}

func TestComputeStreakAcrossMonthEnd(t *testing.T) {
	st := computeStreak([]string{"2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"}, 4, "2026-03-02")
	if st.Current != 4 || st.Best != 4 || !st.Today {
		t.Fatalf("%+v", st)
	}
	if shiftDay("2026-03-01", -1) != "2026-02-28" {
		t.Fatal("shiftDay")
	}
}

func TestDayIsTehranDay(t *testing.T) {
	// 22:00 UTC is already the next day in Tehran (UTC+3:30).
	at := time.Date(2026, 3, 1, 21, 0, 0, 0, time.UTC)
	if got := dayOf(at); got != "2026-03-02" {
		t.Fatalf("day %s", got)
	}
}
