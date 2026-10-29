package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// moshaereClock is a hand-moved clock for deadlines and the 10 s move gap.
type moshaereClock struct{ t time.Time }

func (c *moshaereClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newMoshaereAPI(t *testing.T, poems fakePoems) (*testAPI, *moshaereClock) {
	t.Helper()
	api := newTestAPI(t, poems)
	clock := &moshaereClock{t: time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)}
	api.server.store.now = func() time.Time { return clock.t }
	return api, clock
}

type failingPoems struct{}

func (failingPoems) PoemText(context.Context, string) (PoemText, error) {
	return PoemText{}, errors.New("upstream down")
}

var verseWords = []string{"درخت", "کتاب", "بهار", "چراغ", "پرنده", "ستاره", "خیال", "دریا", "نسیم", "سپیده"}

// verseOf is a one-line verse that starts with first and ends with last; i
// picks a word so verses differ.
func verseOf(i int, first, last string) []string {
	return []string{first + verseWords[i%len(verseWords)] + last}
}

func verseBody(lines []string) string {
	raw, _ := json.Marshal(map[string]any{"lines": lines})
	return string(raw)
}

func fields(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON %q: %v", rec.Body, err)
	}
	return body
}

func errorOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	message, _ := fields(t, rec)["error"].(string)
	return message
}

// expect fails the test unless rec has the status and (when given) error message.
func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, message string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d: %s", rec.Code, status, rec.Body)
	}
	if message != "" && errorOf(t, rec) != message {
		t.Fatalf("error %q, want %q", errorOf(t, rec), message)
	}
}

const roomPath = "/api/account/moshaere/public"

type roomView struct {
	Moves      []Move   `json:"moves"`
	NextLetter string   `json:"nextLetter"`
	Leaders    []Leader `json:"leaders"`
}

func (a *testAPI) room(query string) roomView {
	a.t.Helper()
	rec := a.do("GET", roomPath+query, "", "")
	expect(a.t, rec, http.StatusOK, "")
	var view roomView
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		a.t.Fatal(err)
	}
	return view
}

func (a *testAPI) say(cookie string, lines []string) *httptest.ResponseRecorder {
	return a.do("POST", roomPath, verseBody(lines), cookie)
}

// --- public room -----------------------------------------------------------------

func TestPublicRoomStartsEmptyAndTakesAnyFirstLetter(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")

	view := api.room("")
	if view.Moves == nil || len(view.Moves) != 0 || view.NextLetter != "" || view.Leaders == nil || len(view.Leaders) != 0 {
		t.Fatalf("empty room should have empty lists: %+v", view)
	}
	rec := api.say(ali, verseOf(0, "پ", "م"))
	expect(t, rec, http.StatusCreated, "")
	body := fields(t, rec)
	move := body["move"].(map[string]any)
	if body["nextLetter"] != "م" || move["username"] != "ali" || move["firstLetter"] != "پ" || move["lastLetter"] != "م" || move["key"] != "" {
		t.Fatalf("unexpected response: %s", rec.Body)
	}
	if api.room("").NextLetter != "م" {
		t.Fatal("room did not advance")
	}
}

func TestPublicRoomLetterChain(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")

	expect(t, api.say(sara, verseOf(1, "ب", "ن")), http.StatusBadRequest, "بیت باید با «م» شروع شود.")
	// Arabic spellings count as their Persian letter.
	expect(t, api.say(sara, verseOf(1, "م", "ي")), http.StatusCreated, "")
	if api.room("").NextLetter != "ی" {
		t.Fatalf("last letter should be normalized, got %q", api.room("").NextLetter)
	}
	clock.advance(11 * time.Second)
	expect(t, api.say(ali, verseOf(2, "ی", "ا")), http.StatusCreated, "")
	if got := api.room(""); len(got.Moves) != 3 || got.Moves[0].Username != "ali" || got.Moves[2].Username != "ali" {
		t.Fatalf("moves should be oldest first: %+v", got.Moves)
	}
}

func TestPublicRoomRefusesTheSameUserTwice(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")
	clock.advance(time.Minute)
	expect(t, api.say(ali, verseOf(1, "م", "ن")), http.StatusConflict, "صبر کنید کس دیگری بیتی بخواند.")
}

func TestPublicRoomRaceAnswersWithTheNewLetter(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali, sara, reza := api.signUp("ali"), api.signUp("sara"), api.signUp("reza")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")
	seen := api.room("").Moves[0].ID

	// Sara answers what both saw; Reza still thinks the room is at seen.
	body := fmt.Sprintf(`{"lines":[%q],"expect":%d}`, verseOf(1, "م", "ن")[0], seen)
	expect(t, api.do("POST", roomPath, body, sara), http.StatusCreated, "")
	body = fmt.Sprintf(`{"lines":[%q],"expect":%d}`, verseOf(2, "م", "ر")[0], seen)
	rec := api.do("POST", roomPath, body, reza)
	expect(t, rec, http.StatusConflict, "کسی زودتر بیتی خواند؛ حرف تازه «ن» است.")
	if fields(t, rec)["nextLetter"] != "ن" {
		t.Fatalf("race answer needs nextLetter: %s", rec.Body)
	}
	// Without expect there is no race check, but the real letter still rules.
	expect(t, api.say(reza, verseOf(2, "م", "ر")), http.StatusBadRequest, "بیت باید با «ن» شروع شود.")
	expect(t, api.say(reza, verseOf(2, "ن", "ر")), http.StatusCreated, "")
	// expect 0 is a claim about the empty room.
	rec = api.do("POST", roomPath, `{"lines":["`+verseOf(3, "ر", "ا")[0]+`"],"expect":0}`, ali)
	expect(t, rec, http.StatusConflict, "")
}

func TestPublicRoomNeedsAPublicProfile(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	expect(t, api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, ali), http.StatusOK, "")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusForbidden, "برای مشاعرهٔ عمومی باید نمایه‌تان عمومی باشد.")
	expect(t, api.do("POST", roomPath, verseBody(verseOf(0, "ا", "م")), ""), http.StatusUnauthorized, "")
}

func TestPublicRoomRefusesRepeatedVerses(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	expect(t, api.say(ali, []string{"ادرختم"}), http.StatusCreated, "")
	expect(t, api.say(sara, verseOf(1, "م", "ا")), http.StatusCreated, "")
	clock.advance(time.Minute)
	// Same letters, different spelling and punctuation.
	expect(t, api.say(ali, []string{"«اَدرخت‌م»!"}), http.StatusBadRequest, "این بیت قبلاً خوانده شده است.")
	// The same verse split over two lines is still the same verse.
	expect(t, api.say(ali, []string{"ادر", "ختم"}), http.StatusBadRequest, "این بیت قبلاً خوانده شده است.")
	expect(t, api.say(ali, verseOf(2, "ا", "ن")), http.StatusCreated, "")
}

