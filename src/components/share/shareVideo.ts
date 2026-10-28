// Client-side video export for the share card: the card is painted frame by
// frame on a canvas whose stream (plus the recitation, when chosen) is
// recorded with MediaRecorder in real time. MP4 is preferred (Chrome 126+,
// Safari); Firefox and older Chrome fall back to WebM.

import {
  paintShareCard,
  type ShareCardEmphasis,
  type ShareCardLayoutResult,
} from "./shareCard";

/** The card is fully shown from the first frame; reading starts after this. */
const LINES_START = 0.9;
const BOLD_SECONDS = 0.35;
const END_HOLD = 1.6;
const MAX_SECONDS = 90;
const FPS = 30;

export interface ShareVideoTimeline {
  duration: number;
  /** When each "line:N" group turns bold, and when it rests again. */
  starts: Record<string, number>;
  ends: Record<string, number>;
  /** Where in the recitation playback starts, and when in the video. */
  audioOffset: number;
  audioStartAt: number;
}

/**
 * Paces the reading. With verse sync (each selected line's start in the
 * recitation, ms), each mesra is bold while it is recited; otherwise each
 * gets time proportional to its length. The last one stays bold to the end.
 */
export function buildShareTimeline(
  layout: ShareCardLayoutResult,
  sync?: { starts: number[]; endMs: number } | null,
): ShareVideoTimeline {
  const starts: Record<string, number> = {};
  const ends: Record<string, number> = {};
  const groups = layout.lineGroups;
  let duration: number;
  let audioOffset = 0;
  let audioStartAt = 0.3;

  if (sync && sync.starts.length >= groups.length) {
    const first = sync.starts[0];
    groups.forEach((group, i) => {
      starts[group] = LINES_START + (sync.starts[i] - first) / 1000;
    });
    audioOffset = Math.max(0, first / 1000 - LINES_START);
    audioStartAt = Math.max(0, LINES_START - first / 1000);
    duration = LINES_START + (sync.endMs - first) / 1000 + 1.2;
  } else {
    let t = LINES_START;
    groups.forEach((group, i) => {
      starts[group] = t;
      t += Math.min(4.2, Math.max(1.6, 0.9 + layout.lineLengths[i] * 0.055));
    });
    duration = t + END_HOLD;
  }

  groups.forEach((group, i) => {
    ends[group] = i + 1 < groups.length ? starts[groups[i + 1]] : Infinity;
  });

  return {
    duration: Math.min(MAX_SECONDS, duration),
    starts,
    ends,
    audioOffset,
    audioStartAt,
  };
}

const ease = (x: number) => {
  const p = Math.min(1, Math.max(0, x));
  return p * p * (3 - 2 * p);
};

export const emphasisAt =
  (timeline: ShareVideoTimeline, time: number): ShareCardEmphasis =>
  (group) => {
    const start = timeline.starts[group];
    if (start === undefined) return 0;
    const rise = ease((time - start) / BOLD_SECONDS);
    const fall = ease((time - timeline.ends[group]) / BOLD_SECONDS);
    return rise * (1 - fall);
  };

export const drawShareFrame = (
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayoutResult,
  timeline: ShareVideoTimeline,
  time: number,
) => paintShareCard(ctx, layout, emphasisAt(timeline, time), time);

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickShareVideoMime() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }
  if (!("captureStream" in HTMLCanvasElement.prototype)) return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export async function loadRecitationAudio(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
  const data = await response.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
}

export interface RecordShareVideoOptions {
  layout: ShareCardLayoutResult;
  timeline: ShareVideoTimeline;
  audio?: AudioBuffer | null;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}

export interface ShareVideoResult {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
}

export async function recordShareVideo({
  layout,
  timeline,
  audio,
  signal,
  onProgress,
}: RecordShareVideoOptions): Promise<ShareVideoResult> {
  const mimeType = pickShareVideoMime();
  if (!mimeType) throw new Error("Video recording is not supported");

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  drawShareFrame(ctx, layout, timeline, 0);

  const stream = canvas.captureStream(FPS);
  let audioCtx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;

  if (audio) {
    audioCtx = new AudioContext();
    const destination = audioCtx.createMediaStreamDestination();
    const gain = audioCtx.createGain();
    source = audioCtx.createBufferSource();
    source.buffer = audio;
    source.connect(gain).connect(destination);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    await audioCtx.resume();

    // Short fade in, and out over the last second and a bit.
    const now = audioCtx.currentTime;
    const startAt = now + timeline.audioStartAt;
    const endAt = now + timeline.duration;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, startAt + 0.35);
    gain.gain.setValueAtTime(1, Math.max(startAt + 0.35, endAt - 1.2));
    gain.gain.linearRampToValueAtTime(0, endAt);
    source.start(startAt, timeline.audioOffset);
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  // Timers rather than rAF: frames keep coming even if the tab is
  // backgrounded briefly. The clock follows the audio when there is one.
  const clockStart = audioCtx ? audioCtx.currentTime : performance.now() / 1000;
  const now = () =>
    (audioCtx ? audioCtx.currentTime : performance.now() / 1000) - clockStart;

  recorder.start(250);
  let aborted = false;
  await new Promise<void>((resolve) => {
    const interval = window.setInterval(() => {
      const t = now();
      if (signal.aborted) {
        aborted = true;
      } else {
        drawShareFrame(ctx, layout, timeline, Math.min(t, timeline.duration));
        onProgress(Math.min(1, t / timeline.duration));
      }
      if (aborted || t >= timeline.duration) {
        window.clearInterval(interval);
        resolve();
      }
    }, 1000 / FPS);
  });

  if (recorder.state !== "inactive") recorder.stop();
  await stopped;
  try {
    source?.stop();
  } catch {
    // Already ended.
  }
  stream.getTracks().forEach((track) => track.stop());
  void audioCtx?.close();

  if (aborted) throw new DOMException("Video export cancelled", "AbortError");

  const type = recorder.mimeType || mimeType;
  return {
    blob: new Blob(chunks, { type: type.split(";")[0] }),
    mimeType: type,
    extension: type.includes("mp4") ? "mp4" : "webm",
  };
}
