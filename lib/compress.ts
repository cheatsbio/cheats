/**
 * Client-side image crushing. Everything here runs in the browser so the raw
 * photo never leaves the device: it is decoded, resized on a canvas and
 * re-encoded as WebP before it is uploaded to Supabase Storage.
 */

export type ImagePreset = "avatar" | "background";

interface PresetConfig {
  maxWidth: number;
  maxHeight: number;
  /** Starting WebP quality, 0–1. */
  quality: number;
  /** Centre-crop to a square before resizing (used for avatars). */
  square: boolean;
  /** If the first encode is bigger than this, quality steps down (never below MIN_QUALITY). */
  softLimitBytes: number;
}

export const IMAGE_PRESETS: Record<ImagePreset, PresetConfig> = {
  // 250×250 at 55% → roughly 10–20 KB
  avatar: { maxWidth: 250, maxHeight: 250, quality: 0.55, square: true, softLimitBytes: 24 * 1024 },
  // 1280px wide at 50% → roughly 40–80 KB
  background: { maxWidth: 1280, maxHeight: 1920, quality: 0.5, square: false, softLimitBytes: 90 * 1024 },
};

const MIN_QUALITY = 0.3;
const QUALITY_STEP = 0.08;
const MAX_RETRIES = 3;

/** Raw files above this are rejected before decoding so a huge photo can't freeze the tab. */
export const MAX_RAW_IMAGE_BYTES = 15 * 1024 * 1024;

const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
];

/** Value for <input accept> on image pickers. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  /** Quality actually used for the final encode. */
  quality: number;
  originalBytes: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> decoder (older Safari, odd formats).
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = objectUrl;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("That image couldn't be read. Try a PNG, JPG or WebP file.");
  }
}

function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The image couldn't be compressed. Try a different file."));
        } else if (blob.type !== "image/webp") {
          // Browsers that can't encode WebP silently hand back a PNG.
          reject(
            new Error(
              "This browser can't export WebP images. Use a current version of Chrome, Edge, Firefox or Safari."
            )
          );
        } else {
          resolve(blob);
        }
      },
      "image/webp",
      quality
    );
  });
}

/**
 * Resizes and re-encodes an image as WebP. Never upscales. Animated GIFs
 * keep only their first frame.
 */
export async function compressImage(file: File, preset: ImagePreset): Promise<CompressedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Choose a PNG, JPG, WebP, GIF or AVIF image.");
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error(`That image is ${formatBytes(file.size)}. Pick one under ${formatBytes(MAX_RAW_IMAGE_BYTES)}.`);
  }

  const cfg = IMAGE_PRESETS[preset];
  const decoded = await decode(file);

  try {
    // Source rectangle: whole image, or a centred square for avatars.
    let sx = 0;
    let sy = 0;
    let sw = decoded.width;
    let sh = decoded.height;
    if (cfg.square) {
      const side = Math.min(sw, sh);
      sx = Math.floor((sw - side) / 2);
      sy = Math.floor((sh - side) / 2);
      sw = side;
      sh = side;
    }

    const scale = Math.min(1, cfg.maxWidth / sw, cfg.maxHeight / sh);
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing isn't available in this browser.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, width, height);

    let quality = cfg.quality;
    let blob = await encodeWebp(canvas, quality);
    for (let i = 0; i < MAX_RETRIES && blob.size > cfg.softLimitBytes && quality > MIN_QUALITY; i++) {
      quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
      blob = await encodeWebp(canvas, quality);
    }

    return { blob, width, height, quality, originalBytes: file.size };
  } finally {
    decoded.release();
  }
}
