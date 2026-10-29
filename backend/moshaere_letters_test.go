package main

import "testing"

func TestNormalizeVerse(t *testing.T) {
	cases := []struct {
		name  string
		lines []string
		want  string
	}{
		{"arabic yeh and kaf", []string{"كيف"}, "کیف"},
		{"alef maksura and hamza on yeh", []string{"موسى", "مسئله"}, "موسیمسیله"},
		{"alef forms", []string{"أإآٱا"}, "ااااا"},
		{"waw with hamza", []string{"مؤمن"}, "مومن"},
		{"teh marbuta", []string{"رحمة"}, "رحمه"},
		{"persian letters stay", []string{"گژپچ"}, "گژپچ"},
		{"diacritics", []string{"حَافِظٌ ٰرحمٰن"}, "حافظرحمن"},
		{"tatweel", []string{"كـــتاب"}, "کتاب"},
		{"zwnj and zwj", []string{"می‌روم", "ه‍ا"}, "میروم" + "ها"},
		{"punctuation", []string{"«سلام»، دنیا! (خوبی؟)"}, "سلامدنیاخوبی"},
		{"digits and latin", []string{"۱۲۳ abc 45 ٣ سلام"}, "سلام"},
		{"whitespace", []string{" س\tل\nا م "}, "سلام"},
		{"trailing hamza", []string{"جزء"}, "جز"},
		{"trailing hamza with diacritic", []string{"جزءٌ"}, "جز"},
		{"hamza inside a word stays", []string{"سءال"}, "سءال"},
		{"nothing left", []string{"123 ... abc"}, ""},
	}
	for _, c := range cases {
		if got := normalizeVerse(c.lines); got != c.want {
			t.Errorf("%s: normalizeVerse(%q) = %q, want %q", c.name, c.lines, got, c.want)
		}
	}
}

func TestNormalizeVerseTreatsSpellingVariantsAlike(t *testing.T) {
	a := normalizeVerse([]string{"كتاب ي دوست"})
	b := normalizeVerse([]string{"کتاب‌ِ یِ دوست!"})
	if a != b {
		t.Fatalf("variants differ: %q vs %q", a, b)
	}
}

func TestFirstAndLastLetter(t *testing.T) {
	cases := []struct {
		lines       []string
		first, last string
	}{
		{[]string{"آب", "خاکء"}, "ا", "ک"},
		{[]string{"«ألا يا ايها الساقي»"}, "ا", "ی"},
		{[]string{"۱۲ ... سلام", "!!"}, "س", "م"},
		{[]string{"پدر", "ئ"}, "پ", "ی"},
		{[]string{"شيء"}, "ش", "ی"},
		{[]string{"..."}, "", ""},
		{nil, "", ""},
	}
	for _, c := range cases {
		if got := firstLetter(c.lines); got != c.first {
			t.Errorf("firstLetter(%q) = %q, want %q", c.lines, got, c.first)
		}
		if got := lastLetter(c.lines); got != c.last {
			t.Errorf("lastLetter(%q) = %q, want %q", c.lines, got, c.last)
		}
	}
}
