/**
 * face-detect.js — optional, lazy, fully local face suggestion.
 *
 * MediaPipe Tasks Vision and the BlazeFace model are vendored under
 * /vendor/mediapipe, so detection works offline and no photo is uploaded.
 * Every failure path is non-fatal: the caller keeps a centred crop at the selected passport ratio.
 */

const BASE_URL = new URL('../vendor/mediapipe/', import.meta.url);
const MODEL_URL = new URL('blaze_face_short_range.tflite', BASE_URL).href;
const WASM_URL = new URL('wasm', BASE_URL).href;

let detectorPromise = null;
let lastError = null;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function createDetector(delegate) {
  const module = await import(new URL('vision_bundle.mjs', BASE_URL).href);
  const fileset = await module.FilesetResolver.forVisionTasks(WASM_URL);
  return module.FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.4,
  });
}

async function getDetector() {
  if (detectorPromise) return detectorPromise;

  detectorPromise = (async () => {
    // GPU is faster where available; headless/older GPUs fall back to CPU.
    try {
      return await createDetector('GPU');
    } catch (error) {
      console.warn('Face detection GPU delegate unavailable, retrying on CPU.', error);
      return await createDetector('CPU');
    }
  })();

  try {
    return await detectorPromise;
  } catch (error) {
    lastError = error;
    detectorPromise = null;
    throw error;
  }
}

/** Runs detection once (downloads the 9 MB WASM + 224 KB model on first use). */
export async function detectFace(source) {
  const detector = await withTimeout(
    getDetector(),
    30000,
    'Face detection took too long to load.',
  );
  const result = await withTimeout(
    Promise.resolve().then(() => detector.detect(source)),
    15000,
    'Face detection timed out.',
  );

  const best = result?.detections?.[0];
  if (!best?.boundingBox) return null;
  const box = best.boundingBox;
  const score = best.categories?.[0]?.score ?? 0;
  if (!(box.width > 0) || !(box.height > 0)) return null;

  return {
    x: box.originX,
    y: box.originY,
    width: box.width,
    height: box.height,
    score,
    // BlazeFace returns six landmarks (eyes, nose, mouth, ears) in source pixels.
    keypoints: (best.keypoints || []).map((point) => ({
      x: point.x,
      y: point.y,
      label: point.label ?? null,
    })),
  };
}

export function faceDetectionError() {
  return lastError;
}
