package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Moshaere (مشاعره): a public room and team matches where each verse
// starts with the previous verse's last letter. Contract §6.

func init() {
	featureUpgrades = append(featureUpgrades, dropOneVsOneMatches)
	featureSchemas = append(featureSchemas, moshaereSchema)
}

// dropOneVsOneMatches removes the tables of the two-player prototype (a matches
// table with guest_id) so moshaereSchema can create the team ones. That model was
// never deployed, so its rows are not migrated.
func dropOneVsOneMatches(db *sql.DB) error {
	var old int
	err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('matches') WHERE name = 'guest_id'`).Scan(&old)
	if err != nil || old == 0 {
		return err
	}
	_, err = db.Exec(`DROP TABLE match_moves; DROP TABLE matches;`)
	return err
}

// lines is a JSON array; norm is the letters-only text that repeat checks compare.
const moshaereSchema = `
CREATE TABLE IF NOT EXISTS public_moves (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	lines TEXT NOT NULL,
	norm TEXT NOT NULL,
	first_letter TEXT NOT NULL,
	last_letter TEXT NOT NULL,
	poem_key TEXT NOT NULL DEFAULT '',
	href TEXT NOT NULL DEFAULT '',
	poet_name TEXT NOT NULL DEFAULT '',
	poem_title TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS public_moves_user ON public_moves(user_id, created_at);
CREATE INDEX IF NOT EXISTS public_moves_time ON public_moves(created_at);
CREATE TABLE IF NOT EXISTS matches (
	id INTEGER PRIMARY KEY,
	host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	assist INTEGER NOT NULL,
	turn_seconds INTEGER NOT NULL,
	turn_team INTEGER NOT NULL DEFAULT -1,
	turn_deadline INTEGER NOT NULL DEFAULT 0,
	winner_team INTEGER NOT NULL DEFAULT -1,
	end_reason TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_host ON matches(host_id, status, updated_at);
CREATE TABLE IF NOT EXISTS match_players (
	match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	team INTEGER NOT NULL,
	state TEXT NOT NULL,
	move_count INTEGER NOT NULL DEFAULT 0,
	joined_at INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS match_players_user ON match_players(user_id, state);
CREATE TABLE IF NOT EXISTS match_moves (
	id INTEGER PRIMARY KEY,
	match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	lines TEXT NOT NULL,
	norm TEXT NOT NULL,
	first_letter TEXT NOT NULL,
	last_letter TEXT NOT NULL,
	poem_key TEXT NOT NULL DEFAULT '',
	href TEXT NOT NULL DEFAULT '',
	poet_name TEXT NOT NULL DEFAULT '',
	poem_title TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS match_moves_match ON match_moves(match_id, id);
`

const (
	maxVerseLines   = 2
	minVerseLine    = 2
	maxVerseLine    = 120
	minVerseLetters = 6
)

const (
	badLineCountMessage  = "بیت باید یک یا دو مصراع باشد."
	badLineLengthMessage = "هر مصراع باید بین ۲ تا ۱۲۰ نویسه باشد."
	shortVerseMessage    = "بیت خیلی کوتاه است."
	badRangeMessage      = "بازهٔ انتخاب‌شده درست نیست."
	repeatedVerseMessage = "این بیت قبلاً خوانده شده است."
	assistOffMessage     = "در این مسابقه جست‌وجو خاموش است."
	poemNotFoundMessage  = "این شعر پیدا نشد."
	poemSourceMessage    = "دریافت متن شعر ممکن نشد. کمی بعد دوباره امتحان کنید."
	badRequestMessage    = "درخواست نامعتبر است."
)

func wrongLetterMessage(letter string) string {
	return fmt.Sprintf("بیت باید با «%s» شروع شود.", letter)
}

// moshaereError is a rule violation with the status and Persian message to
// answer with; extra fields (such as nextLetter) go into the JSON body.
type moshaereError struct {
	status  int
	message string
	extra   map[string]any
}

func (e *moshaereError) Error() string { return e.message }

func failure(status int, message string) *moshaereError {
	return &moshaereError{status: status, message: message}
}

// writeMoshaereError answers a rule violation as such and anything else as a 500.
func writeMoshaereError(w http.ResponseWriter, err error) {
	var failed *moshaereError
	if !errors.As(err, &failed) {
		internalError(w, err)
		return
	}
	body := map[string]any{"error": failed.message}
	for k, v := range failed.extra {
		body[k] = v
	}
	writeJSON(w, failed.status, body)
}

// --- moves ---------------------------------------------------------------------

type Move struct {
	ID          int64    `json:"id"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Avatar      string   `json:"avatar"`
	Lines       []string `json:"lines"`
	FirstLetter string   `json:"firstLetter"`
	LastLetter  string   `json:"lastLetter"`
	// Poem the verse was picked from; all "" for typed verses.
	Key       string `json:"key"`
	Href      string `json:"href"`
	PoetName  string `json:"poetName"`
	PoemTitle string `json:"poemTitle"`
	CreatedAt int64  `json:"createdAt"`
	// Removed by a moderator: Lines holds a placeholder, the letters stay.
	Removed bool `json:"removed,omitempty"`
}

// moveColumns are the Move fields selected from a moves table aliased m,
// joined to users u, in scanMoves order.
const moveColumns = `m.id, u.username, u.display_name, u.avatar, m.lines, m.first_letter, m.last_letter,
	m.poem_key, m.href, m.poet_name, m.poem_title, m.created_at, m.norm = '' AS removed`

// scanMoves reads and closes rows selected with moveColumns.
func scanMoves(rows *sql.Rows, err error) ([]Move, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	moves := []Move{}
	for rows.Next() {
		var m Move
		var lines string
		if err := rows.Scan(&m.ID, &m.Username, &m.DisplayName, &m.Avatar, &lines, &m.FirstLetter, &m.LastLetter,
			&m.Key, &m.Href, &m.PoetName, &m.PoemTitle, &m.CreatedAt, &m.Removed); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(lines), &m.Lines); err != nil {
			return nil, err
		}
		if m.Lines == nil {
			m.Lines = []string{}
		}
		moves = append(moves, m)
	}
	return moves, rows.Err()
}

// --- verse input ---------------------------------------------------------------

// verseRequest is the body of both move endpoints: typed lines, or a poem
// range to pick. Expect is only read by the public room.
type verseRequest struct {
	Lines  []string `json:"lines"`
	Key    string   `json:"key"`
	From   *int     `json:"from"`
	To     *int     `json:"to"`
	Expect *int64   `json:"expect"`
}

func (v verseRequest) picked() bool { return v.Key != "" }

// verse is a checked move, ready to store.
type verse struct {
	lines                          []string
	norm, first, last              string
	poemKey, href, poet, poemTitle string
}

func (v verse) newMove(id int64, user User, createdAt int64) Move {
	return Move{
		ID: id, Username: user.Username, DisplayName: user.DisplayName, Avatar: user.Avatar,
		Lines: v.lines, FirstLetter: v.first, LastLetter: v.last,
		Key: v.poemKey, Href: v.href, PoetName: v.poet, PoemTitle: v.poemTitle, CreatedAt: createdAt,
	}
}

// checkVerseLines cleans typed or picked lines and applies the size rules,
// returning a user-facing message when they do not hold.
func checkVerseLines(raw []string) ([]string, string) {
	lines := make([]string, 0, len(raw))
	for _, line := range raw {
		// A pasted line break must not glue two words together.
		line = cleanText(strings.Join(strings.Fields(line), " "), maxVerseLine+1)
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 || len(lines) > maxVerseLines {
		return nil, badLineCountMessage
	}
	for _, line := range lines {
		if n := utf8.RuneCountInString(line); n < minVerseLine || n > maxVerseLine {
			return nil, badLineLengthMessage
		}
	}
	if utf8.RuneCountInString(normalizeVerse(lines)) < minVerseLetters {
		return nil, shortVerseMessage
	}
	return lines, ""
}

func newVerse(lines []string) verse {
	return verse{lines: lines, norm: normalizeVerse(lines), first: firstLetter(lines), last: lastLetter(lines)}
}

// readVerse turns a request into a checked verse, or answers the error itself
// and reports false. Picked verses are refused when allowPicked is false.
func (s *server) readVerse(w http.ResponseWriter, r *http.Request, in verseRequest, allowPicked bool) (verse, bool) {
	if in.picked() {
		if len(in.Lines) > 0 || in.From == nil || in.To == nil {
			writeError(w, http.StatusBadRequest, badRequestMessage)
			return verse{}, false
		}
		if !allowPicked {
			writeError(w, http.StatusBadRequest, assistOffMessage)
			return verse{}, false
		}
		return s.pickVerse(w, r, in)
	}
	lines, message := checkVerseLines(in.Lines)
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return verse{}, false
	}
	return newVerse(lines), true
}

func (s *server) pickVerse(w http.ResponseWriter, r *http.Request, in verseRequest) (verse, bool) {
	if *in.To-*in.From > 1 {
		writeError(w, http.StatusBadRequest, badLineCountMessage)
		return verse{}, false
	}
	poem, err := s.poems.PoemText(r.Context(), in.Key)
	if errors.Is(err, errPoemNotFound) {
		writeError(w, http.StatusNotFound, poemNotFoundMessage)
		return verse{}, false
	}
	if err != nil {
		log.Printf("accounts: poem %s: %v", in.Key, err)
		writeError(w, http.StatusBadGateway, poemSourceMessage)
		return verse{}, false
	}
	cut, ok := poemLines(poem, *in.From, *in.To, maxVerseLines)
	if !ok {
		writeError(w, http.StatusBadRequest, badRangeMessage)
		return verse{}, false
	}
	lines, message := checkVerseLines(cut)
	if message != "" {
		writeError(w, http.StatusBadRequest, message)
		return verse{}, false
	}
	v := newVerse(lines)
	v.poemKey, v.href, v.poet, v.poemTitle = in.Key, poem.Href, poem.PoetName, poem.Title
	return v, true
}
