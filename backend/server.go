package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "ganjoorak_session"
	sessionTTL    = 30 * 24 * time.Hour
	maxBodyBytes  = 256 << 10
	// One message for every login failure so it never says which part was wrong.
	loginFailedMessage = "نام کاربری یا گذرواژه درست نیست."
)

type server struct {
	store   *Store
	limiter *rateLimiter
	// Each argon2id run holds 19 MiB; cap concurrent runs so a burst of
	// logins cannot exhaust memory.
	hashSlots chan struct{}
}

func newServer(store *Store) *server {
	return &server{
		store:     store,
		limiter:   newRateLimiter(20, 15*time.Minute),
		hashSlots: make(chan struct{}, 4),
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("POST /api/account/signup", s.handleSignup)
	mux.HandleFunc("POST /api/account/login", s.handleLogin)
	mux.HandleFunc("POST /api/account/logout", s.handleLogout)
	mux.HandleFunc("GET /api/account/me", s.handleMe)
	mux.HandleFunc("PUT /api/account/data", s.handleData)
	return mux
}

// --- handlers ------------------------------------------------------------------

func (s *server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "تلاش‌ها بیش از حد بود. کمی بعد دوباره امتحان کنید.")
		return
	}
	var in SignupInput
	if !decodeJSON(w, r, &in) {
		return
	}
	in, err := validateSignup(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := withHashSlot(s, func() (string, error) { return hashPassword(in.Password) })
	if err != nil {
		internalError(w, err)
		return
	}
	user, err := s.store.createUser(r.Context(), in, hash)
	if errors.Is(err, errUsernameTaken) {
		// shortcut: sign-up has to say a name is taken, which reveals that the
		// account exists; the rate limit above keeps bulk probing slow.
		writeError(w, http.StatusConflict, "این نام کاربری قبلاً گرفته شده است.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	if !s.startSession(w, r, user) {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "تلاش‌ها بیش از حد بود. کمی بعد دوباره امتحان کنید.")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	username := normalizeUsername(in.Username)
	user, hash, err := s.store.userForLogin(r.Context(), username)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		internalError(w, err)
		return
	}
	known := err == nil
	if !known {
		hash = dummyHash()
	}
	password := in.Password
	if len(password) > maxPasswordLen*4 {
		password = ""
	}
	ok, _ := withHashSlot(s, func() (bool, error) { return verifyPassword(password, hash), nil })
	if !known || !ok {
		writeError(w, http.StatusUnauthorized, loginFailedMessage)
		return
	}
	if !s.startSession(w, r, user) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		if err := s.store.deleteSession(r.Context(), hashSessionToken(cookie.Value)); err != nil {
			internalError(w, err)
			return
		}
	}
	setSessionCookie(w, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	data, err := s.store.loadData(r.Context(), user.ID)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "data": data})
}

func (s *server) handleData(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var in struct {
		Data  AccountData `json:"data"`
		Merge bool        `json:"merge"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	data, err := s.store.saveData(r.Context(), user.ID, in.Data, in.Merge)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

// --- sessions ------------------------------------------------------------------

func (s *server) startSession(w http.ResponseWriter, r *http.Request, user User) bool {
	token, err := newSessionToken()
	if err == nil {
		err = s.store.createSession(r.Context(), user.ID, hashSessionToken(token), time.Now().Add(sessionTTL))
	}
	if err != nil {
		internalError(w, err)
		return false
	}
	setSessionCookie(w, token, int(sessionTTL.Seconds()))
	return true
}

func (s *server) currentUser(w http.ResponseWriter, r *http.Request) (User, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "وارد حساب نشده‌اید.")
		return User{}, false
	}
	user, err := s.store.userForSession(r.Context(), hashSessionToken(cookie.Value))
	if errors.Is(err, sql.ErrNoRows) {
		setSessionCookie(w, "", -1)
		writeError(w, http.StatusUnauthorized, "وارد حساب نشده‌اید.")
		return User{}, false
	}
	if err != nil {
		internalError(w, err)
		return User{}, false
	}
	return user, true
}

// Browsers treat http://localhost as secure, so Secure stays on in development too.
func setSessionCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

func withHashSlot[T any](s *server, fn func() (T, error)) (T, error) {
	s.hashSlots <- struct{}{}
	defer func() { <-s.hashSlots }()
	return fn()
}

// --- helpers -------------------------------------------------------------------

// decodeJSON insists on a JSON content type: together with SameSite=Lax this
// stops cross-site form posts (CSRF) without a token, since browsers cannot
// send application/json cross-origin without a CORS preflight we never allow.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "درخواست نامعتبر است.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "درخواست نامعتبر است.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func internalError(w http.ResponseWriter, err error) {
	log.Printf("accounts: %v", err)
	writeError(w, http.StatusInternalServerError, "خطایی رخ داد. دوباره امتحان کنید.")
}

// clientIP uses the last X-Forwarded-For hop, the one added by the Next.js
// proxy in front of us; earlier hops are client-controlled.
// shortcut: behind another reverse proxy every user shares that proxy's IP,
// set up a trusted-hop count if the service is deployed that way.
func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		hops := strings.Split(forwarded, ",")
		return strings.TrimSpace(hops[len(hops)-1])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimiter is a fixed-window counter per IP for sign-up and login.
// shortcut: in-memory, so limits reset on restart and are per instance; move
// to the database if the service ever runs more than one replica.
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*window
}

type window struct {
	count int
	reset time.Time
}

func newRateLimiter(limit int, period time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: period, hits: map[string]*window{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if len(l.hits) > 10000 {
		for k, w := range l.hits {
			if now.After(w.reset) {
				delete(l.hits, k)
			}
		}
	}
	w, ok := l.hits[key]
	if !ok || now.After(w.reset) {
		w = &window{reset: now.Add(l.window)}
		l.hits[key] = w
	}
	w.count++
	return w.count <= l.limit
}
