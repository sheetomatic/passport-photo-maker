/**
 * image-processing.js — local-only photo decode, analysis and enhancement.
 *
 * The enhancement is deliberately conservative and fully explainable:
 *  - gentle grey-world white balance
 *  - exposure pulled toward a mid-tone target
 *  - a mild percentile contrast stretch
 *  - optional luminance-only unsharp mask
 *
 * No face reshaping, no generative model, no network calls. The feature is
 * labelled "Basic Photo Enhancement" because that is exactly what it is.
 */

import { clamp } from './geometry.js';

export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const WARN_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_SOURCE_SIDE = 3200;
export const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIC_EXTENSIONS = ['heic', 'heif'];

function isHeicFile(file) {
  const extension = extensionOf(file?.name);
  return HEIC_EXTENSIONS.includes(extension) || HEIC_TYPES.includes((file?.type || '').toLowerCase());
}
export const DEFAULT_ENHANCE_SETTINGS = Object.freeze({
  brightness: 0,
  contrast: 0,
  sharpness: 30,
});

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

export function validatePhotoFile(file) {
  if (!file) throw new UserError('Choose a photo first.');
  const extension = extensionOf(file.name);
  const extensionOk =
    ['jpg', 'jpeg', 'png', 'webp', ...HEIC_EXTENSIONS].includes(extension) ||
    (!extension && (SUPPORTED_TYPES.includes(file.type) || HEIC_TYPES.includes(file.type)));
  const typeOk =
    !file.type ||
    SUPPORTED_TYPES.includes(file.type) ||
    HEIC_TYPES.includes(file.type);

  if (!extensionOk || !typeOk) {
    throw new UserError(
      'That file type isn’t supported. Please choose a JPG, PNG, WEBP, or HEIC photo.',
    );
  }
  if (!file.size) {
    throw new UserError('That file appears to be empty. Please choose another photo.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new UserError(
      `That photo is ${(file.size / 1024 / 1024).toFixed(0)} MB. Please choose a file under 40 MB.`,
    );
  }

  const warnings = [];
  if (file.size > WARN_FILE_BYTES) {
    warnings.push('Large photo — processing may take a few seconds.');
  }
  return { warnings };
}

async function decodeWithImageElement(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('decode failed'));
      });
    }
    // Keep the URL alive until the image has been drawn; Safari can drop an
    // <img> resource if its blob URL is revoked too eagerly (notably for HEIC).
    image.__objectUrl = url;
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function decodeBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await decodeWithImageElement(file);
    } catch {
      return null;
    }
  }
}

/**
 * Decode, normalise orientation, cap the working resolution and flatten any
 * transparency onto white. Returns a canvas that every later stage reads from.
 */
export async function loadPhoto(file) {
  const { warnings } = validatePhotoFile(file);
  const decoded = await decodeBitmap(file);
  if (!decoded) {
    if (isHeicFile(file)) {
      throw new UserError(
        'This browser can’t decode HEIC photos. On iPhone, set Settings → Camera → Formats to “Most Compatible”, or take the photo from Safari. Otherwise export it as a JPEG.',
      );
    }
    throw new UserError(
      'We couldn’t read that image. It may be corrupted or in an unsupported format.',
    );
  }

  const width = decoded.width || decoded.naturalWidth;
  const height = decoded.height || decoded.naturalHeight;
  if (!width || !height) {
    decoded.close?.();
    throw new UserError('We couldn’t read the dimensions of that image.');
  }
  if (Math.min(width, height) < 120) {
    decoded.close?.();
    throw new UserError('That image is too small. Please use a photo at least 500 px wide.');
  }

  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(width, height));
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(width * scale));
  source.height = Math.max(1, Math.round(height * scale));
  const context = source.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, source.width, source.height);
  try {
    context.drawImage(decoded, 0, 0, source.width, source.height);
  } finally {
    decoded.close?.();
    if (decoded.__objectUrl) URL.revokeObjectURL(decoded.__objectUrl);
  }

  if (Math.min(width, height) < 500) {
    warnings.push('Low-resolution photo — print quality may be soft.');
  }

  return {
    source,
    width: source.width,
    height: source.height,
    originalWidth: width,
    originalHeight: height,
    name: file.name || 'photo',
    size: file.size,
    type: file.type || `image/${extensionOf(file.name) === 'jpg' ? 'jpeg' : extensionOf(file.name)}`,
    warnings,
    analysis: analyzePhoto(source),
  };
}

