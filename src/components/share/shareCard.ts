// Canvas renderer for the poem share card. The same layout feeds the live
// preview, the exported PNG and every frame of the exported video: layout is
// computed once, then painted with an optional per-mesra emphasis so the
// video can set each mesra in bold as it is read.

export type ShareCardThemeId = "dark" | "light" | "paper";
export type ShareCardFormat = "post" | "story" | "square";
export type ShareCardLayout = "single" | "couplet";

export interface ShareCardTheme {
  id: ShareCardThemeId;
  label: string;
  backgroundTop: string;
  backgroundBottom: string;
  glow: string;
  frame: string;
  title: string;
  text: string;
  muted: string;
  brand: string;
}

export const SHARE_CARD_THEMES: ShareCardTheme[] = [
  {
    id: "dark",
    label: "تیره",
    backgroundTop: "#18181b",
    backgroundBottom: "#09090b",
    glow: "rgba(255,255,255,0.075)",
    frame: "rgba(255,255,255,0.13)",
    title: "rgba(255,255,255,0.95)",
    text: "rgba(255,255,255,0.9)",
    muted: "rgba(255,255,255,0.58)",
    brand: "rgba(255,255,255,0.42)",
  },
  {
    id: "light",
    label: "روشن",
    backgroundTop: "#ffffff",
    backgroundBottom: "#f1f1ef",
    glow: "rgba(0,0,0,0.035)",
    frame: "rgba(10,10,10,0.11)",
    title: "#0a0a0a",
    text: "#1c1c1f",
    muted: "rgba(10,10,10,0.55)",
    brand: "rgba(10,10,10,0.4)",
  },
  {
    id: "paper",
    label: "کاغذی",
    backgroundTop: "#faf6ea",
    backgroundBottom: "#ece2c9",
    glow: "rgba(255,252,242,0.45)",
    frame: "rgba(120,90,50,0.22)",
    title: "#3d2f22",
    text: "#403428",
    muted: "rgba(64,52,40,0.62)",
    brand: "rgba(64,52,40,0.45)",
  },
];

export const SHARE_CARD_FORMATS: Record<
  ShareCardFormat,
  { label: string; width: number; height: number }
> = {
  post: { label: "پست ۴:۵", width: 1080, height: 1350 },
  story: { label: "استوری ۹:۱۶", width: 1080, height: 1920 },
  square: { label: "مربع ۱:۱", width: 1080, height: 1080 },
};

export interface ShareCardInput {
  title: string;
  poet: string;
  /** Selected lines with their index in the poem, in reading order. */
  lines: Array<{ text: string; index: number }>;
  theme: ShareCardTheme;
  fontStack: string;
  layout: ShareCardLayout;
  format: ShareCardFormat;
}

interface CardText {
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  group: string;
  /** Verses only: the same line in bold, for the video's emphasis. */
  boldFont?: string;
}

export interface ShareCardLayoutResult {
  width: number;
  height: number;
  theme: ShareCardTheme;
  texts: CardText[];
  /** Reveal order for the video: "line:N" groups, N = position in input lines. */
  lineGroups: string[];
  /** Characters per line group, to pace the video. */
  lineLengths: number[];
  truncated: boolean;
}

/** 0 = resting (dimmed regular), 1 = being read (bold), per "line:N" group. */
export type ShareCardEmphasis = (group: string) => number;

/** Opacity of a mesra that isn't being read, while the video plays. */
const RESTING_ALPHA = 0.42;

const font = (weight: number, size: number, stack: string) =>
  `${weight} ${size}px ${stack}`;

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
};

const ellipsize = (text: string) => `${text.replace(/[\s.…]+$/, "")}…`;

/** Rows of the verse block: a beyt in couplet layout is two columns. */
type Row =
  | { kind: "single"; group: string; lines: string[] }
  | {
      kind: "pair";
      right: { group: string; lines: string[] };
      left: { group: string; lines: string[] };
    };

export const ensureShareFonts = async (fontStack: string) => {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all(
      [400, 500, 700, 800].map((weight) =>
        document.fonts.load(font(weight, 40, fontStack), "گنجورک"),
      ),
    );
  } catch {
    // A missing face falls back to the next family in the stack.
  }
};

