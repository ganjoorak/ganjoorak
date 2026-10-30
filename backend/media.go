package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Uploaded avatar and banner images (docs/social-api-contract.md §3.1). An
// upload is stored as a re-encoded JPEG under the media directory and the
// user's avatar/banner field holds "img:<id>".

const (
	mediaRefPrefix = "img:"
	mediaQuality   = 85
	// Uploads per user per hour, avatar and banner together.
	uploadsPerHour = 20
)

const (
	badImageTypeMessage  = "فقط تصویر JPEG یا PNG."
	imageTooSmallMessage = "تصویر خیلی کوچک است."
	imageTooBigMessage   = "تصویر خیلی بزرگ است."
	imageUnreadMessage   = "این تصویر خوانده نشد."
)

var (
	mediaIDPattern   = regexp.MustCompile(`^[0-9a-f]{32}$`)
	mediaNamePattern = regexp.MustCompile(`^[0-9a-f]{32}\.jpg$`)
)

// mediaKind describes one uploadable field: its column, limits and output shape.
type mediaKind struct {
	column         string
	maxBytes       int64
	minW, minH     int // pixels before processing
	maxW, maxH     int
	ratioW, ratioH int // crop aspect
	outW, outH     int
	field          func(*User) *string
}

var (
	avatarKind = mediaKind{
		column: "avatar", maxBytes: 2 << 20,
		minW: 128, minH: 128, maxW: 4096, maxH: 4096,
		ratioW: 1, ratioH: 1, outW: 512, outH: 512,
		field: func(u *User) *string { return &u.Avatar },
	}
	bannerKind = mediaKind{
		column: "banner", maxBytes: 4 << 20,
		minW: 600, minH: 200, maxW: 6000, maxH: 6000,
		ratioW: 3, ratioH: 1, outW: 1500, outH: 500,
		field: func(u *User) *string { return &u.Banner },
	}
)

// mediaRef returns the "img:<id>" form of an id.
func mediaRef(id string) string { return mediaRefPrefix + id }

// isMediaRef reports whether value is a well-formed "img:<32 hex>" reference.
func isMediaRef(value string) bool {
	id, ok := strings.CutPrefix(value, mediaRefPrefix)
	return ok && mediaIDPattern.MatchString(id)
}

// keepsUpload reports whether value is the user's own stored upload, the only
// img: value a profile or appearance update may send back.
func keepsUpload(value, current string) bool {
	return value == current && isMediaRef(value)
}

// mediaPath is the only place a file path is built, from a validated id.
func (s *server) mediaPath(id string) string {
	return filepath.Join(s.mediaDir, id+".jpg")
}

// removeUpload deletes the file behind an img: reference; other values are ignored.
func (s *server) removeUpload(ref string) {
	if !isMediaRef(ref) {
		return
	}
	err := os.Remove(s.mediaPath(strings.TrimPrefix(ref, mediaRefPrefix)))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("accounts: remove upload: %v", err)
	}
}

// saveUpload writes the JPEG atomically (temp file in the same directory, then
// rename) and returns its new id.
func (s *server) saveUpload(data []byte) (string, error) {
	if err := os.MkdirAll(s.mediaDir, 0o700); err != nil {
		return "", err
	}
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(raw[:])
	tmp, err := os.CreateTemp(s.mediaDir, ".upload-*")
	if err != nil {
		return "", err
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	if err := os.Rename(tmp.Name(), s.mediaPath(id)); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return id, nil
}

// handleUpload serves POST /uploads/avatar and /uploads/banner.
func (s *server) handleUpload(kind mediaKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(w, r)
		if !ok {
			return
		}
		if !s.uploadLimiter.allow(strconv.FormatInt(user.ID, 10)) {
			writeError(w, http.StatusTooManyRequests, tooManyMessage)
			return
		}
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaType != "image/jpeg" && mediaType != "image/png" {
			writeError(w, http.StatusBadRequest, badImageTypeMessage)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, kind.maxBytes))
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, imageTooBigMessage)
			return
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, imageUnreadMessage)
			return
		}
		jpegData, problem := s.processImage(r, kind, body)
		if problem != "" {
			writeError(w, http.StatusBadRequest, problem)
			return
		}
		id, err := s.saveUpload(jpegData)
		if err != nil {
			internalError(w, err)
			return
		}
		old := kind.field(&user)
		previous := *old
		*old = mediaRef(id)
		if err := s.setMediaField(r, kind, user.ID, *old); err != nil {
			s.removeUpload(*old)
			internalError(w, err)
			return
		}
		s.removeUpload(previous)
		writeJSON(w, http.StatusCreated, map[string]any{"user": user})
	}
}

// handleDeleteUpload serves DELETE /uploads/avatar and /uploads/banner.
func (s *server) handleDeleteUpload(kind mediaKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.currentUser(w, r)
		if !ok {
			return
		}
		field := kind.field(&user)
		previous := *field
		*field = ""
		if err := s.setMediaField(r, kind, user.ID, ""); err != nil {
			internalError(w, err)
			return
		}
		s.removeUpload(previous)
		writeJSON(w, http.StatusOK, map[string]any{"user": user})
	}
}

// setMediaField writes the column of a mediaKind; the column name comes from
// the kind, never from the request.
func (s *server) setMediaField(r *http.Request, kind mediaKind, userID int64, value string) error {
	_, err := s.store.db.ExecContext(r.Context(),
		`UPDATE users SET `+kind.column+` = ? WHERE id = ?`, value, userID)
	return err
}

