package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Pure account logic (no HTTP, no database) so account_test.go covers it directly.

// Same caps as src/utils/poemLibrary.ts so the server and devices agree.
const (
	maxFavorites    = 200
	maxCollections  = 100
	maxHistory      = 30
	maxPreferred    = 500
	maxFollowing    = 1000
	maxFollowList   = 1000
	maxInterests    = 50
	maxDisplayName  = 50
	minPasswordLen  = 8
	maxPasswordLen  = 128
	sessionTokenLen = 32
)

var (
	usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,32}$`)
	poetKeyPattern  = regexp.MustCompile(`^[a-z]+:[\p{L}\p{N}_.\-]+$`)
	interestPattern = regexp.MustCompile(`^[a-z]{1,32}$`)
	validSources    = map[string]bool{"ganjoor": true, "custom": true, "echolalia": true}
)

type Entry struct {
	Key      string `json:"key"`
	ID       int64  `json:"id"`
	Source   string `json:"source"`
	PoetSlug string `json:"poetSlug"`
	PoetName string `json:"poetName"`
	Title    string `json:"title"`
	Excerpt  string `json:"excerpt"`
	Href     string `json:"href"`
	SavedAt  int64  `json:"savedAt"`
}

// CollectionEntry is a loved book of a poet. Ganjoor books are categories
// (CategoryID); local ones have no id and are told apart by poet and title.
type CollectionEntry struct {
	Key        string `json:"key"`
	Source     string `json:"source"`
	CategoryID int64  `json:"categoryId"`
	PoetSlug   string `json:"poetSlug"`
	PoetName   string `json:"poetName"`
	Title      string `json:"title"`
	Href       string `json:"href"`
	SavedAt    int64  `json:"savedAt"`
}

type AccountData struct {
	Favorites []Entry `json:"favorites"`
	History   []Entry `json:"history"`
	// Poet collections ("books") the reader loves. They show on the public
	// profile and feed the reader's personal feed.
	LovedCollections []CollectionEntry `json:"lovedCollections"`
	// Poets the reader prefers, as "source:slug". Only shapes their own feed;
	// nobody is notified, so it is not a follow (see follows in store.go).
	PreferredPoetKeys []string `json:"preferredPoetKeys"`
	InterestKeys      []string `json:"interestKeys"`
}

// UnmarshalJSON still reads followedPoetKeys, the name this list had while
// poets could be "followed": stored rows and older clients use it.
func (d *AccountData) UnmarshalJSON(raw []byte) error {
	type plain AccountData
	var in struct {
		plain
		FollowedPoetKeys []string `json:"followedPoetKeys"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return err
	}
	*d = AccountData(in.plain)
	d.PreferredPoetKeys = append(d.PreferredPoetKeys, in.FollowedPoetKeys...)
	return nil
}

type SignupInput struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

// ProfileInput is what the owner can edit in account settings.
type ProfileInput struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

// Profile picture motifs, matching src/components/ProfileAvatar.tsx; "" means
// one picked from the username.
var validAvatars = map[string]bool{"": true, "cypress": true, "candle": true, "quill": true, "tulip": true, "cup": true}

var (
	errBadUsername = errors.New("نام کاربری باید ۳ تا ۳۲ نویسهٔ لاتین کوچک، رقم یا _ باشد.")
	errBadPassword = fmt.Errorf("گذرواژه باید %d تا %d نویسه باشد.", minPasswordLen, maxPasswordLen)
	errBadAvatar   = errors.New("تصویر نمایه معتبر نیست.")
)

func normalizeUsername(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// validateSignup returns the cleaned input or a Persian, user-facing error.
func validateSignup(in SignupInput) (SignupInput, error) {
	username := normalizeUsername(in.Username)
	if !usernamePattern.MatchString(username) {
		return in, errBadUsername
	}
	if !validPassword(in.Password) {
		return in, errBadPassword
	}
	displayName := cleanText(in.DisplayName, maxDisplayName)
	if displayName == "" {
		displayName = username
	}
	return SignupInput{Username: username, Password: in.Password, DisplayName: displayName}, nil
}

func validPassword(password string) bool {
	n := utf8.RuneCountInString(password)
	return n >= minPasswordLen && n <= maxPasswordLen
}

// validateProfile returns the cleaned input or a Persian, user-facing error.
func validateProfile(in ProfileInput) (ProfileInput, error) {
	username := normalizeUsername(in.Username)
	if !usernamePattern.MatchString(username) {
		return in, errBadUsername
	}
	if !validAvatars[in.Avatar] {
		return in, errBadAvatar
	}
	displayName := cleanText(in.DisplayName, maxDisplayName)
	if displayName == "" {
		displayName = username
	}
	return ProfileInput{Username: username, DisplayName: displayName, Avatar: in.Avatar}, nil
}

// FeedbackInput is one message from the in-app feedback form.
type FeedbackInput struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Contact string `json:"contact"`
	Page    string `json:"page"`
}