export function layoutShareCard(
  ctx: CanvasRenderingContext2D,
  input: ShareCardInput,
): ShareCardLayoutResult {
  const { width, height } = SHARE_CARD_FORMATS[input.format];
  const { theme, fontStack } = input;
  const texts: CardText[] = [];
  const inset = 56;
  const contentWidth = width - 180;
  const isStory = input.format === "story";

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Header: title (up to two lines) and poet.
  const titleSize = isStory ? 64 : 56;
  ctx.font = font(700, titleSize, fontStack);
  let titleLines = wrap(ctx, input.title, contentWidth);
  if (titleLines.length > 2) titleLines = [titleLines[0], ellipsize(titleLines[1])];
  const titleLineHeight = Math.round(titleSize * 1.35);
  const poetSize = isStory ? 38 : 34;
  const headerHeight = titleLines.length * titleLineHeight + poetSize * 1.9;
  // Space between the title block and the verses.
  const headerGap = isStory ? 84 : 68;

  const footerHeight = isStory ? 270 : 200;
  const topLimit = inset + (isStory ? 170 : 96);
  const bottomLimit = height - footerHeight;
  const versesMax = bottomLimit - topLimit - headerHeight - headerGap;

  // Verses: largest font size that fits, then truncate at the minimum.
  const minSize = 24;
  const maxSize = isStory ? 68 : 62;
  // Couplet columns use the frame's full width; a beyt that still can't sit
  // side by side at a readable size makes the card fall back to stacked.
  const columnGap = 48;
  const columnWidth = (width - 140 - columnGap) / 2;
  let couplet = input.layout === "couplet";

  // Measured in bold: the video sets each mesra bold in place, so the bold
  // line must fit the same width.
  const buildRows = (size: number) => {
    ctx.font = font(800, size, fontStack);
    const rows: Row[] = [];
    const lines = input.lines;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1];
      if (
        couplet &&
        line.index % 2 === 0 &&
        next &&
        next.index === line.index + 1
      ) {
        rows.push({
          kind: "pair",
          right: { group: `line:${i}`, lines: wrap(ctx, line.text, columnWidth) },
          left: { group: `line:${i + 1}`, lines: wrap(ctx, next.text, columnWidth) },
        });
        i += 1;
      } else {
        rows.push({
          kind: "single",
          group: `line:${i}`,
          lines: wrap(ctx, line.text, contentWidth),
        });
      }
    }
    return rows;
  };

  const measure = (rows: Row[], size: number) => {
    const lineHeight = Math.round(size * (couplet ? 1.62 : 1.72));
    const beytGap = Math.round(lineHeight * 0.42);
    let total = 0;
    const heights = rows.map((row, i) => {
      const count =
        row.kind === "pair"
          ? Math.max(row.right.lines.length, row.left.lines.length)
          : row.lines.length;
      const h = count * lineHeight;
      // Single layout: a little air after each beyt (odd poem index).
      const gap =
        i === rows.length - 1
          ? 0
          : row.kind === "pair" ||
              input.lines[Number(row.group.slice(5))]?.index % 2 === 1
            ? beytGap
            : 0;
      total += h + gap;
      return { h, gap };
    });
    return { lineHeight, heights, total };
  };

  // Prefer a size where no mesra has to wrap, down to a readable floor.
  const wraps = (rows: Row[]) =>
    rows.some((row) =>
      row.kind === "pair"
        ? row.right.lines.length > 1 || row.left.lines.length > 1
        : row.lines.length > 1,
    );
  const fitWithoutWraps = () => {
    const floor = couplet ? 32 : 34;
    let candidate = maxSize;
    while (candidate > floor && wraps(buildRows(candidate))) candidate -= 2;
    return candidate;
  };
  let size = fitWithoutWraps();
  if (couplet && wraps(buildRows(size))) {
    couplet = false;
    size = fitWithoutWraps();
  }
  // Prose wraps anyway: give it the full size rather than the floor.
  if (wraps(buildRows(size))) size = maxSize;
  let rows = buildRows(size);
  let metrics = measure(rows, size);
  while (metrics.total > versesMax && size > minSize) {
    size -= 2;
    rows = buildRows(size);
    metrics = measure(rows, size);
  }

  let truncated = false;
  if (metrics.total > versesMax) {
    truncated = true;
    while (rows.length > 1 && metrics.total > versesMax) {
      rows = rows.slice(0, -1);
      metrics = measure(rows, size);
    }
    const last = rows[rows.length - 1];
    const lastLines =
      last.kind === "pair" ? (last.left.lines.length ? last.left.lines : last.right.lines) : last.lines;
    if (lastLines.length) lastLines[lastLines.length - 1] = ellipsize(lastLines[lastLines.length - 1]);
  }

  // Centre the whole composition (header + verses) vertically.
  const blockHeight = headerHeight + headerGap + metrics.total;
  let y = Math.max(topLimit, topLimit + (bottomLimit - topLimit - blockHeight) / 2);
  const cx = width / 2;

  titleLines.forEach((line) => {
    y += titleLineHeight;
    texts.push({
      text: line,
      x: cx,
      y: y - titleLineHeight * 0.22,
      font: font(700, titleSize, fontStack),
      color: theme.title,
      group: "title",
    });
  });
  y += poetSize * 1.35;
  texts.push({
    text: input.poet,
    x: cx,
    y,
    font: font(400, poetSize, fontStack),
    color: theme.muted,
    group: "poet",
  });
  y += poetSize * 0.55;

  y += headerGap;

  const verseFont = font(500, size, fontStack);
  const verseBoldFont = font(800, size, fontStack);
  const { lineHeight } = metrics;
  const baseline = lineHeight * 0.68;
  const rightX = cx + columnGap / 2 + columnWidth / 2;
  const leftX = cx - columnGap / 2 - columnWidth / 2;
  const lineGroups: string[] = [];
  const lineLengths: number[] = [];

  rows.forEach((row, i) => {
    const push = (group: string, lines: string[], x: number) => {
      lineGroups.push(group);
      lineLengths.push(lines.join(" ").length);
      lines.forEach((text, j) => {
        texts.push({
          text,
          x,
          y: y + j * lineHeight + baseline,
          font: verseFont,
          boldFont: verseBoldFont,
          color: theme.text,
          group,
        });
      });
    };
    if (row.kind === "pair") {
      push(row.right.group, row.right.lines, rightX);
      push(row.left.group, row.left.lines, leftX);
    } else {
      push(row.group, row.lines, cx);
    }
    y += metrics.heights[i].h + metrics.heights[i].gap;
  });

  texts.push({
    text: "گنجورک · ganjoorak.ir",
    x: cx,
    y: height - inset - (isStory ? 110 : 64),
    font: font(400, isStory ? 28 : 25, fontStack),
    color: theme.brand,
    group: "brand",
  });

  return {
    width,
    height,
    theme,
    texts,
    lineGroups,
    lineLengths,
    truncated,
  };
}

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/**
 * Paints a laid-out card. `time` (seconds) slowly drifts the background glow
 * in the video; `emphasis` dims resting mesras and bolds the one being read,
 * omitted for a still image.
 */