// handleMedia serves GET /media/{name}. The name is matched against a strict
// pattern before it gets near the file system.
func (s *server) handleMedia(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !mediaNamePattern.MatchString(name) {
		writeError(w, http.StatusNotFound, "تصویر پیدا نشد.")
		return
	}
	file, err := os.Open(filepath.Join(s.mediaDir, name))
	if err != nil {
		writeError(w, http.StatusNotFound, "تصویر پیدا نشد.")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		writeError(w, http.StatusNotFound, "تصویر پیدا نشد.")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

// --- image processing ----------------------------------------------------------

// processImage validates, crops, scales and re-encodes an upload. The second
// result is a ready-to-show problem, empty on success. The header is checked
// before the full decode so a small file claiming huge dimensions (a
// decompression bomb) never gets allocated.
func (s *server) processImage(r *http.Request, kind mediaKind, body []byte) ([]byte, string) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || (format != "jpeg" && format != "png") {
		return nil, imageUnreadMessage
	}
	switch {
	case cfg.Width < kind.minW || cfg.Height < kind.minH:
		return nil, imageTooSmallMessage
	case cfg.Width > kind.maxW || cfg.Height > kind.maxH:
		return nil, imageTooBigMessage
	}
	// Decoding is memory-hungry; only a couple run at once.
	select {
	case s.imageSlots <- struct{}{}:
		defer func() { <-s.imageSlots }()
	case <-r.Context().Done():
		return nil, imageUnreadMessage
	}
	src, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, imageUnreadMessage
	}
	out := resizeImage(cropToRatio(src, kind.ratioW, kind.ratioH), kind.outW, kind.outH)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: mediaQuality}); err != nil {
		return nil, imageUnreadMessage
	}
	return buf.Bytes(), ""
}

// cropToRatio returns the centered ratioW:ratioH region of src as an opaque
// image; transparency is flattened onto white.
func cropToRatio(src image.Image, ratioW, ratioH int) *image.RGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	cw, ch := w, w*ratioH/ratioW
	if ch > h {
		cw, ch = h*ratioW/ratioH, h
	}
	x0, y0 := b.Min.X+(w-cw)/2, b.Min.Y+(h-ch)/2
	flat := image.NewRGBA(image.Rect(0, 0, cw, ch))
	draw.Draw(flat, flat.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), src, image.Pt(x0, y0), draw.Over)
	return flat
}

// weights are the source taps (a run starting at first) of one output pixel.
type weights struct {
	first int
	w     []float32
}

// axisWeights maps srcN samples onto dstN: area averaging when shrinking
// (every source pixel counts in proportion to its overlap), bilinear when
// enlarging.
func axisWeights(srcN, dstN int) []weights {
	out := make([]weights, dstN)
	scale := float64(srcN) / float64(dstN)
	for i := range out {
		if scale <= 1 {
			pos := (float64(i)+0.5)*scale - 0.5
			if pos < 0 {
				pos = 0
			}
			i0 := int(pos)
			if i0 >= srcN-1 {
				out[i] = weights{first: srcN - 1, w: []float32{1}}
				continue
			}
			frac := float32(pos - float64(i0))
			out[i] = weights{first: i0, w: []float32{1 - frac, frac}}
			continue
		}
		lo, hi := float64(i)*scale, float64(i+1)*scale
		first, last := int(lo), min(int(hi), srcN-1)
		ws := make([]float32, 0, last-first+1)
		var sum float32
		for j := first; j <= last; j++ {
			overlap := float32(min(hi, float64(j+1)) - max(lo, float64(j)))
			if overlap < 0 {
				overlap = 0
			}
			ws = append(ws, overlap)
			sum += overlap
		}
		for k := range ws {
			ws[k] /= sum
		}
		out[i] = weights{first: first, w: ws}
	}
	return out
}

// resizeImage scales an opaque image to w×h with a separable filter:
// horizontal pass into float samples, then the vertical pass.
func resizeImage(src *image.RGBA, w, h int) *image.RGBA {
	sw, sh := src.Bounds().Dx(), src.Bounds().Dy()
	xs, ys := axisWeights(sw, w), axisWeights(sh, h)

	mid := make([]float32, sh*w*3)
	for y := 0; y < sh; y++ {
		row := src.Pix[y*src.Stride:]
		for x, wt := range xs {
			var r, g, b float32
			for k, f := range wt.w {
				p := row[(wt.first+k)*4:]
				r += f * float32(p[0])
				g += f * float32(p[1])
				b += f * float32(p[2])
			}
			o := (y*w + x) * 3
			mid[o], mid[o+1], mid[o+2] = r, g, b
		}
	}

	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y, wt := range ys {
		for x := 0; x < w; x++ {
			var r, g, b float32
			for k, f := range wt.w {
				o := ((wt.first+k)*w + x) * 3
				r += f * mid[o]
				g += f * mid[o+1]
				b += f * mid[o+2]
			}
			p := dst.Pix[y*dst.Stride+x*4:]
			p[0], p[1], p[2], p[3] = round8(r), round8(g), round8(b), 255
		}
	}
	return dst
}

func round8(v float32) uint8 {
	switch {
	case v <= 0:
		return 0
	case v >= 255:
		return 255
	}
	return uint8(v + 0.5)
}
