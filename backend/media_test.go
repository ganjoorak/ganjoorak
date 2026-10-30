package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testImage is a w×h picture with a red left half and a blue right half, so
// crops and scaling are visible in the output.
func testImage(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.NRGBA{R: 220, A: 255}
			if x >= w/2 {
				c = color.NRGBA{B: 220, A: 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func pngBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func jpegBytes(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (a *testAPI) raw(method, path, contentType string, body []byte, cookie string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// upload posts an image and returns the response.
func (a *testAPI) upload(kind, contentType string, body []byte, cookie string) *httptest.ResponseRecorder {
	return a.raw("POST", "/api/account/uploads/"+kind, contentType, body, cookie)
}

func userFrom(t *testing.T, res *httptest.ResponseRecorder) User {
	t.Helper()
	var out struct{ User User }
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatalf("%v: %s", err, res.Body)
	}
	return out.User
}

func mediaFiles(t *testing.T, api *testAPI) []string {
	t.Helper()
	entries, err := os.ReadDir(api.server.mediaDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// uploadOK uploads and returns the new img: reference after basic checks.
func uploadOK(t *testing.T, api *testAPI, kind, contentType string, body []byte, cookie string) string {
	t.Helper()
	res := api.upload(kind, contentType, body, cookie)
	if res.Code != http.StatusCreated {
		t.Fatalf("upload %s: %d %s", kind, res.Code, res.Body)
	}
	user := userFrom(t, res)
	ref := user.Avatar
	if kind == "banner" {
		ref = user.Banner
	}
	if !isMediaRef(ref) {
		t.Fatalf("%s = %q, want img:<32 hex>", kind, ref)
	}
	if _, err := os.Stat(api.server.mediaPath(strings.TrimPrefix(ref, "img:"))); err != nil {
		t.Fatalf("file missing: %v", err)
	}
	return ref
}

func TestUploadAvatarAndServe(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	for name, upload := range map[string]struct {
		contentType string
		body        []byte
	}{
		"png":  {"image/png", pngBytes(t, testImage(300, 200))},
		"jpeg": {"image/jpeg", jpegBytes(t, testImage(200, 300))},
	} {
		ref := uploadOK(t, api, "avatar", upload.contentType, upload.body, cookie)
		res := api.do("GET", "/api/account/media/"+strings.TrimPrefix(ref, "img:")+".jpg", "", "")
		if res.Code != http.StatusOK {
			t.Fatalf("%s: GET media: %d", name, res.Code)
		}
		h := res.Header()
		if h.Get("Content-Type") != "image/jpeg" || h.Get("X-Content-Type-Options") != "nosniff" ||
			h.Get("Cache-Control") != "public, max-age=31536000, immutable" {
			t.Fatalf("%s: headers %v", name, h)
		}
		img, err := jpeg.Decode(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != 512 || b.Dy() != 512 {
			t.Fatalf("%s: size %v", name, b)
		}
		// Center-cropped, so the red/blue split stays in the middle.
		if r, _, b, _ := img.At(100, 256).RGBA(); r>>8 < 150 || b>>8 > 80 {
			t.Errorf("%s: left side not red", name)
		}
		if r, _, b, _ := img.At(412, 256).RGBA(); b>>8 < 150 || r>>8 > 80 {
			t.Errorf("%s: right side not blue", name)
		}
	}
	// HEAD is served too.
	ref := userFrom(t, api.do("GET", "/api/account/me", "", cookie)).Avatar
	if res := api.do("HEAD", "/api/account/media/"+strings.TrimPrefix(ref, "img:")+".jpg", "", ""); res.Code != http.StatusOK {
		t.Fatalf("HEAD: %d", res.Code)
	}
}

func TestUploadBanner(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	ref := uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 900)), cookie)
	res := api.do("GET", "/api/account/media/"+strings.TrimPrefix(ref, "img:")+".jpg", "", "")
	img, err := jpeg.Decode(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != 1500 || b.Dy() != 500 {
		t.Fatalf("banner size %v", b)
	}
	// The public view of the user carries the same string.
	if got := userFrom(t, api.do("GET", "/api/account/me", "", cookie)).Banner; got != ref {
		t.Fatalf("me banner = %q", got)
	}
}

func TestUploadPNGTransparencyOnWhite(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	clear := image.NewNRGBA(image.Rect(0, 0, 256, 256)) // fully transparent
	ref := uploadOK(t, api, "avatar", "image/png", pngBytes(t, clear), cookie)
	res := api.do("GET", "/api/account/media/"+strings.TrimPrefix(ref, "img:")+".jpg", "", "")
	img, err := jpeg.Decode(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if r, g, b, _ := img.At(10, 10).RGBA(); r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Fatalf("transparent pixel not white: %d %d %d", r>>8, g>>8, b>>8)
	}
}

func TestUploadRejections(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	good := pngBytes(t, testImage(200, 200))
	cases := []struct {
		name        string
		kind        string
		contentType string
		body        []byte
		status      int
		message     string
	}{
		{"wrong type", "avatar", "image/gif", good, 400, badImageTypeMessage},
		{"json type", "avatar", "application/json", good, 400, badImageTypeMessage},
		{"no type", "avatar", "", good, 400, badImageTypeMessage},
		{"too small avatar", "avatar", "image/png", pngBytes(t, testImage(100, 300)), 400, imageTooSmallMessage},
		{"too small banner", "banner", "image/png", pngBytes(t, testImage(500, 300)), 400, imageTooSmallMessage},
		{"too large avatar", "avatar", "image/png", pngBytes(t, image.NewGray(image.Rect(0, 0, 4200, 200))), 400, imageTooBigMessage},
		{"too large banner", "banner", "image/png", pngBytes(t, image.NewGray(image.Rect(0, 0, 700, 6100))), 400, imageTooBigMessage},
		{"garbage png", "avatar", "image/png", []byte("this is not an image at all"), 400, imageUnreadMessage},
		{"empty", "avatar", "image/jpeg", nil, 400, imageUnreadMessage},
		{"truncated", "avatar", "image/png", good[:len(good)/2], 400, imageUnreadMessage},
		{"oversized avatar body", "avatar", "image/png", append(append([]byte{}, good...), make([]byte, 2<<20)...), 413, imageTooBigMessage},
		{"oversized banner body", "banner", "image/jpeg", make([]byte, 4<<20+1), 413, imageTooBigMessage},
	}
	for _, c := range cases {
		res := api.upload(c.kind, c.contentType, c.body, cookie)
		var out map[string]string
		_ = json.Unmarshal(res.Body.Bytes(), &out)
		if res.Code != c.status || out["error"] != c.message {
			t.Errorf("%s: %d %q, want %d %q", c.name, res.Code, out["error"], c.status, c.message)
		}
	}
	if files := mediaFiles(t, api); len(files) != 0 {
		t.Fatalf("rejected uploads left files: %v", files)
	}
}

func TestUploadRequiresSession(t *testing.T) {
	api := newTestAPI(t, nil)
	body := pngBytes(t, testImage(200, 200))
	if res := api.upload("avatar", "image/png", body, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("upload: %d", res.Code)
	}
	if res := api.raw("DELETE", "/api/account/uploads/avatar", "", nil, ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("delete: %d", res.Code)
	}
}

func TestUploadRateLimit(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	other := api.signUp("hafez")
	body := pngBytes(t, testImage(130, 130))
	for i := 0; i < uploadsPerHour; i++ {
		if res := api.upload("avatar", "image/png", body, cookie); res.Code != http.StatusCreated {
			t.Fatalf("upload %d: %d %s", i, res.Code, res.Body)
		}
	}
	if res := api.upload("avatar", "image/png", body, cookie); res.Code != http.StatusTooManyRequests {
		t.Fatalf("21st upload: %d", res.Code)
	}
	if res := api.upload("avatar", "image/png", body, other); res.Code != http.StatusCreated {
		t.Fatalf("other user is limited too: %d", res.Code)
	}
	// Replaced uploads were cleaned up: one file per user remains.
	if files := mediaFiles(t, api); len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
}

func TestUploadReplaceDeletesOld(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	body := pngBytes(t, testImage(200, 200))
	first := uploadOK(t, api, "avatar", "image/png", body, cookie)
	banner := uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 300)), cookie)
	second := uploadOK(t, api, "avatar", "image/png", body, cookie)
	if first == second {
		t.Fatal("ids must be unique")
	}
	if _, err := os.Stat(api.server.mediaPath(strings.TrimPrefix(first, "img:"))); !os.IsNotExist(err) {
		t.Fatalf("old avatar file still there: %v", err)
	}
	// The banner is a different field and stays.
	if _, err := os.Stat(api.server.mediaPath(strings.TrimPrefix(banner, "img:"))); err != nil {
		t.Fatal(err)
	}
	if files := mediaFiles(t, api); len(files) != 2 {
		t.Fatalf("files = %v", files)
	}
}

func TestUploadOverPresetKeepsNothingBehind(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	api.do("PUT", "/api/account/profile", `{"username":"saadi","displayName":"سعدی","avatar":"tulip"}`, cookie)
	uploadOK(t, api, "avatar", "image/jpeg", jpegBytes(t, testImage(256, 256)), cookie)
	if files := mediaFiles(t, api); len(files) != 1 {
		t.Fatalf("files = %v", files)
	}
}

func TestDeleteUpload(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), cookie)
	uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 300)), cookie)

	res := api.raw("DELETE", "/api/account/uploads/avatar", "", nil, cookie)
	user := userFrom(t, res)
	if res.Code != http.StatusOK || user.Avatar != "" || !isMediaRef(user.Banner) {
		t.Fatalf("delete avatar: %d %+v", res.Code, user)
	}
	if files := mediaFiles(t, api); len(files) != 1 {
		t.Fatalf("files = %v", files)
	}
	user = userFrom(t, api.raw("DELETE", "/api/account/uploads/banner", "", nil, cookie))
	if user.Banner != "" || len(mediaFiles(t, api)) != 0 {
		t.Fatalf("banner not reset: %+v %v", user, mediaFiles(t, api))
	}
	// Deleting with nothing uploaded is fine.
	if res := api.raw("DELETE", "/api/account/uploads/avatar", "", nil, cookie); res.Code != http.StatusOK {
		t.Fatalf("repeat delete: %d", res.Code)
	}
}