export function paintShareCard(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayoutResult,
  emphasis?: ShareCardEmphasis,
  time = 0,
) {
  const { width, height, theme } = layout;
  const inset = 56;

  ctx.save();
  ctx.globalAlpha = 1;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, theme.backgroundTop);
  bg.addColorStop(1, theme.backgroundBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const drift = Math.sin(time * 0.35) * width * 0.08;
  const glow = ctx.createRadialGradient(
    width / 2 + drift,
    height * 0.3,
    0,
    width / 2 + drift,
    height * 0.3,
    width * 0.85,
  );
  glow.addColorStop(0, theme.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 2;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 28);
  ctx.stroke();

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  for (const item of layout.texts) {
    ctx.fillStyle = item.color;
    if (!emphasis || !item.boldFont) {
      ctx.globalAlpha = 1;
      ctx.font = item.font;
      ctx.fillText(item.text, item.x, item.y);
      continue;
    }
    // Cross-fade regular → bold so the weight change reads as one motion.
    const e = Math.min(1, Math.max(0, emphasis(item.group)));
    if (e < 1) {
      ctx.globalAlpha = RESTING_ALPHA * (1 - e);
      ctx.font = item.font;
      ctx.fillText(item.text, item.x, item.y);
    }
    if (e > 0) {
      ctx.globalAlpha = e;
      ctx.font = item.boldFont;
      ctx.fillText(item.text, item.x, item.y);
    }
  }
  ctx.restore();
}

/** Lays out and paints a still card at full resolution. */
export async function renderShareCardCanvas(input: ShareCardInput) {
  await ensureShareFonts(input.fontStack);
  const { width, height } = SHARE_CARD_FORMATS[input.format];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  const layout = layoutShareCard(ctx, input);
  paintShareCard(ctx, layout);
  return { canvas, layout };
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type = "image/png") =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), type),
  );
