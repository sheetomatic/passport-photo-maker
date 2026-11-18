/**
 * crop.js — pure crop maths for a configurable width:height frame.
 *
 * The crop window is represented in source-image pixels by its centre (cx, cy)
 * and a zoom factor. At zoom 1 the window covers the largest rectangle with the
 * selected aspect ratio that fits inside the photo (cover), so there is never
 * any empty space. The default aspect is 35:45.
 */

import { clamp, LIMITS } from '#app/geometry';

export const CROP_ASPECT = 7 / 9; // default 35:45 width / height

function validAspect(value) {
  const aspect = Number(value);
  return Number.isFinite(aspect) && aspect > 0 ? aspect : CROP_ASPECT;
}

/** Largest rectangle with the selected aspect that fits inside the photo. */
export function baseCropWidthFor(imageWidth, imageHeight, aspect = CROP_ASPECT) {
  return Math.min(imageWidth, imageHeight * validAspect(aspect));
}

export function cropWindow(state) {
  const aspect = validAspect(state.aspect);
  const baseWidth = baseCropWidthFor(state.imageWidth, state.imageHeight, aspect);
  const zoom = clamp(state.zoom, LIMITS.zoom.min, LIMITS.zoom.max);
  const cropWidth = baseWidth / zoom;
  const cropHeight = cropWidth / aspect;
  return {
    baseWidth,
    cropWidth,
    cropHeight,
    aspect,
    zoom,
    minCropWidth: baseWidth / LIMITS.zoom.max,
  };
}

export function clampCrop(state) {
  const { cropWidth, cropHeight, aspect, zoom } = cropWindow(state);
  const cx = clamp(state.cx, cropWidth / 2, state.imageWidth - cropWidth / 2);
  const cy = clamp(state.cy, cropHeight / 2, state.imageHeight - cropHeight / 2);
  return {
    imageWidth: state.imageWidth,
    imageHeight: state.imageHeight,
    aspect,
    zoom,
    cx,
    cy,
  };
}

export function createCropState(imageWidth, imageHeight, options = {}) {
  const zoom = clamp(options.zoom ?? 1, LIMITS.zoom.min, LIMITS.zoom.max);
  return clampCrop({
    imageWidth,
    imageHeight,
    aspect: validAspect(options.aspect),
    zoom,
    cx: options.cx ?? imageWidth / 2,
    cy: options.cy ?? imageHeight / 2,
  });
}

/** Change the frame aspect while keeping the same centre and zoom. */
export function setCropAspect(state, aspect) {
  return clampCrop({ ...state, aspect: validAspect(aspect) });
}

/** Source-pixel rectangle handed to canvas drawImage(). */
export function getCropRect(state) {
  const { cropWidth, cropHeight, aspect } = cropWindow(state);
  const clamped = clampCrop(state);
  const sx = clamp(clamped.cx - cropWidth / 2, 0, state.imageWidth - cropWidth);
  const sy = clamp(clamped.cy - cropHeight / 2, 0, state.imageHeight - cropHeight);
  return {
    sx,
    sy,
    width: cropWidth,
    height: cropHeight,
    cx: clamped.cx,
    cy: clamped.cy,
    aspect,
    zoom: clamped.zoom,
  };
}

export function setCropZoom(state, zoom, anchor) {
  const next = clamp(zoom, LIMITS.zoom.min, LIMITS.zoom.max);
  return clampCrop({ ...state, ...(anchor ?? {}), zoom: next });
}

/** dxPx / dyPx are drag deltas measured in the on-screen crop frame. */
export function panCropByPixels(state, dxPx, dyPx, frameWidthPx) {
  const { cropWidth } = cropWindow(state);
  if (!frameWidthPx) return state;
  // The frame and the crop share the selected aspect, so one conversion works
  // for both axes: moving the image right by N screen pixels moves the crop left
  // by N / (frameWidth / cropWidth) source pixels.
  const pxPerSourcePx = frameWidthPx / cropWidth;
  return clampCrop({
    ...state,
    cx: state.cx - dxPx / pxPerSourcePx,
    cy: state.cy - dyPx / pxPerSourcePx,
  });
}

/**
 * Passport framing from a face box and BlazeFace landmarks.
 *
 * The detector's bounding box is tighter than a "head" (it often starts at the
 * brow), so scaling by box height alone gives clipped hair. Instead:
 *  - scale so the detected face is ~64% of the crop width (head ~60-70%),
 *  - put the eye line at ~48% of the crop height (passport-style headroom),
 *  - centre horizontally on the face.
 * With landmarks this works across hair styles; without them, the box centre is
 * used as a fallback eye line.
 */
export function suggestCropFromFace(
  imageWidth,
  imageHeight,
  faceBox,
  aspect = CROP_ASPECT,
) {
  const frameAspect = validAspect(aspect);
  const { baseWidth } = cropWindow({
    imageWidth,
    imageHeight,
    aspect: frameAspect,
    zoom: 1,
  });
  if (!faceBox || !(faceBox.width > 0) || !(faceBox.height > 0)) {
    return createCropState(imageWidth, imageHeight, { aspect: frameAspect });
  }

  const faceCenterX = faceBox.x + faceBox.width / 2;
  let cropWidth = faceBox.width / 0.64;
  const minWidth = baseWidth / LIMITS.zoom.max;
  cropWidth = clamp(cropWidth, minWidth, baseWidth);
  const cropHeight = cropWidth / frameAspect;

  const eyeY = averageEyeY(faceBox, imageWidth, imageHeight);
  const cropTop = clamp(
    eyeY - cropHeight * 0.48,
    0,
    Math.max(0, imageHeight - cropHeight),
  );
  const zoom = baseWidth / cropWidth;

  return createCropState(imageWidth, imageHeight, {
    aspect: frameAspect,
    zoom,
    cx: faceCenterX,
    cy: cropTop + cropHeight / 2,
  });
}

function averageEyeY(faceBox, imageWidth, imageHeight) {
  const points = Array.isArray(faceBox.keypoints) ? faceBox.keypoints : [];
  if (points.length >= 2) {
    const first = points[0];
    const second = points[1];
    // Tasks Vision returns normalised keypoints (0..1). Be tolerant of either.
    const normalised = first.y <= 1.5 && second.y <= 1.5;
    const scaleY = normalised ? imageHeight : 1;
    const y = ((first.y + second.y) / 2) * scaleY;
    if (Number.isFinite(y) && y > 0) return y;
  }
  // Fallback: eyes sit slightly above the centre of a detected face box.
  return faceBox.y + faceBox.height * 0.42;
}

/** Convert a crop rect to fractional coordinates (used by the DOM preview). */
export function cropFractions(state) {
  const rect = getCropRect(state);
  return {
    x: rect.sx / state.imageWidth,
    y: rect.sy / state.imageHeight,
    width: rect.width / state.imageWidth,
    height: rect.height / state.imageHeight,
  };
}