func TestProfileKeepsOwnUpload(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	ref := uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), cookie)

	res := api.do("PUT", "/api/account/profile", `{"username":"saadi","displayName":"شیخ","avatar":"`+ref+`"}`, cookie)
	if user := userFrom(t, res); res.Code != http.StatusOK || user.Avatar != ref || user.DisplayName != "شیخ" {
		t.Fatalf("keep upload: %d %s", res.Code, res.Body)
	}
	if len(mediaFiles(t, api)) != 1 {
		t.Fatal("file must stay when the profile keeps it")
	}

	// Someone else's upload, and a made-up one, are refused.
	otherCookie := api.signUp("hafez")
	theirs := uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), otherCookie)
	for _, bad := range []string{theirs, "img:" + strings.Repeat("a", 32), "img:", "img:../x", "img:" + strings.ToUpper(strings.TrimPrefix(ref, "img:"))} {
		res := api.do("PUT", "/api/account/profile", `{"username":"saadi","displayName":"x","avatar":"`+bad+`"}`, cookie)
		if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), errBadAvatar.Error()) {
			t.Errorf("avatar %q: %d %s", bad, res.Code, res.Body)
		}
	}
	// A user without an upload cannot claim one either.
	third := api.signUp("rumi")
	res = api.do("PUT", "/api/account/profile", `{"username":"rumi","displayName":"x","avatar":"`+ref+`"}`, third)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("claiming another's upload: %d", res.Code)
	}
	if len(mediaFiles(t, api)) != 2 {
		t.Fatalf("rejections must not delete files: %v", mediaFiles(t, api))
	}

	// Switching to a preset (or clearing) deletes the file.
	res = api.do("PUT", "/api/account/profile", `{"username":"saadi","displayName":"شیخ","avatar":"tulip"}`, cookie)
	if user := userFrom(t, res); user.Avatar != "tulip" {
		t.Fatalf("switch: %s", res.Body)
	}
	if _, err := os.Stat(api.server.mediaPath(strings.TrimPrefix(ref, "img:"))); !os.IsNotExist(err) {
		t.Fatalf("file not deleted: %v", err)
	}
	if len(mediaFiles(t, api)) != 1 {
		t.Fatalf("other user's file must stay: %v", mediaFiles(t, api))
	}
}

