/**
 * background.js — local selfie segmentation for background replacement.
 *
 * MediaPipe's selfie segmenter is vendored and loaded lazily. A confidence mask
 * is returned at a reduced working resolution; compositing happens in the
 * image-processing layer. Failures are non-fatal — the caller keeps the
 * original background and tells the user.
 */

const BASE_URL = new URL('../vendor/mediapipe/', import.meta.url);
const MODEL_URL = new URL('selfie_segmenter.tflite', BASE_URL).href;
const WASM_URL = new URL('wasm', BASE_URL).href;
const MAX_MASK_SIDE = 1024;

let segmenterPromise = null;
let lastError = null;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      // Do not keep Node-style timers alive in browsers; harmless either way.
      timer.unref?.();
    }),
  ]);
}

async function createSegmenter(delegate) {
  const module = await import(new URL('vision_bundle.mjs', BASE_URL).href);
  const fileset = await module.FilesetResolver.forVisionTasks(WASM_URL);
  return module.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate,
    },
    runningMode: 'IMAGE',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}

async function getSegmenter() {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    try {
      return await createSegmenter('GPU');
    } catch (error) {
      console.warn('Background segmentation GPU delegate unavailable; retrying on CPU.', error);
      return await createSegmenter('CPU');
    }
  })();
  try {
    return await segmenterPromise;
  } catch (error) {
    lastError = error;
    segmenterPromise = null;
    throw error;
  }
}

/**
 * Returns a canvas whose red channel holds the person confidence (0..255).
 * The mask is scaled to at most 1024 px on its long edge, which is enough for
 * an 826 px print render while keeping memory and inference time low.
 */
export async function createBackgroundMask(source) {
  const segmenter = await withTimeout(
    getSegmenter(),
    30000,
    'Background removal took too long to load.',
  );

  const scale = Math.min(1, MAX_MASK_SIDE / Math.max(source.width, source.height));
  const input = document.createElement('canvas');
  input.width = Math.max(1, Math.round(source.width * scale));
  input.height = Math.max(1, Math.round(source.height * scale));
  const inputContext = input.getContext('2d');
  inputContext.imageSmoothingEnabled = true;
  inputContext.imageSmoothingQuality = 'high';
  inputContext.drawImage(source, 0, 0, input.width, input.height);

  const result = await withTimeout(
    Promise.resolve().then(() => segmenter.segment(input)),
    20000,
    'Background removal timed out.',
  );

  const mask = result?.confidenceMasks?.[0];
  if (!mask) {
    result?.close?.();
    throw new Error('The background model did not return a person mask.');
  }

  const width = mask.width;
  const height = mask.height;
  const confidence = mask.getAsFloat32Array();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0, p = 0; i < confidence.length; i += 1, p += 4) {
    const value = Math.max(0, Math.min(1, confidence[i]));
    const level = Math.round(value * 255);
    data[p] = level;
    data[p + 1] = level;
    data[p + 2] = level;
    data[p + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);

  try {
    mask.close?.();
    result.close?.();
  } catch {
    // Masks are already extracted; cleanup failures should not block editing.
  }

  return canvas;
}

export function backgroundSegmentationError() {
  return lastError;
}