func TestPublicRoomRateLimitsEachUser(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")
	expect(t, api.say(sara, verseOf(1, "م", "ن")), http.StatusCreated, "")
	clock.advance(5 * time.Second)
	expect(t, api.say(ali, verseOf(2, "ن", "ا")), http.StatusTooManyRequests, "")
	clock.advance(6 * time.Second)
	expect(t, api.say(ali, verseOf(2, "ن", "ا")), http.StatusCreated, "")
}

func TestPublicRoomVerseSize(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	for name, lines := range map[string][]string{
		"none":       {},
		"blank":      {"  ", ""},
		"three":      {"سلام بر شما", "سلام بر شما", "سلام بر شما"},
		"too short":  {"سلام"},
		"short line": {"سلام بر شما", "ا"},
		"long line":  {strings.Repeat("آب ", 50)},
	} {
		rec := api.say(ali, lines)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400: %s", name, rec.Code, rec.Body)
		}
	}
	expect(t, api.say(ali, []string{"x", "y", "z"}), http.StatusBadRequest, "بیت باید یک یا دو مصراع باشد.")
	expect(t, api.do("POST", roomPath, `{"lines":["سلام بر شما"],"key":"ganjoor:hafez:1","from":0,"to":0}`, ali), http.StatusBadRequest, "")
	expect(t, api.say(ali, []string{"سلام بر شما", "دوست من"}), http.StatusCreated, "")
}

var hafez = fakePoems{
	"ganjoor:hafez:1": {
		PoetName: "حافظ", Title: "غزل ۱", Href: "/poem/1",
		Lines: []string{"الا یا ایها الساقی ادر کأسا و ناولها", "که عشق آسان نمود اول ولی افتاد مشکل‌ها", "به بوی نافه‌ای کاخر صبا زان طره بگشاید", "ز تاب جعد مشکینش چه خون افتاد در دل‌ها"},
	},
}

func TestPublicRoomPickedVerse(t *testing.T) {
	api, clock := newMoshaereAPI(t, hafez)
	ali := api.signUp("ali")

	rec := api.do("POST", roomPath, `{"key":"ganjoor:hafez:1","from":0,"to":1}`, ali)
	expect(t, rec, http.StatusCreated, "")
	move := fields(t, rec)["move"].(map[string]any)
	lines := move["lines"].([]any)
	if len(lines) != 2 || lines[0] != hafez["ganjoor:hafez:1"].Lines[0] || move["key"] != "ganjoor:hafez:1" ||
		move["href"] != "/poem/1" || move["poetName"] != "حافظ" || move["poemTitle"] != "غزل ۱" ||
		move["firstLetter"] != "ا" || move["lastLetter"] != "ا" {
		t.Fatalf("picked verse not filled from the poem: %s", rec.Body)
	}

	sara := api.signUp("sara")
	clock.advance(time.Minute)
	// The picked verse follows the same letter rule; a single line is allowed.
	expect(t, api.do("POST", roomPath, `{"key":"ganjoor:hafez:1","from":2,"to":2}`, sara), http.StatusBadRequest, "بیت باید با «ا» شروع شود.")

	for name, body := range map[string]string{
		"three lines":  `{"key":"ganjoor:hafez:1","from":0,"to":2}`,
		"past the end": `{"key":"ganjoor:hafez:1","from":3,"to":4}`,
		"negative":     `{"key":"ganjoor:hafez:1","from":-1,"to":0}`,
		"backwards":    `{"key":"ganjoor:hafez:1","from":2,"to":1}`,
	} {
		if rec := api.do("POST", roomPath, body, sara); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400: %s", name, rec.Code, rec.Body)
		}
	}
	expect(t, api.do("POST", roomPath, `{"key":"ganjoor:hafez:1"}`, sara), http.StatusBadRequest, "")
	expect(t, api.do("POST", roomPath, `{"key":"ganjoor:nobody:9","from":0,"to":1}`, sara), http.StatusNotFound, "این شعر پیدا نشد.")
	expect(t, api.do("POST", roomPath, `{"key":"nonsense","from":0,"to":1}`, sara), http.StatusNotFound, "این شعر پیدا نشد.")

	api.server.poems = failingPoems{}
	expect(t, api.do("POST", roomPath, `{"key":"ganjoor:hafez:1","from":0,"to":1}`, sara), http.StatusBadGateway, "")
}

func TestPublicRoomPolling(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")
	first := api.room("").Moves[0].ID
	if got := api.room(fmt.Sprintf("?after=%d", first)); len(got.Moves) != 0 || got.NextLetter != "م" {
		t.Fatalf("nothing is newer yet: %+v", got)
	}
	expect(t, api.say(sara, verseOf(1, "م", "ن")), http.StatusCreated, "")
	clock.advance(time.Minute)
	expect(t, api.say(ali, verseOf(2, "ن", "ا")), http.StatusCreated, "")
	got := api.room(fmt.Sprintf("?after=%d", first))
	if len(got.Moves) != 2 || got.Moves[0].Username != "sara" || got.Moves[1].Username != "ali" {
		t.Fatalf("after should give newer moves, oldest first: %+v", got.Moves)
	}
}

func TestPublicRoomShowsTheLastFiftyMoves(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	// A different letters-only text each time, every verse chained م → م.
	letters := []rune("بتثجحخدذرز")
	for i := 0; i < 60; i++ {
		cookie := ali
		if i%2 == 1 {
			cookie = sara
		}
		word := string([]rune{letters[i/10], letters[i%10]})
		expect(t, api.say(cookie, []string{"م" + word + "کتابم"}), http.StatusCreated, "")
		clock.advance(11 * time.Second)
	}
	if got := api.room(""); len(got.Moves) != 50 || got.Moves[0].ID >= got.Moves[49].ID {
		t.Fatalf("expected the last 50 moves oldest first, got %d", len(got.Moves))
	}
}

