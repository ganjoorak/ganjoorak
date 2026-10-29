package main

import (
	"strings"
	"unicode"
)

// Moshaere compares verses by their letters only. The rules mirror
// src/utils/moshaereLetters.ts; change both together (contract §6 "Letters").

const (
	tatweel = 'ـ'
	hamza   = 'ء'
)

// Arabic forms that Persian writes with another letter.
var letterFolds = map[rune]rune{
	'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
	'ك': 'ک',
	'ة': 'ه',
	'ۀ': 'ه',
	'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
	'ؤ': 'و',
}

// isScriptLetter is true for letters of the Arabic script, which covers the
// Persian ones (پ چ ژ گ). Diacritics are marks, digits are numbers and
// punctuation is neither, so all of them fall out here; tatweel is the one
// "letter" that carries no sound.
func isScriptLetter(r rune) bool {
	return r != tatweel && unicode.Is(unicode.Arabic, r) && unicode.IsLetter(r)
}

// lineLetters is a line reduced to its normalized letters, without a trailing ء.
func lineLetters(line string) []rune {
	letters := make([]rune, 0, len(line)/2)
	for _, r := range line {
		if folded, ok := letterFolds[r]; ok {
			r = folded
		} else if !isScriptLetter(r) {
			continue
		}
		letters = append(letters, r)
	}
	for len(letters) > 0 && letters[len(letters)-1] == hamza {
		letters = letters[:len(letters)-1]
	}
	return letters
}

// normalizeVerse is the letters of all lines joined: what repeat checks compare.
func normalizeVerse(lines []string) string {
	var b strings.Builder
	for _, line := range lines {
		b.WriteString(string(lineLetters(line)))
	}
	return b.String()
}

// firstLetter is the first letter of the verse, "" when it has none.
func firstLetter(lines []string) string {
	for _, line := range lines {
		if letters := lineLetters(line); len(letters) > 0 {
			return string(letters[0])
		}
	}
	return ""
}

// lastLetter is the last letter of the verse, "" when it has none.
func lastLetter(lines []string) string {
	for i := len(lines) - 1; i >= 0; i-- {
		if letters := lineLetters(lines[i]); len(letters) > 0 {
			return string(letters[len(letters)-1])
		}
	}
	return ""
}
