"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Slider } from "@/components/ui/slider";

export type CropKind = "banner" | "avatar";

// What gets uploaded: the frame, drawn to a canvas at this size (the server crops and scales the same way).
const OUTPUT = {
  banner: { width: 1500, height: 500, title: "برش تصویر بنر" },
  avatar: { width: 512, height: 512, title: "برش تصویر نمایه" },
} as const;

const MAX_ZOOM = 4;
const ARROW_STEP = 12;

interface View {
  /** 1 fits the image to the frame (cover); larger zooms in. */
  zoom: number;
  /** Offset of the image centre from the frame centre, in frame pixels. */
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The image must always cover the whole frame, so it can't be dragged off and leave a gap. */
const fit = (view: View, frame: Size, image: Size): View => {
  const scale = Math.max(frame.width / image.width, frame.height / image.height) * view.zoom;
  const slackX = Math.max(0, (image.width * scale - frame.width) / 2);
  const slackY = Math.max(0, (image.height * scale - frame.height) / 2);
  return { zoom: view.zoom, x: clamp(view.x, -slackX, slackX), y: clamp(view.y, -slackY, slackY) };
};

const coverScale = (frame: Size, image: Size) => Math.max(frame.width / image.width, frame.height / image.height);

/** Draws what the frame shows onto a canvas of the output size and encodes it as JPEG. */
const exportCrop = (img: HTMLImageElement, view: View, frame: Size, kind: CropKind) =>
  new Promise<Blob>((resolve, reject) => {
    const { width, height } = OUTPUT[kind];
    const scale = coverScale(frame, { width: img.naturalWidth, height: img.naturalHeight }) * view.zoom;
    const sw = frame.width / scale;
    const sh = frame.height / scale;
    const sx = img.naturalWidth / 2 - view.x / scale - sw / 2;
    const sy = img.naturalHeight / 2 - view.y / scale - sh / 2;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("canvas"));
      return;
    }
    // JPEG has no alpha: transparent PNG areas would turn black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.9);
  });

/**
 * The crop step of the appearance sheet. A fixed frame (3:1 for the banner, a round 1:1 for the picture)
 * shows the chosen image; drag (mouse or touch) to pan, pinch or use the slider to zoom, arrow keys nudge.
 * `onConfirm` receives the cropped JPEG; uploading and its errors are the caller's.
 */