func TestPublicRoomLeaders(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara, reza := api.signUp("ali"), api.signUp("sara"), api.signUp("reza")
	expect(t, api.say(ali, verseOf(0, "ا", "م")), http.StatusCreated, "")
	expect(t, api.say(sara, verseOf(1, "م", "ن")), http.StatusCreated, "")
	clock.advance(11 * time.Second)
	expect(t, api.say(ali, verseOf(2, "ن", "ر")), http.StatusCreated, "")
	expect(t, api.say(reza, verseOf(3, "ر", "ب")), http.StatusCreated, "")
	clock.advance(11 * time.Second)
	expect(t, api.say(ali, verseOf(4, "ب", "ب")), http.StatusCreated, "")

	leaders := api.room("").Leaders
	if len(leaders) != 3 || leaders[0].Username != "ali" || leaders[0].Count != 3 {
		t.Fatalf("unexpected leaders: %+v", leaders)
	}
	// Private accounts drop out of the board.
	expect(t, api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, ali), http.StatusOK, "")
	leaders = api.room("").Leaders
	if len(leaders) != 2 || leaders[0].Count != 1 {
		t.Fatalf("private account should not lead: %+v", leaders)
	}
	// Only the last 7 days count.
	clock.advance(8 * 24 * time.Hour)
	if leaders := api.room("").Leaders; len(leaders) != 0 {
		t.Fatalf("old moves should not count: %+v", leaders)
	}
}

// --- matches ---------------------------------------------------------------------

const matchesPath = "/api/account/matches"

type matchEnvelope struct {
	Match Match `json:"match"`
}

func matchOf(t *testing.T, rec *httptest.ResponseRecorder) Match {
	t.Helper()
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var env matchEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	return env.Match
}

// createMatch posts a team match; the host is the cookie's user.
func (a *testAPI) createMatch(cookie string, opponents, allies []string, assist bool, seconds int) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(map[string]any{"opponents": opponents, "allies": allies, "assist": assist, "turnSeconds": seconds})
	return a.do("POST", matchesPath, string(raw), cookie)
}

// invite is the 1 vs 1 form.
func (a *testAPI) invite(cookie, opponent string, assist bool, seconds int) *httptest.ResponseRecorder {
	return a.createMatch(cookie, []string{opponent}, []string{}, assist, seconds)
}

func (a *testAPI) matchAction(cookie string, id int64, action string) *httptest.ResponseRecorder {
	return a.do("POST", fmt.Sprintf("%s/%d/%s", matchesPath, id, action), "", cookie)
}

func (a *testAPI) matchMove(cookie string, id int64, lines []string) *httptest.ResponseRecorder {
	return a.do("POST", fmt.Sprintf("%s/%d/moves", matchesPath, id), verseBody(lines), cookie)
}

func (a *testAPI) getMatch(cookie string, id int64, query string) *httptest.ResponseRecorder {
	return a.do("GET", fmt.Sprintf("%s/%d%s", matchesPath, id, query), "", cookie)
}

type matchList struct {
	Matches  []Match `json:"matches"`
	Invites  int     `json:"invites"`
	YourTurn int     `json:"yourTurn"`
}

func (a *testAPI) matchList(cookie string) matchList {
	a.t.Helper()
	rec := a.do("GET", matchesPath, "", cookie)
	expect(a.t, rec, http.StatusOK, "")
	var list matchList
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		a.t.Fatal(err)
	}
	return list
}

// activeMatch is a 1 vs 1 match ali (host) and sara have both agreed to.
func activeMatch(t *testing.T, api *testAPI, ali, sara string, assist bool, seconds int) int64 {
	t.Helper()
	id := matchOf(t, api.invite(ali, "sara", assist, seconds)).ID
	if m := matchOf(t, api.matchAction(sara, id, "accept")); m.Status != "active" {
		t.Fatalf("accept should activate: %+v", m)
	}
	return id
}

// quartet signs up ali and bita (team 0) against sara and reza (team 1).
type quartet struct{ ali, bita, sara, reza string }

func newQuartet(api *testAPI) quartet {
	return quartet{api.signUp("ali"), api.signUp("bita"), api.signUp("sara"), api.signUp("reza")}
}

// pending2v2 is a 2 vs 2 match nobody has answered yet.
func pending2v2(t *testing.T, api *testAPI, q quartet, seconds int) int64 {
	t.Helper()
	rec := api.createMatch(q.ali, []string{"sara", "reza"}, []string{"bita"}, true, seconds)
	expect(t, rec, http.StatusCreated, "")
	return matchOf(t, rec).ID
}

// active2v2 is a 2 vs 2 match everyone accepted.
func active2v2(t *testing.T, api *testAPI, q quartet, seconds int) int64 {
	t.Helper()
	id := pending2v2(t, api, q, seconds)
	for _, cookie := range []string{q.bita, q.sara, q.reza} {
		expect(t, api.matchAction(cookie, id, "accept"), http.StatusOK, "")
	}
	if m := matchOf(t, api.getMatch(q.ali, id, "")); m.Status != "active" {
		t.Fatalf("everyone accepted, match should be active: %+v", m)
	}
	return id
}

func states(team Team) []string {
	var out []string
	for _, p := range team.Players {
		out = append(out, p.Username+":"+p.State)
	}
	return out
}

func sameStrings(got []string, want ...string) bool {
	return strings.Join(got, ",") == strings.Join(want, ",")
}

func TestMatchCreateShape(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)

	rec := api.createMatch(q.ali, []string{"sara", "reza"}, []string{"bita"}, true, 60)
	expect(t, rec, http.StatusCreated, "")
	m := matchOf(t, rec)
	if m.Status != "pending" || !m.Assist || m.TurnSeconds != 60 || m.Host != "ali" || m.MyTeam != 0 || m.MyState != "joined" ||
		m.TurnTeam != -1 || m.TurnDeadline != 0 || m.NextLetter != "" || m.WinnerTeam != -1 || m.EndReason != "" ||
		m.LastMove != nil || m.Moves == nil || m.Now != clock.t.UnixMilli() || m.CreatedAt != clock.t.UnixMilli() || m.UpdatedAt != m.CreatedAt {
		t.Fatalf("unexpected pending match: %+v", m)
	}
	if !sameStrings(states(m.Teams[0]), "ali:joined", "bita:invited") || !sameStrings(states(m.Teams[1]), "sara:invited", "reza:invited") {
		t.Fatalf("unexpected teams: %+v", m.Teams)
	}

	// The raw JSON: host is a username, players carry accent and state, lastMove is null.
	raw := fields(t, rec)["match"].(map[string]any)
	if raw["host"] != "ali" || raw["lastMove"] != nil || raw["myTeam"] != float64(0) {
		t.Fatalf("unexpected raw match: %s", rec.Body)
	}
	teams := raw["teams"].([]any)
	player := teams[0].(map[string]any)["players"].([]any)[0].(map[string]any)
	if len(teams) != 2 || player["accent"] != "" || player["state"] != "joined" || player["moveCount"] != float64(0) ||
		teams[1].(map[string]any)["moveCount"] != float64(0) {
		t.Fatalf("unexpected raw teams: %s", rec.Body)
	}
	// Each invitee sees the match from their own seat.
	if m := matchOf(t, api.getMatch(q.sara, m.ID, "")); m.MyTeam != 1 || m.MyState != "invited" {
		t.Fatalf("sara's view: %+v", m)
	}
}

