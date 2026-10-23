// Each key has a cluster file at public/data/interests/<key>.json (built offline from
// Ganjoor's embeddings in .data/); labels mirror those files' "label" field.
export interface PoemInterest {
  key: string;
  label: string;
}

export const POEM_INTERESTS: PoemInterest[] = [
  { key: "love", label: "عاشقانه" },
  { key: "wine", label: "باده و خرابات" },
  { key: "spring", label: "بهار و طبیعت" },
  { key: "seeking", label: "طلب و سلوک" },
  { key: "annihilation", label: "فنا و ترک خود" },
  { key: "mysticabstract", label: "عرفان انتزاعی" },
  { key: "unity", label: "توحید و فقر" },
  { key: "prayer", label: "مناجات با خدا" },
  { key: "contentment", label: "قناعت و بی‌نیازی" },
  { key: "time", label: "گذر عمر و روزگار" },
  { key: "praise", label: "مدح و ستایش" },
  { key: "epic", label: "حماسه و روایت" },
  { key: "satire", label: "هجو و رسوایی" },
];

export const DEFAULT_SUGGESTED_INTEREST_KEYS = [
  "love",
  "wine",
  "spring",
  "seeking",
  "time",
  "prayer",
  "epic",
  "satire",
];

const INTEREST_BY_KEY = new Map(
  POEM_INTERESTS.map((interest) => [interest.key, interest]),
);

export const getInterestByKey = (key: string | null | undefined) =>
  key ? INTEREST_BY_KEY.get(key) ?? null : null;

export const isValidInterestKey = (key: string) => INTEREST_BY_KEY.has(key);

export const sanitizeInterestKeys = (keys: unknown): string[] => {
  if (!Array.isArray(keys)) {
    return [];
  }

  return Array.from(
    new Set(
      keys.filter(
        (key): key is string => typeof key === "string" && isValidInterestKey(key),
      ),
    ),
  );
};

export const orderInterestsForRail = (selectedKeys: string[]): PoemInterest[] => {
  const selected = sanitizeInterestKeys(selectedKeys);
  const selectedSet = new Set(selected);

  const chosen = selected
    .map((key) => INTEREST_BY_KEY.get(key))
    .filter((interest): interest is PoemInterest => Boolean(interest));

  if (chosen.length === 0) {
    const suggested = DEFAULT_SUGGESTED_INTEREST_KEYS.map((key) =>
      INTEREST_BY_KEY.get(key),
    ).filter((interest): interest is PoemInterest => Boolean(interest));

    return [
      ...suggested,
      ...POEM_INTERESTS.filter(
        (interest) => !DEFAULT_SUGGESTED_INTEREST_KEYS.includes(interest.key),
      ),
    ];
  }

  return [
    ...chosen,
    ...POEM_INTERESTS.filter((interest) => !selectedSet.has(interest.key)),
  ];
};