func TestProfileConflictKeepsUpload(t *testing.T) {
	api := newTestAPI(t, nil)
	api.signUp("hafez")
	cookie := api.signUp("saadi")
	uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), cookie)
	// The username is taken, so nothing changes and the file must survive.
	res := api.do("PUT", "/api/account/profile", `{"username":"hafez","displayName":"x","avatar":"tulip"}`, cookie)
	if res.Code != http.StatusConflict || len(mediaFiles(t, api)) != 1 {
		t.Fatalf("%d %v", res.Code, mediaFiles(t, api))
	}
}

func TestAppearanceKeepsOwnBanner(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	ref := uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 300)), cookie)

	res := api.do("PUT", "/api/account/appearance", `{"bio":"سلام","banner":"`+ref+`","accent":"","background":""}`, cookie)
	if user := userFrom(t, res); res.Code != http.StatusOK || user.Banner != ref || user.Bio != "سلام" {
		t.Fatalf("keep banner: %d %s", res.Code, res.Body)
	}

	otherCookie := api.signUp("hafez")
	theirs := uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 300)), otherCookie)
	for _, bad := range []string{theirs, "img:" + strings.Repeat("0", 32)} {
		res := api.do("PUT", "/api/account/appearance", `{"bio":"","banner":"`+bad+`","accent":"","background":""}`, cookie)
		if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), badBannerMessage) {
			t.Errorf("banner %q: %d %s", bad, res.Code, res.Body)
		}
	}
	// An avatar upload is not a valid banner.
	avatar := uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), cookie)
	res = api.do("PUT", "/api/account/appearance", `{"bio":"","banner":"`+avatar+`","accent":"","background":""}`, cookie)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("avatar as banner: %d", res.Code)
	}

	res = api.do("PUT", "/api/account/appearance", `{"bio":"","banner":"dawn","accent":"","background":""}`, cookie)
	if user := userFrom(t, res); user.Banner != "dawn" {
		t.Fatalf("switch: %s", res.Body)
	}
	if _, err := os.Stat(api.server.mediaPath(strings.TrimPrefix(ref, "img:"))); !os.IsNotExist(err) {
		t.Fatalf("banner file not deleted: %v", err)
	}
	// Clearing to "" deletes too.
	uploadOK(t, api, "banner", "image/png", pngBytes(t, testImage(900, 300)), cookie)
	api.do("PUT", "/api/account/appearance", `{"bio":"","banner":"","accent":"","background":""}`, cookie)
	if files := mediaFiles(t, api); len(files) != 2 { // the avatar and the other user's banner
		t.Fatalf("files = %v", files)
	}
}