func TestMatchOneVsOneEndToEnd(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")

	// The legacy single-opponent form still works.
	rec := api.do("POST", matchesPath, `{"opponent":"Sara","assist":false,"turnSeconds":30}`, ali)
	expect(t, rec, http.StatusCreated, "")
	id := matchOf(t, rec).ID
	clock.advance(time.Minute)
	m := matchOf(t, api.matchAction(sara, id, "accept"))
	if m.Status != "active" || m.TurnTeam != 0 || m.TurnDeadline != clock.t.Add(30*time.Second).UnixMilli() || m.UpdatedAt != clock.t.UnixMilli() ||
		!sameStrings(states(m.Teams[0]), "ali:joined") || !sameStrings(states(m.Teams[1]), "sara:joined") {
		t.Fatalf("accept should open the match with the host's team on turn: %+v", m)
	}
	expect(t, api.matchMove(sara, id, verseOf(0, "ا", "م")), http.StatusConflict, "نوبت تیم شما نیست.")
	expect(t, api.matchMove(ali, id, verseOf(0, "ا", "م")), http.StatusCreated, "")
	expect(t, api.matchMove(sara, id, verseOf(1, "م", "ن")), http.StatusCreated, "")
	clock.advance(31 * time.Second)
	m = matchOf(t, api.getMatch(sara, id, ""))
	if m.Status != "finished" || m.WinnerTeam != 1 || m.EndReason != "timeout" || len(m.Moves) != 2 {
		t.Fatalf("ali ran out of time: %+v", m)
	}
}

func TestMatchCreateRules(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	for _, name := range []string{"bita", "sara", "reza", "mina", "nima", "omid", "paria"} {
		api.signUp(name)
	}
	hidden := api.signUp("hidden")
	expect(t, api.do("PUT", "/api/account/visibility", `{"isPublic":false}`, hidden), http.StatusOK, "")

	bad := map[string]*httptest.ResponseRecorder{
		"no opponents":    api.createMatch(ali, []string{}, []string{}, true, 60),
		"null opponents":  api.do("POST", matchesPath, `{"assist":true,"turnSeconds":60}`, ali),
		"six opponents":   api.createMatch(ali, []string{"bita", "sara", "reza", "mina", "nima", "omid"}, []string{}, true, 60),
		"five allies":     api.createMatch(ali, []string{"paria"}, []string{"bita", "sara", "reza", "mina", "nima"}, true, 60),
		"bad seconds":     api.invite(ali, "sara", true, 45),
		"zero seconds":    api.invite(ali, "sara", true, 0),
		"yourself":        api.invite(ali, "ali", true, 60),
		"yourself (case)": api.invite(ali, " ALI ", true, 60),
		"ally is you":     api.createMatch(ali, []string{"sara"}, []string{"ali"}, true, 60),
		"dup opponents":   api.createMatch(ali, []string{"sara", "Sara"}, []string{}, true, 60),
		"dup across":      api.createMatch(ali, []string{"sara"}, []string{"sara"}, true, 60),
		"dup allies":      api.createMatch(ali, []string{"sara"}, []string{"bita", "bita"}, true, 60),
	}
	for name, rec := range bad {
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400: %s", name, rec.Code, rec.Body)
		}
	}
	expect(t, bad["no opponents"], http.StatusBadRequest, "تیم مقابل باید یک تا ۵ نفر باشد.")
	expect(t, bad["five allies"], http.StatusBadRequest, "هم‌تیمی‌ها (جز شما) باید حداکثر ۴ نفر باشند.")

	// Unknown and private users are 404 and the first one is named.
	expect(t, api.invite(ali, "hidden", true, 60), http.StatusNotFound, "کاربر «hidden» پیدا نشد.")
	expect(t, api.invite(ali, "nobody", true, 60), http.StatusNotFound, "کاربر «nobody» پیدا نشد.")
	expect(t, api.createMatch(ali, []string{"sara", "ghost"}, []string{"hidden"}, true, 60), http.StatusNotFound, "کاربر «ghost» پیدا نشد.")
	expect(t, api.createMatch(ali, []string{"sara"}, []string{"bita", "hidden", "ghost"}, true, 60), http.StatusNotFound, "کاربر «hidden» پیدا نشد.")
	expect(t, api.do("POST", matchesPath, `{"opponent":"sara","assist":true,"turnSeconds":60}`, ""), http.StatusUnauthorized, "")
	if list := api.matchList(ali); len(list.Matches) != 0 {
		t.Fatalf("refused requests must create nothing: %+v", list)
	}

	// The biggest allowed match, and every turn length.
	rec := api.createMatch(ali, []string{"sara", "reza", "mina"}, []string{"bita", "nima", "omid", "paria"}, true, 60)
	expect(t, rec, http.StatusCreated, "")
	if m := matchOf(t, rec); len(m.Teams[0].Players) != 5 || len(m.Teams[1].Players) != 3 {
		t.Fatalf("unexpected teams: %+v", m.Teams)
	}
	for _, seconds := range []int{30, 180, 86400} {
		expect(t, api.invite(ali, "Sara", false, seconds), http.StatusCreated, "")
	}
}

func TestMatchPendingInviteCap(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	api.signUp("sara")
	var ids []int64
	for i := 0; i < 5; i++ {
		ids = append(ids, matchOf(t, api.invite(ali, "sara", true, 60)).ID)
	}
	expect(t, api.invite(ali, "sara", true, 60), http.StatusConflict, "")
	// Only matches the user hosts count, not the ones they are invited to.
	expect(t, api.invite(api.signUp("reza"), "ali", true, 60), http.StatusCreated, "")
	// Answered matches stop counting.
	expect(t, api.matchAction(ali, ids[0], "cancel"), http.StatusOK, "")
	expect(t, api.invite(ali, "sara", true, 60), http.StatusCreated, "")
	expect(t, api.matchAction(ali, ids[1], "start"), http.StatusConflict, "")
}