const (
	minFeedbackMessage = 3
	maxFeedbackMessage = 4000
	maxFeedbackContact = 200
	maxFeedbackPage    = 300
)

var (
	feedbackKinds      = map[string]bool{"suggestion": true, "bug": true, "other": true}
	errBadFeedbackKind = errors.New("نوع بازخورد معتبر نیست.")
	errBadFeedbackText = fmt.Errorf("متن بازخورد باید %d تا %d نویسه باشد.", minFeedbackMessage, maxFeedbackMessage)
)

// validateFeedback returns the cleaned input or a Persian, user-facing error.
// Newlines survive in the message; the other fields are single-line.
func validateFeedback(in FeedbackInput) (FeedbackInput, error) {
	if !feedbackKinds[in.Kind] {
		return in, errBadFeedbackKind
	}
	message := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r != '\n' && unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ReplaceAll(in.Message, "\r\n", "\n")))
	if n := utf8.RuneCountInString(message); n < minFeedbackMessage || n > maxFeedbackMessage {
		return in, errBadFeedbackText
	}
	return FeedbackInput{
		Kind:    in.Kind,
		Message: message,
		Contact: cleanText(in.Contact, maxFeedbackContact),
		Page:    cleanText(in.Page, maxFeedbackPage),
	}, nil
}

func cleanText(value string, max int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > max {
		value = string([]rune(value)[:max])
	}
	return value
}

// --- passwords ---------------------------------------------------------------

// OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane.
const (
	argonTime    = 2
	argonMemory  = 19 * 1024
	argonThreads = 1
	argonKeyLen  = 32
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false
	}
	// Refuse absurd parameters so a corrupted row cannot pin the CPU or memory.
	if memory == 0 || memory > 256*1024 || time == 0 || time > 10 || threads == 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Unknown usernames are checked against this hash so a failed login costs the
// same either way and timing does not reveal which accounts exist.
var dummyHash = sync.OnceValue(func() string {
	hash, err := hashPassword("ganjoorak-dummy-password")
	if err != nil {
		panic(err)
	}
	return hash
})

// --- recovery codes ----------------------------------------------------------

// A recovery code stands in for "forgot password" without email: shown once at
// sign-up (or when regenerated), stored only as an argon2id hash like the
// password, and consumed by a reset, which issues a new one.
const recoveryCodeLen = 16

