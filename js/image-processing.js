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
  strength: 80,
  brightness: 0,
  contrast: 5,
  warmth: 0,
  sharpness: 50,
  smoothing: 30,
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
      clamp(greyTarget / Math.max(0.02, meanR), 0.88, 1.15),
      clamp(greyTarget / Math.max(0.02, meanG), 0.88, 1.15),
      clamp(greyTarget / Math.max(0.02, meanB), 0.88, 1.15),
    ];
    // Keep some of the scene's colour so indoor light still looks natural, but
    // correct enough of the cast to make skin tones believable.
    const wb = rawWb.map((gain) => 1 + (gain - 1) * 0.75);

    const rawExposure = clamp(0.585 / Math.max(0.08, meanLum), 0.75, 1.35);
    const exposure = 1 + (rawExposure - 1) * 0.8;

    // A mild percentile stretch gives the print more presence than the flat,
    // phone-camera default without crushing highlights.
    const range = Math.max(0.15, p98 - p2);
    const rawContrast = clamp(0.8 / range, 0.85, 1.55);
    const contrast = 1 + (rawContrast - 1) * 0.7;

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
  const strength = clamp(Number(settings.strength ?? 70), 0, 100) / 100;
  const userContrast = clamp(Number(settings.contrast) || 0, -100, 100) / 100;
  const userBrightness = clamp(Number(settings.brightness) || 0, -100, 100) / 100;
  const warmth = clamp(Number(settings.warmth) || 0, -30, 30) / 30;

  // Warmth is a manual colour control, so it still works at strength 0.
  const warmthGain = [1 + warmth * 0.06, 1, 1 - warmth * 0.08];
  const lut = new Uint8ClampedArray(768);

  for (let channel = 0; channel < 3; channel += 1) {
    const gain = exposure * (wb[channel] || 1);
    for (let value = 0; value < 256; value += 1) {
      const base = value / 255;
      let auto = base * gain;
      auto = (auto - 0.5) * baseContrast + 0.5;
      // A gentle S-curve adds a filmic shoulder without hard clipping.
      const smooth = auto <= 0 ? 0 : auto >= 1 ? 1 : auto * auto * (3 - 2 * auto);
      auto = auto * 0.85 + smooth * 0.15;
      auto = clamp(auto, 0, 1);

      let normalised = base * (1 - strength) + auto * strength;
      normalised *= warmthGain[channel];
      normalised = (normalised - 0.5) * (1 + userContrast * 0.55) + 0.5;
      normalised += userBrightness * 0.11;
      lut[channel * 256 + value] = Math.round(clamp(normalised, 0, 1) * 255);
    }
  }
  return lut;
}

/**
 * Separable box blur over luminance, with clamped edges. Two scales are used:
 * a 1 px radius for detail and a wider radius for local contrast (clarity).
 */
function boxBlurLuminance(source, width, height, radius) {
  if (radius <= 0) return source.slice();
  const length = width * height;
  const temporary = new Float32Array(length);
  const output = new Float32Array(length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += source[row + clamp(offset, 0, width - 1)];
    }
    for (let x = 0; x < width; x += 1) {
      temporary[row + x] = sum / window;
      const incoming = clamp(x + radius + 1, 0, width - 1);
      const outgoing = clamp(x - radius, 0, width - 1);
      sum += source[row + incoming] - source[row + outgoing];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += temporary[clamp(offset, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window;
      const incoming = clamp(y + radius + 1, 0, height - 1);
      const outgoing = clamp(y - radius, 0, height - 1);
      sum += temporary[incoming * width + x] - temporary[outgoing * width + x];
    }
  }

  return output;
}

/**
 * Two-scale luminance enhancement:
 *  - fine detail for eyes, hair and fabric
 *  - wider local contrast so the face does not look flat
 * The delta is applied equally to RGB, preserving colour.
 */
function applyDetailEnhancement(data, width, height, detailAmount, clarityAmount) {
  const length = width * height;
  const luminance = new Float32Array(length);
  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    luminance[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  const fine = boxBlurLuminance(luminance, width, height, 1);
  const coarse = boxBlurLuminance(
    luminance,
    width,
    height,
    Math.max(2, Math.round(width / 260)),
  );

  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    const delta = clamp(
      (luminance[i] - fine[i]) * detailAmount +
        (luminance[i] - coarse[i]) * clarityAmount,
      -24,
      24,
    );
    if (Math.abs(delta) < 0.1) continue;
    data[p] = clamp(data[p] + delta, 0, 255);
    data[p + 1] = clamp(data[p + 1] + delta, 0, 255);
    data[p + 2] = clamp(data[p + 2] + delta, 0, 255);
  }
}

function applySaturation(data, strength) {
  const factor = 1 + 0.06 * strength;
  if (factor <= 1.0001) return;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = clamp(luminance + (r - luminance) * factor, 0, 255);
    data[i + 1] = clamp(luminance + (g - luminance) * factor, 0, 255);
    data[i + 2] = clamp(luminance + (b - luminance) * factor, 0, 255);
  }
}