func TestMatchAcceptDeclineCancel(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	api.signUp("reza")

	id := matchOf(t, api.invite(ali, "sara", true, 30)).ID
	clock.advance(time.Minute)
	expect(t, api.matchAction(ali, id, "accept"), http.StatusConflict, "به این دعوت قبلاً پاسخ داده‌اید.")
	expect(t, api.matchAction(sara, id, "cancel"), http.StatusForbidden, "")
	expect(t, api.matchAction(sara, id, "start"), http.StatusForbidden, "")
	expect(t, api.matchAction(ali, id, "start"), http.StatusConflict, "برای شروع، از هر دو تیم دست‌کم یک نفر باید پذیرفته باشد.")
	expect(t, api.matchAction(sara, id, "accept"), http.StatusOK, "")
	expect(t, api.matchAction(sara, id, "accept"), http.StatusConflict, "این دعوت دیگر معتبر نیست.")
	expect(t, api.matchAction(sara, id, "decline"), http.StatusConflict, "")
	expect(t, api.matchAction(ali, id, "cancel"), http.StatusConflict, "")
	expect(t, api.matchAction(ali, id, "start"), http.StatusConflict, "")

	id = matchOf(t, api.invite(ali, "sara", true, 30)).ID
	m := matchOf(t, api.matchAction(sara, id, "decline"))
	if m.Status != "declined" || m.TurnTeam != -1 || m.TurnDeadline != 0 || m.MyState != "declined" || m.MyTeam != -1 {
		t.Fatalf("unexpected declined match: %+v", m)
	}
	id = matchOf(t, api.invite(ali, "sara", true, 30)).ID
	if m := matchOf(t, api.matchAction(ali, id, "cancel")); m.Status != "cancelled" {
		t.Fatalf("unexpected cancelled match: %+v", m)
	}
	expect(t, api.matchAction(sara, id, "accept"), http.StatusConflict, "")

	id = matchOf(t, api.invite(ali, "sara", true, 30)).ID
	stranger := api.signUp("reza2")
	for _, action := range []string{"accept", "decline", "start", "cancel", "leave", "resign"} {
		expect(t, api.matchAction(stranger, id, action), http.StatusNotFound, "این مسابقه پیدا نشد.")
	}
	expect(t, api.matchAction(ali, 9999, "cancel"), http.StatusNotFound, "")
}

func TestMatchTeamsFillUpBeforeStarting(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := pending2v2(t, api, q, 60)

	for i, cookie := range []string{q.bita, q.sara} {
		clock.advance(time.Second)
		m := matchOf(t, api.matchAction(cookie, id, "accept"))
		if m.Status != "pending" || m.TurnTeam != -1 || m.UpdatedAt != clock.t.UnixMilli() {
			t.Fatalf("accept %d: match must wait for everyone: %+v", i, m)
		}
	}
	expect(t, api.matchMove(q.ali, id, verseOf(0, "ا", "م")), http.StatusConflict, "این مسابقه فعال نیست.")
	clock.advance(time.Second)
	m := matchOf(t, api.matchAction(q.reza, id, "accept"))
	if m.Status != "active" || m.TurnTeam != 0 || m.TurnDeadline != clock.t.Add(time.Minute).UnixMilli() || m.MyTeam != 1 || m.MyState != "joined" ||
		!sameStrings(states(m.Teams[0]), "ali:joined", "bita:joined") || !sameStrings(states(m.Teams[1]), "sara:joined", "reza:joined") {
		t.Fatalf("the last answer should start the match: %+v", m)
	}
}

func TestMatchHostStartsEarly(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := pending2v2(t, api, q, 60)

	// Nobody on the other team has joined yet.
	expect(t, api.matchAction(q.bita, id, "accept"), http.StatusOK, "")
	expect(t, api.matchAction(q.ali, id, "start"), http.StatusConflict, "")
	expect(t, api.matchAction(q.sara, id, "accept"), http.StatusOK, "")
	expect(t, api.matchAction(q.bita, id, "start"), http.StatusForbidden, "")

	clock.advance(5 * time.Second)
	m := matchOf(t, api.matchAction(q.ali, id, "start"))
	if m.Status != "active" || m.TurnTeam != 0 || m.TurnDeadline != clock.t.Add(time.Minute).UnixMilli() ||
		!sameStrings(states(m.Teams[1]), "sara:joined", "reza:declined") {
		t.Fatalf("early start should drop whoever has not answered: %+v", m)
	}
	// Reza can still look, but has no seat.
	got := matchOf(t, api.getMatch(q.reza, id, ""))
	if got.MyTeam != -1 || got.MyState != "declined" {
		t.Fatalf("reza's view: %+v", got)
	}
	expect(t, api.matchAction(q.reza, id, "accept"), http.StatusConflict, "")
	expect(t, api.matchAction(q.reza, id, "leave"), http.StatusConflict, "شما در این مسابقه حضور ندارید.")
	expect(t, api.matchMove(q.reza, id, verseOf(0, "ا", "م")), http.StatusConflict, "نوبت تیم شما نیست.")
	expect(t, api.matchAction(q.ali, id, "start"), http.StatusConflict, "")
}

func TestMatchDeclineCollapsesATeam(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := pending2v2(t, api, q, 60)

	m := matchOf(t, api.matchAction(q.sara, id, "decline"))
	if m.Status != "pending" || m.MyState != "declined" || m.MyTeam != -1 {
		t.Fatalf("reza is still invited, the match goes on: %+v", m)
	}
	// Whoever stays can accept; the other team has only an unanswered invite.
	expect(t, api.matchAction(q.bita, id, "accept"), http.StatusOK, "")
	m = matchOf(t, api.matchAction(q.reza, id, "decline"))
	if m.Status != "declined" || m.TurnTeam != -1 || m.WinnerTeam != -1 {
		t.Fatalf("a team with nobody joined or invited ends the match: %+v", m)
	}
	// The host still sees it as ended; the decliners keep read access but not the list entry.
	if got := matchOf(t, api.getMatch(q.ali, id, "")); got.Status != "declined" || got.MyState != "joined" {
		t.Fatalf("host's view: %+v", got)
	}
	expect(t, api.getMatch(q.sara, id, ""), http.StatusOK, "")
	if list := api.matchList(q.ali); len(list.Matches) != 1 || list.Matches[0].Status != "declined" {
		t.Fatalf("host should list the declined match: %+v", list)
	}
	if list := api.matchList(q.sara); len(list.Matches) != 0 {
		t.Fatalf("a player who declined does not list the match: %+v", list)
	}
}

func TestMatchLastDeclineCanStartIt(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := pending2v2(t, api, q, 60)
	expect(t, api.matchAction(q.sara, id, "accept"), http.StatusOK, "")
	expect(t, api.matchAction(q.reza, id, "accept"), http.StatusOK, "")
	// Bita is the only one left to answer; saying no leaves both teams ready.
	m := matchOf(t, api.matchAction(q.bita, id, "decline"))
	if m.Status != "active" || m.TurnTeam != 0 || m.MyTeam != -1 {
		t.Fatalf("nobody is invited and both teams have players: %+v", m)
	}
}