export default function ImageCropper({
  file,
  kind,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  file: File;
  kind: CropKind;
  busy: boolean;
  error: string;
  onBack: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [frame, setFrame] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [exportError, setExportError] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  // Pointers currently down on the frame (a second one makes it a pinch).
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (!cancelled) setImg(image);
    };
    image.onerror = () => {
      if (!cancelled) setLoadError("این تصویر خوانده نشد.");
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || !img) return undefined;
    const measure = () => setFrame({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [img]);

  const natural: Size | null = img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  const ready = Boolean(img && frame && frame.width > 0);
  // Always shown (and exported) clamped, whatever the frame size is right now.
  const shown = ready ? fit(view, frame!, natural!) : view;
  const scale = ready ? coverScale(frame!, natural!) * shown.zoom : 1;

  const update = (next: (current: View) => View) => {
    if (!frame || !natural) return;
    setView((current) => fit(next(fit(current, frame, natural)), frame, natural));
  };

  /** Zooms about the frame centre: the offset scales with the image. */
  const zoomTo = (zoom: number) =>
    update((current) => {
      const next = clamp(zoom, 1, MAX_ZOOM);
      const ratio = next / current.zoom;
      return { zoom: next, x: current.x * ratio, y: current.y * ratio };
    });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 1) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      update((state) => ({ ...state, x: state.x + dx, y: state.y + dy }));
    } else if (pointers.current.size === 2) {
      const other = Array.from(pointers.current.entries()).find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      if (before > 0 && after > 0) {
        update((state) => {
          const zoom = clamp(state.zoom * (after / before), 1, MAX_ZOOM);
          const ratio = zoom / state.zoom;
          return { zoom, x: state.x * ratio, y: state.y * ratio };
        });
      }
    }
    pointers.current.set(event.pointerId, current);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [ARROW_STEP, 0],
      ArrowRight: [-ARROW_STEP, 0],
      ArrowUp: [0, ARROW_STEP],
      ArrowDown: [0, -ARROW_STEP],
    };
    const delta = step[event.key];
    if (delta) {
      event.preventDefault();
      update((state) => ({ ...state, x: state.x + delta[0], y: state.y + delta[1] }));
    }
  };

  const handleConfirm = async () => {
    if (!img || !frame) return;
    setExportError("");
    try {
      onConfirm(await exportCrop(img, shown, frame, kind));
    } catch {
      setExportError("آماده‌سازی تصویر ناموفق بود. تصویر دیگری را امتحان کنید.");
    }
  };

  const message = loadError || exportError || error;

  return (
    <>
      <DialogHeader className="settings-sheet-header">
        <div className="settings-sheet-heading">
          <Button variant="ghost" size="icon-lg" onClick={onBack} disabled={busy} aria-label="بازگشت">
            <ChevronRight aria-hidden="true" />
          </Button>
          <DialogTitle>{OUTPUT[kind].title}</DialogTitle>
        </div>
      </DialogHeader>
      <DialogPanel className="settings-sheet-body">
        <div className="settings-sheet-groups">
          <section className="settings-group">
            <div className="settings-group-card">
              <div className="settings-group-block">
                <div className={`appearance-crop appearance-crop--${kind}`}>
                  <div
                    ref={frameRef}
                    className="appearance-crop-frame"
                    role="group"
                    tabIndex={0}
                    aria-label="قاب برش؛ با کشیدن یا کلیدهای جهت‌نما تصویر را جابه‌جا کنید"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    onKeyDown={handleKeyDown}
                  >
                    {img && ready && (
                      // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL being cropped
                      <img
                        src={img.src}
                        alt=""
                        draggable={false}
                        className="appearance-crop-image"
                        style={{
                          width: natural!.width * scale,
                          height: natural!.height * scale,
                          left: frame!.width / 2 + shown.x - (natural!.width * scale) / 2,
                          top: frame!.height / 2 + shown.y - (natural!.height * scale) / 2,
                        }}
                      />
                    )}
                    {!img && !loadError && <span className="appearance-crop-wait">در حال بارگذاری…</span>}
                    {kind === "avatar" && <span className="appearance-crop-mask" aria-hidden="true" />}
                  </div>
                </div>
                <div className="appearance-crop-zoom">
                  <ZoomOut aria-hidden="true" />
                  <Slider
                    aria-label="بزرگ‌نمایی"
                    min={1}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={[shown.zoom]}
                    disabled={!ready || busy}
                    onValueChange={(value) => zoomTo(Array.isArray(value) ? value[0] : value)}
                  />
                  <ZoomIn aria-hidden="true" />
                </div>
                <p className="appearance-crop-hint">
                  {kind === "banner"
                    ? "تصویر را بکشید تا بخش دلخواه در قاب بنر بیفتد؛ با لغزنده یا دو انگشت بزرگ‌نمایی کنید."
                    : "تصویر را بکشید تا چهره یا بخش دلخواه در دایره بیفتد؛ با لغزنده یا دو انگشت بزرگ‌نمایی کنید."}
                </p>
              </div>
            </div>
          </section>
          {message && <FormError>{message}</FormError>}
        </div>
      </DialogPanel>
      <DialogFooter className="settings-sheet-footer">
        <Button variant="outline" size="lg" onClick={onBack} disabled={busy}>
          انصراف
        </Button>
        <Button size="lg" onClick={handleConfirm} loading={busy} disabled={!ready}>
          {busy ? "در حال بارگذاری…" : "بارگذاری"}
        </Button>
      </DialogFooter>
    </>
  );
}