func TestMediaBadNames(t *testing.T) {
	api := newTestAPI(t, nil)
	cookie := api.signUp("saadi")
	ref := uploadOK(t, api, "avatar", "image/png", pngBytes(t, testImage(200, 200)), cookie)
	id := strings.TrimPrefix(ref, "img:")
	// Something outside the media directory that a traversal would reach.
	secret := filepath.Join(filepath.Dir(api.server.mediaDir), "secret.jpg")
	if err := os.WriteFile(secret, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"..%2Fsecret.jpg", "../secret.jpg", strings.ToUpper(id) + ".jpg", id + ".png", id, id + ".jpg.jpg",
		id[:31] + ".jpg", id + "0.jpg", "secret.jpg", strings.Repeat("a", 32) + ".jpg", "",
	} {
		res := api.do("GET", "/api/account/media/"+name, "", "")
		// The mux itself redirects paths with ".." to the cleaned path.
		if res.Code != http.StatusNotFound && res.Code != http.StatusMovedPermanently && res.Code != http.StatusTemporaryRedirect {
			t.Errorf("%q: %d", name, res.Code)
		}
		if res.Header().Get("Content-Type") == "image/jpeg" {
			t.Errorf("%q served an image", name)
		}
	}
	if res := api.do("GET", "/api/account/media/"+id+".jpg", "", ""); res.Code != http.StatusOK {
		t.Fatalf("valid name: %d", res.Code)
	}
}

func TestResizeImage(t *testing.T) {
	flat := func(w, h int, c color.RGBA) *image.RGBA {
		img := image.NewRGBA(image.Rect(0, 0, w, h))
		for i := 0; i < len(img.Pix); i += 4 {
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, 255
		}
		return img
	}
	c := color.RGBA{R: 10, G: 120, B: 250}
	// A flat colour stays flat through both a shrink and an enlargement.
	for _, size := range [][2]int{{1000, 700}, {70, 50}, {1, 1}} {
		out := resizeImage(flat(size[0], size[1], c), 64, 32)
		for _, p := range [][2]int{{0, 0}, {63, 31}, {20, 10}} {
			if got := out.RGBAAt(p[0], p[1]); got != (color.RGBA{R: 10, G: 120, B: 250, A: 255}) {
				t.Fatalf("%v at %v: %v", size, p, got)
			}
		}
	}
	// Averaging: alternating black/white columns shrunk by 2 give mid grey.
	stripes := image.NewRGBA(image.Rect(0, 0, 8, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 8; x++ {
			v := uint8(255 * (x % 2))
			stripes.SetRGBA(x, y, color.RGBA{v, v, v, 255})
		}
	}
	if got := resizeImage(stripes, 4, 1).RGBAAt(1, 0); got.R < 126 || got.R > 129 {
		t.Fatalf("area average = %v", got)
	}
}