func TestMatchPlayersOnly(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	reza := api.signUp("reza")
	id := activeMatch(t, api, ali, sara, true, 60)

	expect(t, api.getMatch(reza, id, ""), http.StatusNotFound, "این مسابقه پیدا نشد.")
	expect(t, api.matchMove(reza, id, verseOf(0, "ا", "م")), http.StatusNotFound, "")
	expect(t, api.getMatch("", id, ""), http.StatusUnauthorized, "")
	expect(t, api.do("GET", matchesPath+"/abc", "", ali), http.StatusNotFound, "")
	expect(t, api.getMatch(sara, id, ""), http.StatusOK, "")
	if list := api.matchList(reza); len(list.Matches) != 0 || list.Matches == nil {
		t.Fatalf("a stranger sees no matches: %+v", list)
	}
}

func TestMatchTurnsAndLetterRule(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	id := activeMatch(t, api, ali, sara, true, 60)

	// The first move may start with any letter.
	clock.advance(10 * time.Second)
	rec := api.matchMove(ali, id, []string{"ادرختم"})
	expect(t, rec, http.StatusCreated, "")
	m := matchOf(t, rec)
	if m.TurnTeam != 1 || m.NextLetter != "م" || m.TurnDeadline != clock.t.Add(time.Minute).UnixMilli() ||
		m.LastMove == nil || m.LastMove.Username != "ali" || len(m.Moves) != 1 ||
		m.Teams[0].Players[0].MoveCount != 1 || m.Teams[0].MoveCount != 1 || m.Teams[1].MoveCount != 0 {
		t.Fatalf("unexpected match after the first move: %+v", m)
	}
	expect(t, api.matchMove(ali, id, verseOf(1, "م", "ن")), http.StatusConflict, "نوبت تیم شما نیست.")
	expect(t, api.matchMove(sara, id, verseOf(1, "ب", "ن")), http.StatusBadRequest, "بیت باید با «م» شروع شود.")
	expect(t, api.matchMove(sara, id, []string{"x"}), http.StatusBadRequest, "")
	if got := matchOf(t, api.getMatch(sara, id, "")); len(got.Moves) != 1 || got.TurnTeam != 1 {
		t.Fatalf("refused moves must change nothing: %+v", got)
	}

	m = matchOf(t, api.matchMove(sara, id, verseOf(1, "م", "ي")))
	if m.TurnTeam != 0 || m.NextLetter != "ی" || len(m.Moves) != 2 || m.Teams[1].Players[0].MoveCount != 1 {
		t.Fatalf("unexpected match after the second move: %+v", m)
	}
	expect(t, api.matchMove(ali, id, verseOf(2, "ی", "ن")), http.StatusCreated, "")
	expect(t, api.matchMove(sara, id, verseOf(3, "ن", "ا")), http.StatusCreated, "")
	// The letters of the first verse again, spelled differently, are a repeat.
	expect(t, api.matchMove(ali, id, []string{"«اَدرخت‌م»"}), http.StatusBadRequest, "این بیت قبلاً خوانده شده است.")
	expect(t, api.matchMove(ali, id, verseOf(4, "ا", "ن")), http.StatusCreated, "")
}

func TestMatchTeamsAlternateAndAnyMemberMayAnswer(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := active2v2(t, api, q, 60)

	// Team 0 is on turn: either of its members may answer, the other team may not.
	expect(t, api.matchMove(q.sara, id, verseOf(0, "ا", "م")), http.StatusConflict, "نوبت تیم شما نیست.")
	expect(t, api.matchMove(q.reza, id, verseOf(0, "ا", "م")), http.StatusConflict, "نوبت تیم شما نیست.")
	clock.advance(5 * time.Second)
	m := matchOf(t, api.matchMove(q.bita, id, verseOf(0, "ا", "م")))
	if m.TurnTeam != 1 || m.TurnDeadline != clock.t.Add(time.Minute).UnixMilli() || m.NextLetter != "م" || m.LastMove.Username != "bita" {
		t.Fatalf("the first valid verse passes the turn: %+v", m)
	}
	// The whole of team 0 is now waiting, including the host.
	expect(t, api.matchMove(q.ali, id, verseOf(1, "م", "ن")), http.StatusConflict, "نوبت تیم شما نیست.")
	expect(t, api.matchMove(q.bita, id, verseOf(1, "م", "ن")), http.StatusConflict, "نوبت تیم شما نیست.")
	m = matchOf(t, api.matchMove(q.reza, id, verseOf(1, "م", "ن")))
	if m.TurnTeam != 0 || m.NextLetter != "ن" {
		t.Fatalf("team 1 answered, team 0 is on turn again: %+v", m)
	}
	expect(t, api.matchMove(q.ali, id, verseOf(2, "ن", "ر")), http.StatusCreated, "")
	expect(t, api.matchMove(q.sara, id, verseOf(3, "ر", "ب")), http.StatusCreated, "")
	expect(t, api.matchMove(q.bita, id, verseOf(4, "ب", "ب")), http.StatusCreated, "")

	m = matchOf(t, api.getMatch(q.sara, id, ""))
	counts := map[string]int{}
	for _, team := range m.Teams {
		for _, p := range team.Players {
			counts[p.Username] = p.MoveCount
		}
	}
	if counts["ali"] != 1 || counts["bita"] != 2 || counts["sara"] != 1 || counts["reza"] != 1 || m.Teams[0].MoveCount != 3 || m.Teams[1].MoveCount != 2 || len(m.Moves) != 5 {
		t.Fatalf("move counts per player and team: %+v", m.Teams)
	}
	// A repeat is refused across teams within the match (bita's verse, team 1 on turn).
	expect(t, api.matchMove(q.reza, id, verseOf(4, "ب", "ب")), http.StatusBadRequest, "این بیت قبلاً خوانده شده است.")
	expect(t, api.matchMove(q.sara, id, verseOf(5, "ب", "ر")), http.StatusCreated, "")
}

