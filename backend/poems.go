package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The service keeps no poem corpus. Quote and moshaere text is cut from the
// real poem, fetched from the Next app's /api/poem-lines, so a client can never
// put words in a poet's mouth.

var (
	poemKeyPattern  = regexp.MustCompile(`^(ganjoor|custom|echolalia):[\p{L}\p{N}_.\-]+:[0-9]+$`)
	errPoemNotFound = errors.New("poem not found")
)

// PoemText is one poem as the reader sees it: Lines are its non-empty lines,
// in the order and with the indices the poem viewer renders.
type PoemText struct {
	Key      string   `json:"key"`
	Source   string   `json:"source"`
	PoetSlug string   `json:"poetSlug"`
	PoetName string   `json:"poetName"`
	Title    string   `json:"title"`
	Href     string   `json:"href"`
	Lines    []string `json:"lines"`
}

type PoemSource interface {
	// PoemText returns errPoemNotFound for unknown poems and malformed keys.
	PoemText(ctx context.Context, key string) (PoemText, error)
}

const (
	poemCacheSize = 500
	poemCacheTTL  = time.Hour
)

// httpPoemSource reads poems from the Next app (POEMS_API_URL).
type httpPoemSource struct {
	base   string
	client *http.Client

	mu    sync.Mutex
	cache map[string]cachedPoem
}

type cachedPoem struct {
	poem    PoemText
	expires time.Time
}

func newHTTPPoemSource(base string) *httpPoemSource {
	return &httpPoemSource{
		base:   strings.TrimRight(base, "/"),
		client: &http.Client{Timeout: 5 * time.Second},
		cache:  map[string]cachedPoem{},
	}
}

func (p *httpPoemSource) PoemText(ctx context.Context, key string) (PoemText, error) {
	if !poemKeyPattern.MatchString(key) {
		return PoemText{}, errPoemNotFound
	}
	now := time.Now()
	p.mu.Lock()
	if hit, ok := p.cache[key]; ok && now.Before(hit.expires) {
		p.mu.Unlock()
		return hit.poem, nil
	}
	p.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+"/api/poem-lines?key="+url.QueryEscape(key), nil)
	if err != nil {
		return PoemText{}, err
	}
	res, err := p.client.Do(req)
	if err != nil {
		return PoemText{}, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusBadRequest {
		return PoemText{}, errPoemNotFound
	}
	if res.StatusCode != http.StatusOK {
		return PoemText{}, fmt.Errorf("poem-lines %s: status %d", key, res.StatusCode)
	}
	var poem PoemText
	if err := json.NewDecoder(res.Body).Decode(&poem); err != nil {
		return PoemText{}, err
	}
	if len(poem.Lines) == 0 || !safeHref(poem.Href) {
		return PoemText{}, errPoemNotFound
	}
	poem.Key = key

	p.mu.Lock()
	if len(p.cache) >= poemCacheSize {
		// shortcut: drop everything instead of tracking recency; refills are cheap.
		p.cache = map[string]cachedPoem{}
	}
	p.cache[key] = cachedPoem{poem: poem, expires: now.Add(poemCacheTTL)}
	p.mu.Unlock()
	return poem, nil
}

// poemLines cuts lines [from, to] (inclusive) out of a poem, or reports false
// when the range is outside it or longer than maxLines.
func poemLines(poem PoemText, from, to, maxLines int) ([]string, bool) {
	if from < 0 || to < from || to-from >= maxLines || to >= len(poem.Lines) {
		return nil, false
	}
	return append([]string(nil), poem.Lines[from:to+1]...), true
}