function boxBlurPlane(source, width, height, radius) {
  if (radius <= 0) return source.slice();
  const length = width * height;
  const temporary = new Float32Array(length);
  const output = new Float32Array(length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += source[row + clamp(offset, 0, width - 1)];
    }
    for (let x = 0; x < width; x += 1) {
      temporary[row + x] = sum / window;
      sum +=
        source[row + clamp(x + radius + 1, 0, width - 1)] -
        source[row + clamp(x - radius, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      sum += temporary[clamp(offset, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window;
      sum +=
        temporary[clamp(y + radius + 1, 0, height - 1) * width + x] -
        temporary[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return output;
}

function isSkinPixel(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 35 && cb >= 76 && cb <= 128 && cr >= 132 && cr <= 176 && r > g;
}

/**
 * Low-strength edge-aware smoothing confined to skin-coloured, low-detail
 * pixels. Eyes, eyebrows, hair and clothing are excluded, so this cleans up
 * complexion noise without turning the face into a beauty filter.
 */
function applySkinSmoothing(data, width, height, amount) {
  if (amount <= 0) return;
  const radius = Math.max(1, Math.round(width / 420));
  const length = width * height;
  const red = new Float32Array(length);
  const green = new Float32Array(length);
  const blue = new Float32Array(length);
  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    red[i] = data[p];
    green[i] = data[p + 1];
    blue[i] = data[p + 2];
  }

  const blurRed = boxBlurPlane(red, width, height, radius);
  const blurGreen = boxBlurPlane(green, width, height, radius);
  const blurBlue = boxBlurPlane(blue, width, height, radius);
  const blurLum = new Float32Array(length);
  const originalLum = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    originalLum[i] = 0.299 * red[i] + 0.587 * green[i] + 0.114 * blue[i];
    blurLum[i] = 0.299 * blurRed[i] + 0.587 * blurGreen[i] + 0.114 * blurBlue[i];
  }

  for (let i = 0, p = 0; i < length; i += 1, p += 4) {
    if (!isSkinPixel(data[p], data[p + 1], data[p + 2])) continue;
    const detail = Math.abs(originalLum[i] - blurLum[i]);
    const flatness = clamp(1 - detail / 24, 0, 1);
    const blend = amount * 0.55 * flatness;
    if (blend <= 0.002) continue;
    data[p] = data[p] * (1 - blend) + blurRed[i] * blend;
    data[p + 1] = data[p + 1] * (1 - blend) + blurGreen[i] * blend;
    data[p + 2] = data[p + 2] * (1 - blend) + blurBlue[i] * blend;
  }
}

export function applyEnhancement(imageData, analysis, settings) {
  const { data, width, height } = imageData;
  const strength = clamp(Number(settings.strength ?? 70), 0, 100) / 100;
  const sharpness = clamp(Number(settings.sharpness) || 0, 0, 100);
  const lut = buildToneLut(analysis, settings);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[256 + data[i + 1]];
    data[i + 2] = lut[512 + data[i + 2]];
  }

  applySaturation(data, strength);

  const smoothing = clamp(Number(settings.smoothing) || 0, 0, 100) / 100;
  if (smoothing > 0) {
    applySkinSmoothing(data, width, height, smoothing);
  }

  const detailAmount = (sharpness / 100) * 1.2;
  const clarityAmount = strength * 0.18;
  if (detailAmount > 0 || clarityAmount > 0) {
    applyDetailEnhancement(data, width, height, detailAmount, clarityAmount);
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

function hexToRgb(color) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(color || '').trim());
  if (!match) return [255, 255, 255];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/**
 * Replace the background of an already-rendered subject canvas using a
 * confidence mask aligned to the source image. The mask is resampled to the
 * output crop and softened at the edges before a per-pixel composite, so hair
 * does not get a hard staircase edge.
 */
export function compositeBackground(canvas, maskCanvas, options = {}) {
  if (!maskCanvas || !canvas) return canvas;
  const {
    cropRect = null,
    sourceWidth,
    sourceHeight,
    color = '#ffffff',
    feather = 35,
  } = options;

  if (!sourceWidth || !sourceHeight) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const soft = clamp(feather / 100, 0, 1);

  const maskLayer = document.createElement('canvas');
  maskLayer.width = width;
  maskLayer.height = height;
  const maskContext = maskLayer.getContext('2d', { willReadFrequently: true });
  maskContext.imageSmoothingEnabled = true;
  maskContext.imageSmoothingQuality = 'high';
  const blur = (0.5 + soft * 1.4) * (width / 826);
  if (blur > 0.1) maskContext.filter = `blur(${blur}px)`;

  const scaleX = maskCanvas.width / sourceWidth;
  const scaleY = maskCanvas.height / sourceHeight;
  const sx = (cropRect?.sx || 0) * scaleX;
  const sy = (cropRect?.sy || 0) * scaleY;
  const sw = (cropRect?.width || sourceWidth) * scaleX;
  const sh = (cropRect?.height || sourceHeight) * scaleY;
  maskContext.drawImage(maskCanvas, sx, sy, sw, sh, 0, 0, width, height);

  const maskData = maskContext.getImageData(0, 0, width, height).data;
  const subject = context.getImageData(0, 0, width, height);
  const pixels = subject.data;
  const [bgR, bgG, bgB] = hexToRgb(color);
  const low = 0.5 - soft * 0.35;
  const high = 0.5 + soft * 0.35;

  for (let i = 0, p = 0; i < maskData.length; i += 4, p += 4) {
    let alpha = maskData[i] / 255;
    if (high - low < 1e-5) {
      alpha = alpha >= 0.5 ? 1 : 0;
    } else {
      const t = clamp((alpha - low) / (high - low), 0, 1);
      alpha = t * t * (3 - 2 * t);
    }
    const backgroundWeight = 1 - alpha;
    if (backgroundWeight < 0.0005) continue;
    pixels[p] = pixels[p] * alpha + bgR * backgroundWeight;
    pixels[p + 1] = pixels[p + 1] * alpha + bgG * backgroundWeight;
    pixels[p + 2] = pixels[p + 2] * alpha + bgB * backgroundWeight;
  }

  context.putImageData(subject, 0, 0);
  return canvas;
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

  if (options.background?.enabled && options.maskCanvas) {
    compositeBackground(canvas, options.maskCanvas, {
      cropRect: { sx, sy, width: sw, height: sh },
      sourceWidth: source.width,
      sourceHeight: source.height,
      color: options.background.color,
      feather: options.background.feather,
    });
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

  if (options.background?.enabled && options.maskCanvas) {
    compositeBackground(canvas, options.maskCanvas, {
      cropRect: null,
      sourceWidth: source.width,
      sourceHeight: source.height,
      color: options.background.color,
      feather: options.background.feather,
    });
  }
  return canvas;
}

export function canvasToDataUrl(canvas, quality = 0.94) {
  return canvas.toDataURL('image/jpeg', quality);
}