func TestMatchLeave(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := active2v2(t, api, q, 60)

	clock.advance(time.Second)
	m := matchOf(t, api.matchAction(q.bita, id, "leave"))
	if m.Status != "active" || m.MyState != "left" || m.UpdatedAt != clock.t.UnixMilli() ||
		!sameStrings(states(m.Teams[0]), "ali:joined", "bita:left") {
		t.Fatalf("a team-mate remains, so the match goes on: %+v", m)
	}
	expect(t, api.matchAction(q.bita, id, "leave"), http.StatusConflict, "شما در این مسابقه حضور ندارید.")
	expect(t, api.matchMove(q.bita, id, verseOf(0, "ا", "م")), http.StatusConflict, "نوبت تیم شما نیست.")
	// The host (last one on the team) still plays, then leaves and the team loses.
	expect(t, api.matchMove(q.ali, id, verseOf(0, "ا", "م")), http.StatusCreated, "")
	expect(t, api.matchMove(q.sara, id, verseOf(1, "م", "ن")), http.StatusCreated, "")
	clock.advance(time.Second)
	m = matchOf(t, api.matchAction(q.ali, id, "resign")) // alias of leave
	if m.Status != "finished" || m.WinnerTeam != 1 || m.EndReason != "resign" || m.TurnTeam != -1 || m.TurnDeadline != 0 || m.UpdatedAt != clock.t.UnixMilli() {
		t.Fatalf("the last player leaving loses the team the match: %+v", m)
	}
	expect(t, api.matchAction(q.sara, id, "leave"), http.StatusConflict, "این مسابقه تمام شده است.")
	expect(t, api.matchMove(q.sara, id, verseOf(2, "ن", "ر")), http.StatusConflict, "")
}

func TestMatchLeaveOutOfTurnHandsOverTheWin(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	id := activeMatch(t, api, ali, sara, true, 60)
	m := matchOf(t, api.matchAction(sara, id, "leave"))
	if m.Status != "finished" || m.WinnerTeam != 0 || m.EndReason != "resign" {
		t.Fatalf("leaving out of turn should still lose: %+v", m)
	}
	pending := matchOf(t, api.invite(ali, "sara", true, 60)).ID
	expect(t, api.matchAction(ali, pending, "leave"), http.StatusConflict, "این مسابقه فعال نیست.")
}

func TestMatchAssistOff(t *testing.T) {
	api, _ := newMoshaereAPI(t, hafez)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	off := activeMatch(t, api, ali, sara, false, 60)
	on := activeMatch(t, api, ali, sara, true, 60)

	rec := api.do("POST", fmt.Sprintf("%s/%d/moves", matchesPath, off), `{"key":"ganjoor:hafez:1","from":0,"to":1}`, ali)
	expect(t, rec, http.StatusBadRequest, "در این مسابقه جست‌وجو خاموش است.")
	expect(t, api.matchMove(ali, off, verseOf(0, "ا", "م")), http.StatusCreated, "")

	rec = api.do("POST", fmt.Sprintf("%s/%d/moves", matchesPath, on), `{"key":"ganjoor:hafez:1","from":0,"to":1}`, ali)
	expect(t, rec, http.StatusCreated, "")
	m := matchOf(t, rec)
	if m.LastMove.Key != "ganjoor:hafez:1" || m.LastMove.PoetName != "حافظ" || len(m.LastMove.Lines) != 2 {
		t.Fatalf("picked verse not stored: %+v", m.LastMove)
	}
	// A stranger learns nothing about the match from a picked verse either.
	reza := api.signUp("reza")
	rec = api.do("POST", fmt.Sprintf("%s/%d/moves", matchesPath, off), `{"key":"ganjoor:hafez:1","from":0,"to":1}`, reza)
	expect(t, rec, http.StatusNotFound, "")
}

func TestMatchRepeatIsPerMatch(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	one := activeMatch(t, api, ali, sara, true, 60)
	two := activeMatch(t, api, ali, sara, true, 60)
	verse := []string{"مدرختم"}
	expect(t, api.matchMove(ali, one, verse), http.StatusCreated, "")
	expect(t, api.matchMove(ali, two, verse), http.StatusCreated, "")
	expect(t, api.matchMove(sara, one, verse), http.StatusBadRequest, "این بیت قبلاً خوانده شده است.")
}

func TestMatchTimeoutOnRead(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := active2v2(t, api, q, 30)
	expect(t, api.matchMove(q.ali, id, verseOf(0, "ا", "م")), http.StatusCreated, "")

	clock.advance(29 * time.Second)
	if m := matchOf(t, api.getMatch(q.ali, id, "")); m.Status != "active" {
		t.Fatalf("still within the deadline: %+v", m)
	}
	deadline := clock.t.Add(time.Second).UnixMilli()
	clock.advance(2 * time.Second)
	m := matchOf(t, api.getMatch(q.ali, id, ""))
	if m.Status != "finished" || m.WinnerTeam != 0 || m.EndReason != "timeout" || m.TurnTeam != -1 || m.TurnDeadline != 0 || m.UpdatedAt != deadline {
		t.Fatalf("team 1 ran out of time: %+v", m)
	}
	expect(t, api.matchMove(q.sara, id, verseOf(1, "م", "ن")), http.StatusConflict, "این مسابقه تمام شده است.")
	expect(t, api.matchMove(q.ali, id, verseOf(1, "م", "ن")), http.StatusConflict, "این مسابقه تمام شده است.")
	expect(t, api.matchAction(q.sara, id, "leave"), http.StatusConflict, "")
}

func TestMatchTimeoutOnList(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)
	id := active2v2(t, api, q, 30)

	clock.advance(time.Minute)
	list := api.matchList(q.sara)
	if len(list.Matches) != 1 || list.Matches[0].ID != id || list.Matches[0].Status != "finished" ||
		list.Matches[0].WinnerTeam != 1 || list.Matches[0].EndReason != "timeout" || list.YourTurn != 0 {
		t.Fatalf("team 0 missed the first move: %+v", list)
	}
}

func TestMatchMoveAfterDeadlineIsRefusedAndLoses(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	id := activeMatch(t, api, ali, sara, true, 30)

	clock.advance(31 * time.Second)
	expect(t, api.matchMove(ali, id, verseOf(0, "ا", "م")), http.StatusConflict, "زمان نوبت تمام شده است.")
	// The refusal still recorded the loss.
	m := matchOf(t, api.getMatch(sara, id, ""))
	if m.Status != "finished" || m.WinnerTeam != 1 || m.EndReason != "timeout" || len(m.Moves) != 0 {
		t.Fatalf("late move should end the match: %+v", m)
	}
}