// Crockford base32: no I, L, O or U, so a hand-copied code is hard to misread.
// 32 divides 256, so mapping random bytes onto it stays uniform (80 bits).
const recoveryAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func newRecoveryCode() (string, error) {
	buf := make([]byte, recoveryCodeLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	var b strings.Builder
	for i, v := range buf {
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(recoveryAlphabet[int(v)%len(recoveryAlphabet)])
	}
	return b.String(), nil
}

// normalizeRecoveryCode forgives case, spaces, dashes and Crockford look-alikes.
func normalizeRecoveryCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(code) {
		switch r {
		case '-', ' ', '\t':
		case 'O':
			b.WriteByte('0')
		case 'I', 'L':
			b.WriteByte('1')
		default:
			if r < unicode.MaxASCII {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func hashRecoveryCode(code string) (string, error) {
	return hashPassword(normalizeRecoveryCode(code))
}

func verifyRecoveryCode(code, encoded string) bool {
	normalized := normalizeRecoveryCode(code)
	if len(normalized) != recoveryCodeLen {
		normalized = ""
	}
	return verifyPassword(normalized, encoded)
}

// --- sessions ----------------------------------------------------------------

func newSessionToken() (string, error) {
	buf := make([]byte, sessionTokenLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// Only the hash is stored, so a leaked database cannot be replayed as cookies.
func hashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// --- synced data -------------------------------------------------------------

// Hrefs are rendered as links on the profile page: same-origin paths only.
func safeHref(href string) bool {
	return len(href) >= 2 && len(href) <= 300 && href[0] == '/' && href[1] != '/' && href[1] != '\\'
}

func sanitizeEntry(e Entry) (Entry, bool) {
	if !safeHref(e.Href) {
		return e, false
	}
	key := cleanText(e.Key, 200)
	if key == "" || e.ID <= 0 || e.SavedAt <= 0 {
		return e, false
	}
	source := e.Source
	if !validSources[source] {
		source = "ganjoor"
	}
	return Entry{
		Key:      key,
		ID:       e.ID,
		Source:   source,
		PoetSlug: cleanText(e.PoetSlug, 100),
		PoetName: cleanText(e.PoetName, 100),
		Title:    cleanText(e.Title, 200),
		Excerpt:  cleanText(e.Excerpt, 300),
		Href:     e.Href,
		SavedAt:  e.SavedAt,
	}, true
}

// sanitizeEntries keeps the newest copy of each key, newest first, capped.
func sanitizeEntries(entries []Entry, max int) []Entry {
	clean := make([]Entry, 0, len(entries))
	for _, raw := range entries {
		if entry, ok := sanitizeEntry(raw); ok {
			clean = append(clean, entry)
		}
	}
	sort.SliceStable(clean, func(i, j int) bool { return clean[i].SavedAt > clean[j].SavedAt })
	seen := make(map[string]bool, len(clean))
	out := make([]Entry, 0, len(clean))
	for _, entry := range clean {
		if seen[entry.Key] || len(out) == max {
			continue
		}
		seen[entry.Key] = true
		out = append(out, entry)
	}
	return out
}

func sanitizeCollection(c CollectionEntry) (CollectionEntry, bool) {
	key := cleanText(c.Key, 200)
	title := cleanText(c.Title, 200)
	if !safeHref(c.Href) || key == "" || title == "" || c.SavedAt <= 0 {
		return c, false
	}
	source := c.Source
	if source != "custom" {
		// A Ganjoor book is only usable with its category id.
		source = "ganjoor"
		if c.CategoryID <= 0 {
			return c, false
		}
	} else {
		c.CategoryID = 0
	}
	return CollectionEntry{
		Key:        key,
		Source:     source,
		CategoryID: c.CategoryID,
		PoetSlug:   cleanText(c.PoetSlug, 100),
		PoetName:   cleanText(c.PoetName, 100),
		Title:      title,
		Href:       c.Href,
		SavedAt:    c.SavedAt,
	}, true
}

// sanitizeCollections keeps the newest copy of each key, newest first, capped.
func sanitizeCollections(items []CollectionEntry, max int) []CollectionEntry {
	clean := make([]CollectionEntry, 0, len(items))
	for _, raw := range items {
		if item, ok := sanitizeCollection(raw); ok {
			clean = append(clean, item)
		}
	}
	sort.SliceStable(clean, func(i, j int) bool { return clean[i].SavedAt > clean[j].SavedAt })
	seen := make(map[string]bool, len(clean))
	out := make([]CollectionEntry, 0, len(clean))
	for _, item := range clean {
		if seen[item.Key] || len(out) == max {
			continue
		}
		seen[item.Key] = true
		out = append(out, item)
	}
	return out
}

func sanitizeKeys(keys []string, max int, pattern *regexp.Regexp) []string {
	seen := make(map[string]bool, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if len(key) > 120 || !pattern.MatchString(key) || seen[key] || len(out) == max {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	return out
}

func sanitizeAccountData(d AccountData) AccountData {
	return AccountData{
		Favorites:         sanitizeEntries(d.Favorites, maxFavorites),
		History:           sanitizeEntries(d.History, maxHistory),
		LovedCollections:  sanitizeCollections(d.LovedCollections, maxCollections),
		PreferredPoetKeys: sanitizeKeys(d.PreferredPoetKeys, maxPreferred, poetKeyPattern),
		InterestKeys:      sanitizeKeys(d.InterestKeys, maxInterests, interestPattern),
	}
}

// mergeAccountData unions both sides so a first login never drops data from
// the device or the account.
// shortcut: a removal on one device can come back from another device's union,
// upgrade to per-item tombstones if users notice.
func mergeAccountData(a, b AccountData) AccountData {
	return sanitizeAccountData(AccountData{
		Favorites:         append(append([]Entry{}, a.Favorites...), b.Favorites...),
		History:           append(append([]Entry{}, a.History...), b.History...),
		LovedCollections:  append(append([]CollectionEntry{}, a.LovedCollections...), b.LovedCollections...),
		PreferredPoetKeys: append(append([]string{}, a.PreferredPoetKeys...), b.PreferredPoetKeys...),
		InterestKeys:      append(append([]string{}, a.InterestKeys...), b.InterestKeys...),
	})
}

// --- public profile ------------------------------------------------------------

// The newest history entry counts as "now reading" while the account pushed
// a new history head within this window. The time is stamped by the server
// (Store.saveData), so a device with a wrong clock cannot fake it.
const (
	readingWindow      = 20 * time.Minute
	maxPublicFavorites = 50
	maxPublicBooks     = 50
)

// PublicProfile is everything /@username shows to anyone. It is built from an
// allow-list of fields: no preferred poets, no full history, no session data.
// The follower counts are filled in by the store, which owns the follows table.
type PublicProfile struct {
	Username      string  `json:"username"`
	DisplayName   string  `json:"displayName"`
	Avatar        string  `json:"avatar"`
	CreatedAt     int64   `json:"createdAt"`
	NowReading    *Entry  `json:"nowReading"`
	LastPoem      *Entry  `json:"lastPoem"`
	Favorites     []Entry `json:"favorites"`
	FavoriteCount int     `json:"favoriteCount"`
	// Loved books, newest first, capped like Favorites.
	LovedCollections []CollectionEntry `json:"lovedCollections"`
	FollowerCount    int               `json:"followerCount"`
	FollowingCount   int               `json:"followingCount"`
	// Appearance, set by the owner (PUT /appearance).
	Bio        string `json:"bio"`
	Banner     string `json:"banner"`
	Accent     string `json:"accent"`
	Background string `json:"background"`
	// Streak and Badges are filled in by the store (progress.go).
	Streak ProfileStreak `json:"streak"`
	Badges []Badge       `json:"badges"`
	// Newest quotes (never nil) and how many there are in all; filled in by the store (quotes.go).
	Quotes     []Quote `json:"quotes"`
	QuoteCount int     `json:"quoteCount"`
}

func buildPublicProfile(u User, d AccountData, readingAt, now int64) PublicProfile {
	p := PublicProfile{
		Username:      u.Username,
		DisplayName:   u.DisplayName,
		Avatar:        u.Avatar,
		CreatedAt:     u.CreatedAt,
		Favorites:     d.Favorites,
		FavoriteCount: len(d.Favorites),
		Bio:           u.Bio,
		Banner:        u.Banner,
		Accent:        u.Accent,
		Background:    u.Background,
		Badges:        []Badge{},
		Quotes:        []Quote{},
	}
	if len(p.Favorites) > maxPublicFavorites {
		p.Favorites = p.Favorites[:maxPublicFavorites]
	}
	if p.Favorites == nil {
		p.Favorites = []Entry{}
	}
	p.LovedCollections = d.LovedCollections
	if len(p.LovedCollections) > maxPublicBooks {
		p.LovedCollections = p.LovedCollections[:maxPublicBooks]
	}
	if p.LovedCollections == nil {
		p.LovedCollections = []CollectionEntry{}
	}
	history := d.History
	if len(history) > 0 && readingAt > 0 && now-readingAt < readingWindow.Milliseconds() {
		p.NowReading = &history[0]
		history = history[1:]
	}
	if len(history) > 0 {
		p.LastPoem = &history[0]
	}
	return p
}

// historyHeadChanged reports whether the newest history entry is a new read
// (another poem, or the same poem opened again).
func historyHeadChanged(before, after []Entry) bool {
	if len(after) == 0 {
		return false
	}
	if len(before) == 0 {
		return true
	}
	return before[0].Key != after[0].Key || after[0].SavedAt > before[0].SavedAt
}
