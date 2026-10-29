package main

import (
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Profile appearance: bio, banner, accent and background colour.

const (
	maxBioLen         = 160
	minAccentContrast = 3.0
)

var (
	hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	bioNewlines     = strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ")
)

const (
	badBannerMessage   = "بنر انتخاب‌شده معتبر نیست."
	badColorMessage    = "رنگ باید به شکل #rrggbb باشد."
	lowContrastMessage = "رنگ تأکید روی این پس‌زمینه دیده نمی‌شود؛ رنگ دیگری انتخاب کنید."
)

// Banner is a profile header image; images are static files of the web app.
type Banner struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Image string `json:"image"`
}

var bannerKeys = []struct{ key, title string }{
	{"dawn", "سپیده‌دم"},
	{"dusk", "غروب"},
	{"night", "شب"},
	{"garden", "باغ"},
	{"desert", "کویر"},
	{"sea", "دریا"},
	{"tile", "کاشی"},
	{"paper", "کاغذ"},
}

func bannerCatalog() []Banner {
	banners := make([]Banner, len(bannerKeys))
	for i, b := range bannerKeys {
		banners[i] = Banner{Key: b.key, Title: b.title, Image: "/banners/" + b.key + ".svg"}
	}
	return banners
}

func validBanner(key string) bool {
	if key == "" {
		return true
	}
	for _, b := range bannerKeys {
		if b.key == key {
			return true
		}
	}
	return false
}

type AppearanceInput struct {
	Bio        string `json:"bio"`
	Banner     string `json:"banner"`
	Accent     string `json:"accent"`
	Background string `json:"background"`
}

// validateAppearance cleans the input; the error text is ready to show.
func validateAppearance(in AppearanceInput) (AppearanceInput, string) {
	in.Bio = cleanText(bioNewlines.Replace(in.Bio), maxBioLen)
	if !validBanner(in.Banner) {
		return in, badBannerMessage
	}
	for _, c := range []*string{&in.Accent, &in.Background} {
		if *c == "" {
			continue
		}
		if !hexColorPattern.MatchString(*c) {
			return in, badColorMessage
		}
		*c = strings.ToLower(*c)
	}
	if in.Accent != "" && in.Background != "" && contrastRatio(in.Accent, in.Background) < minAccentContrast {
		return in, lowContrastMessage
	}
	return in, ""
}

// contrastRatio is the WCAG contrast ratio (1 to 21) of two #rrggbb colours;
// 0 when either is malformed.
func contrastRatio(a, b string) float64 {
	la, ok := relativeLuminance(a)
	lb, ok2 := relativeLuminance(b)
	if !ok || !ok2 {
		return 0
	}
	if la < lb {
		la, lb = lb, la
	}
	return (la + 0.05) / (lb + 0.05)
}

func relativeLuminance(hex string) (float64, bool) {
	if !hexColorPattern.MatchString(hex) {
		return 0, false
	}
	var lum float64
	for i, weight := range []float64{0.2126, 0.7152, 0.0722} {
		v, err := strconv.ParseUint(hex[1+2*i:3+2*i], 16, 8)
		if err != nil {
			return 0, false
		}
		c := float64(v) / 255
		if c <= 0.03928 {
			c /= 12.92
		} else {
			c = math.Pow((c+0.055)/1.055, 2.4)
		}
		lum += weight * c
	}
	return lum, true
}

func (s *server) handleAppearance(w http.ResponseWriter, r *http.Request) {
	user, ok := s.currentUser(w, r)
	if !ok {
		return
	}
	var in AppearanceInput
	if !decodeJSON(w, r, &in) {
		return
	}
	in, problem := validateAppearance(in)
	if problem != "" {
		writeError(w, http.StatusBadRequest, problem)
		return
	}
	if _, err := s.store.db.ExecContext(r.Context(),
		`UPDATE users SET bio = ?, banner = ?, accent = ?, background = ? WHERE id = ?`,
		in.Bio, in.Banner, in.Accent, in.Background, user.ID); err != nil {
		internalError(w, err)
		return
	}
	user.Bio, user.Banner, user.Accent, user.Background = in.Bio, in.Banner, in.Accent, in.Background
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}