func TestMatchReadWithAfter(t *testing.T) {
	api, _ := newMoshaereAPI(t, nil)
	ali, sara := api.signUp("ali"), api.signUp("sara")
	id := activeMatch(t, api, ali, sara, true, 60)
	expect(t, api.matchMove(ali, id, verseOf(0, "ا", "م")), http.StatusCreated, "")
	expect(t, api.matchMove(sara, id, verseOf(1, "م", "ن")), http.StatusCreated, "")

	full := matchOf(t, api.getMatch(ali, id, ""))
	if len(full.Moves) != 2 || full.Moves[0].ID >= full.Moves[1].ID {
		t.Fatalf("moves should be oldest first: %+v", full.Moves)
	}
	newer := matchOf(t, api.getMatch(ali, id, fmt.Sprintf("?after=%d", full.Moves[0].ID)))
	if len(newer.Moves) != 1 || newer.Moves[0].ID != full.Moves[1].ID || newer.LastMove == nil || newer.NextLetter != "ن" {
		t.Fatalf("after should give only newer moves: %+v", newer)
	}
	none := matchOf(t, api.getMatch(ali, id, fmt.Sprintf("?after=%d", full.Moves[1].ID)))
	if none.Moves == nil || len(none.Moves) != 0 || none.LastMove == nil {
		t.Fatalf("no new moves should still be a list: %+v", none)
	}
}

func TestMatchListCountersAndOrder(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	q := newQuartet(api)

	team := active2v2(t, api, q, 60)
	clock.advance(time.Second)
	invite := matchOf(t, api.invite(q.reza, "sara", false, 180)).ID
	clock.advance(time.Second)
	sent := matchOf(t, api.invite(q.sara, "reza", false, 180)).ID
	clock.advance(time.Second)
	expect(t, api.matchMove(q.bita, team, verseOf(0, "ا", "م")), http.StatusCreated, "")

	// Sara: the 2v2 is her team's turn, one invite from reza, one match she hosts.
	list := api.matchList(q.sara)
	if len(list.Matches) != 3 || list.Invites != 1 || list.YourTurn != 1 {
		t.Fatalf("sara: %+v", list)
	}
	// Newest update first; moves are left out of lists but the last one is there.
	if list.Matches[0].ID != team || list.Matches[1].ID != sent || list.Matches[2].ID != invite {
		t.Fatalf("unexpected order: %d %d %d", list.Matches[0].ID, list.Matches[1].ID, list.Matches[2].ID)
	}
	if first := list.Matches[0]; first.Moves == nil || len(first.Moves) != 0 || first.LastMove == nil || first.NextLetter != "م" ||
		first.Teams[0].MoveCount != 1 || first.MyTeam != 1 || first.TurnTeam != 1 {
		t.Fatalf("list entry should carry lastMove but no moves: %+v", first)
	}
	// Reza is on sara's team: same turn, invited to the match sara sent... and host of one.
	if list := api.matchList(q.reza); list.Invites != 1 || list.YourTurn != 1 || len(list.Matches) != 3 {
		t.Fatalf("reza: %+v", list)
	}
	// Team 0 just moved, so it waits.
	for _, cookie := range []string{q.ali, q.bita} {
		if list := api.matchList(cookie); list.Invites != 0 || list.YourTurn != 0 || len(list.Matches) != 1 {
			t.Fatalf("team 0: %+v", list)
		}
	}
	// Someone who left is no longer asked for a move.
	expect(t, api.matchAction(q.sara, team, "leave"), http.StatusOK, "")
	if list := api.matchList(q.sara); list.YourTurn != 0 || list.Invites != 1 {
		t.Fatalf("sara after leaving: %+v", list)
	}
	if list := api.matchList(q.reza); list.YourTurn != 1 {
		t.Fatalf("reza is still on turn: %+v", list)
	}
}

func TestMatchListKeepsOnlyTheLatestEnded(t *testing.T) {
	api, clock := newMoshaereAPI(t, nil)
	ali := api.signUp("ali")
	api.signUp("sara")
	var cancelled []int64
	for i := 0; i < 25; i++ {
		id := matchOf(t, api.invite(ali, "sara", true, 60)).ID
		clock.advance(time.Second)
		expect(t, api.matchAction(ali, id, "cancel"), http.StatusOK, "")
		cancelled = append(cancelled, id)
	}
	pending := matchOf(t, api.invite(ali, "sara", true, 60)).ID

	list := api.matchList(ali)
	if len(list.Matches) != 21 {
		t.Fatalf("want the pending match and 20 ended ones, got %d", len(list.Matches))
	}
	ids := map[int64]bool{}
	for _, m := range list.Matches {
		ids[m.ID] = true
	}
	if !ids[pending] || !ids[cancelled[24]] || ids[cancelled[0]] {
		t.Fatalf("wrong matches kept: %v", ids)
	}
}

// The first matches table had host_id and guest_id; it was never deployed, so
// opening the store replaces it instead of migrating it.
func TestOpeningTheStoreReplacesTheOneVsOneMatchTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = old.Exec(`
		CREATE TABLE matches (id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL, guest_id INTEGER NOT NULL,
			status TEXT NOT NULL, assist INTEGER NOT NULL, turn_seconds INTEGER NOT NULL, turn_user_id INTEGER,
			turn_deadline INTEGER NOT NULL DEFAULT 0, winner_id INTEGER, end_reason TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE INDEX matches_guest ON matches(guest_id, status, updated_at);
		CREATE TABLE match_moves (id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES matches(id),
			user_id INTEGER NOT NULL, lines TEXT NOT NULL, norm TEXT NOT NULL, first_letter TEXT NOT NULL,
			last_letter TEXT NOT NULL, created_at INTEGER NOT NULL);
		INSERT INTO matches (host_id, guest_id, status, assist, turn_seconds, created_at, updated_at) VALUES (1, 2, 'pending', 1, 60, 1, 1);
		INSERT INTO match_moves (match_id, user_id, lines, norm, first_letter, last_letter, created_at) VALUES (1, 1, '[]', 'x', 'x', 'x', 1);`)
	if err != nil {
		t.Fatal(err)
	}
	old.Close()

	store, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.db.Close()
	columns := func(table string) map[string]bool {
		rows, err := store.db.Query(`SELECT name FROM pragma_table_info(?)`, table)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		have := map[string]bool{}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			have[name] = true
		}
		return have
	}
	if m := columns("matches"); m["guest_id"] || !m["turn_team"] || !m["winner_team"] || m["turn_user_id"] {
		t.Fatalf("matches was not replaced: %v", m)
	}
	if p := columns("match_players"); !p["team"] || !p["state"] || !p["move_count"] || !p["joined_at"] {
		t.Fatalf("match_players missing: %v", p)
	}
	if m := columns("match_moves"); !m["norm"] || !m["created_at"] {
		t.Fatalf("match_moves missing: %v", m)
	}
	var rows int
	if err := store.db.QueryRow(`SELECT (SELECT COUNT(*) FROM matches) + (SELECT COUNT(*) FROM match_moves)`).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("old rows should be gone: %d %v", rows, err)
	}
	// Opening it again must leave the new tables alone.
	store.db.Close()
	again, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	again.db.Close()
}