/** Downsample to a small canvas for histogram work. */
function sampleCanvas(source, targetWidth = 220) {
  const scale = Math.min(1, targetWidth / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Measure the photo once. Returns conservative correction factors that the
 * tone LUT uses. All values are clamped so a badly exposed or tinted photo can
 * be improved without inventing new colours.
 */
export function analyzePhoto(source) {
  const fallback = {
    wb: [1, 1, 1],
    exposure: 1,
    contrast: 1,
    meanLum: 0.5,
    p2: 0,
    p98: 1,
  };
  try {
    const canvas = sampleCanvas(source);
    const { data } = canvas
      .getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.length / 4;
    if (!pixels) return fallback;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumLum = 0;
    const histogram = new Uint32Array(256);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sumLum += lum;
      histogram[Math.min(255, Math.max(0, Math.round(lum)))] += 1;
    }

    const meanR = sumR / pixels / 255;
    const meanG = sumG / pixels / 255;
    const meanB = sumB / pixels / 255;
    const meanLum = sumLum / pixels / 255;

    const percentile = (fraction) => {
      const target = Math.floor(pixels * fraction);
      let seen = 0;
      for (let value = 0; value < 256; value += 1) {
        seen += histogram[value];
        if (seen >= target) return value / 255;
      }
      return 1;
    };
    const p2 = percentile(0.02);
    const p98 = percentile(0.98);

    const greyTarget = Math.max(0.001, (meanR + meanG + meanB) / 3);
    const rawWb = [
      clamp(greyTarget / Math.max(0.02, meanR), 0.9, 1.12),
      clamp(greyTarget / Math.max(0.02, meanG), 0.9, 1.12),
      clamp(greyTarget / Math.max(0.02, meanB), 0.9, 1.12),
    ];
    // Apply only 60% of the correction so warm indoor light stays natural.
    const wb = rawWb.map((gain) => 1 + (gain - 1) * 0.6);

    const rawExposure = clamp(0.56 / Math.max(0.08, meanLum), 0.8, 1.25);
    const exposure = 1 + (rawExposure - 1) * 0.65;

    const range = Math.max(0.18, p98 - p2);
    const rawContrast = clamp(0.72 / range, 0.9, 1.32);
    const contrast = 1 + (rawContrast - 1) * 0.5;

    return { wb, exposure, contrast, meanLum, p2, p98 };
  } catch (error) {
    console.warn('Photo analysis failed; using neutral tone.', error);
    return fallback;
  }
}

export function buildToneLut(analysis = {}, settings = {}) {
  const wb = Array.isArray(analysis.wb) ? analysis.wb : [1, 1, 1];
  const exposure = analysis.exposure || 1;
  const baseContrast = analysis.contrast || 1;
  const userContrast = clamp(Number(settings.contrast) || 0, -100, 100) / 100;
  const userBrightness = clamp(Number(settings.brightness) || 0, -100, 100) / 100;
  const scale = baseContrast * (1 + userContrast * 0.5);
  const offset = userBrightness * 0.1;

  const lut = new Uint8ClampedArray(768);
  for (let channel = 0; channel < 3; channel += 1) {
    const gain = exposure * (wb[channel] || 1);
    for (let value = 0; value < 256; value += 1) {
      let normalised = (value / 255) * gain;
      normalised = (normalised - 0.5) * scale + 0.5 + offset;
      lut[channel * 256 + value] = Math.round(clamp(normalised, 0, 1) * 255);
    }
  }
  return lut;
}

/**
 * Luminance-only unsharp mask. Sharpening luminance instead of each channel
 * avoids coloured fringing around eyes and hair.
 */
function applyUnsharpMask(data, width, height, amount) {
  if (width < 3 || height < 3 || amount <= 0) return;
  const length = width * height;
  const luminance = new Float32Array(length);
  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    luminance[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const horizontal = new Float32Array(length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      const left = luminance[row + Math.max(0, x - 1)];
      const right = luminance[row + Math.min(width - 1, x + 1)];
      horizontal[i] = (left + luminance[i] * 2 + right) * 0.25;
    }
  }

  const blurred = new Float32Array(length);
  for (let y = 0; y < height; y += 1) {
    const above = Math.max(0, y - 1) * width;
    const below = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      blurred[row + x] =
        (horizontal[above + x] + horizontal[row + x] * 2 + horizontal[below + x]) *
        0.25;
    }
  }

  const strength = clamp(amount, 0, 1.2);
  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    const detail = (luminance[i] - blurred[i]) * strength;
    if (detail === 0) continue;
    data[p] = clamp(data[p] + detail, 0, 255);
    data[p + 1] = clamp(data[p + 1] + detail, 0, 255);
    data[p + 2] = clamp(data[p + 2] + detail, 0, 255);
  }
}

export function applyEnhancement(imageData, analysis, settings) {
  const { data, width, height } = imageData;
  const lut = buildToneLut(analysis, settings);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[256 + data[i + 1]];
    data[i + 2] = lut[512 + data[i + 2]];
  }
  const sharpness = clamp(Number(settings.sharpness) || 0, 0, 100);
  if (sharpness > 0) {
    applyUnsharpMask(data, width, height, (sharpness / 100) * 1.1);
  }
  return imageData;
}

function filledCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/**
 * Render the crop at exactly 7:9. targetWidth should be a multiple of 7 so the
 * pixel geometry is exact as well.
 */
export function renderCrop(source, cropRect, targetWidth, options = {}) {
  const width = Math.max(7, Math.round(targetWidth / 7) * 7);
  const height = (width * 9) / 7;
  const { canvas, context } = filledCanvas(width, height);

  const sx = clamp(cropRect.sx, 0, Math.max(0, source.width - 1));
  const sy = clamp(cropRect.sy, 0, Math.max(0, source.height - 1));
  const sw = clamp(cropRect.width, 1, source.width - sx);
  const sh = clamp(cropRect.height, 1, source.height - sy);

  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

  if (options.enhance) {
    const imageData = context.getImageData(0, 0, width, height);
    applyEnhancement(imageData, options.analysis, options.settings || {});
    context.putImageData(imageData, 0, 0);
  }
  return canvas;
}

/** Enhanced (or original) whole photo for the crop editor background. */
export function renderEditorImage(source, options = {}) {
  const maxSide = options.maxSide || 1500;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const { canvas, context } = filledCanvas(width, height);
  context.drawImage(source, 0, 0, width, height);

  if (options.enhance) {
    const imageData = context.getImageData(0, 0, width, height);
    applyEnhancement(imageData, options.analysis, options.settings || {});
    context.putImageData(imageData, 0, 0);
  }
  return canvas;
}

export function canvasToDataUrl(canvas, quality = 0.94) {
  return canvas.toDataURL('image/jpeg', quality);
}
