/**
 * geometry.js — the single source of truth for every physical dimension.
 *
 * Everything is expressed in millimetres. The preview, the PDF and the print
 * document all consume `computeLayout()` so they cannot drift apart.
 */

export const PAGE = Object.freeze({ widthMm: 210, heightMm: 297 });
export const PHOTO = Object.freeze({
  widthMm: 35,
  heightMm: 45,
  aspect: 7 / 9, // width / height
  count: 6,
});
export const MODES = Object.freeze({ EXACT: 'exact', SAFE: 'safe' });
export const PLACEMENTS = Object.freeze({ TOP: 'top', CENTRE: 'centre' });
export const GUIDE_STYLES = Object.freeze(['cutmarks', 'hairline', 'none']);

export const LIMITS = Object.freeze({
  safeMarginMm: { min: 0, max: 15, step: 0.5, default: 6 },
  gapMm: { min: 0, max: 8, step: 0.25, default: 2 },
  verticalOffsetMm: { min: 0, max: 80, step: 1, default: 0 },
  zoom: { min: 1, max: 4 },
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

/** Two decimal places, for UI and measurement labels. */
export function mm(value) {
  return `${value.toFixed(2)} mm`;
}

/** A stable key so exports can be cached and invalidated honestly. */
export function layoutKey(layout) {
  return [
    layout.mode,
    layout.photoWidthMm.toFixed(5),
    layout.photoHeightMm.toFixed(5),
    layout.gapMm.toFixed(5),
    layout.sideMarginMm.toFixed(5),
    layout.rowY.toFixed(5),
  ].join(':');
}

/**
 * Compute the A4 sheet.
 *
 * EXACT: photo width is exactly 35 mm. Six of them span 210 mm, so margins and
 * gaps must both be zero — the maths has no other solution. A4 height is 297,
 * the row is 45 mm, so centring puts it at 126 mm.
 *
 * SAFE: the six photos must fit inside `210 - 2 * margin`, with five gaps.
 * width = (210 - 2m - 5g) / 6 and height always follows the 7:9 ratio, so the
 * photos are smaller than 35 x 45 and the UI must say so.
 *
 * The row is top-aligned by default. In EXACT mode that means y = 0 (the row
 * starts at the paper's top edge); in SAFE mode it starts at the configured
 * safe margin so the printer can reproduce it. `verticalPlacement: 'centre'`
 * restores the 126 mm centred position, and the nudge only ever moves down.
 */
export function computeLayout(input = {}) {
  const mode = input.mode === MODES.SAFE ? MODES.SAFE : MODES.EXACT;
  const safeMarginMm = clamp(
    numberOr(input.safeMarginMm, LIMITS.safeMarginMm.default),
    LIMITS.safeMarginMm.min,
    LIMITS.safeMarginMm.max,
  );
  const requestedGapMm = clamp(
    numberOr(input.gapMm, LIMITS.gapMm.default),
    LIMITS.gapMm.min,
    LIMITS.gapMm.max,
  );
  const nudgeMm = clamp(
    numberOr(input.verticalOffsetMm, LIMITS.verticalOffsetMm.default),
    LIMITS.verticalOffsetMm.min,
    LIMITS.verticalOffsetMm.max,
  );
  const verticalPlacement =
    input.verticalPlacement === PLACEMENTS.CENTRE ? PLACEMENTS.CENTRE : PLACEMENTS.TOP;

  let photoWidthMm;
  let gapMm;
  let sideMarginMm;

  if (mode === MODES.EXACT) {
    photoWidthMm = PHOTO.widthMm;
    gapMm = 0;
    sideMarginMm = 0;
  } else {
    sideMarginMm = safeMarginMm;
    gapMm = requestedGapMm;
    const usableWidth = PAGE.widthMm - sideMarginMm * 2 - gapMm * (PHOTO.count - 1);
    photoWidthMm = Math.max(10, usableWidth / PHOTO.count);
  }

  const photoHeightMm = (photoWidthMm * PHOTO.heightMm) / PHOTO.widthMm;
  const rowWidthMm = photoWidthMm * PHOTO.count + gapMm * (PHOTO.count - 1);
  const rowX = (PAGE.widthMm - rowWidthMm) / 2;
  const centredRowY = (PAGE.heightMm - photoHeightMm) / 2;
  const topBaseY = mode === MODES.SAFE ? sideMarginMm : 0;
  const baseRowY = verticalPlacement === PLACEMENTS.CENTRE ? centredRowY : topBaseY;
  const rowY = clamp(baseRowY + nudgeMm, 0, PAGE.heightMm - photoHeightMm);

  const photos = Array.from({ length: PHOTO.count }, (_, index) => ({
    index,
    x: rowX + index * (photoWidthMm + gapMm),
    y: rowY,
    widthMm: photoWidthMm,
    heightMm: photoHeightMm,
  }));

  const isReduced = photoWidthMm < PHOTO.widthMm - 1e-9;
  const withinPage =
    rowX >= -1e-9 &&
    rowX + rowWidthMm <= PAGE.widthMm + 1e-9 &&
    rowY >= -1e-9 &&
    rowY + photoHeightMm <= PAGE.heightMm + 1e-9;

  return {
    mode,
    pageWidthMm: PAGE.widthMm,
    pageHeightMm: PAGE.heightMm,
    photoCount: PHOTO.count,
    photoWidthMm,
    photoHeightMm,
    requestedPhotoWidthMm: PHOTO.widthMm,
    isReduced,
    reductionMm: PHOTO.widthMm - photoWidthMm,
    gapMm,
    sideMarginMm,
    rowX,
    rowY,
    rowWidthMm,
    rowHeightMm: photoHeightMm,
    centredRowY,
    verticalPlacement,
    baseRowY,
    appliedOffsetMm: rowY - baseRowY,
    nudgeMm,
    horizontalWhitespaceMm: rowX, // equals sideMarginMm by construction
    verticalWhitespaceMm: rowY,
    totalPhotoWidthMm: photoWidthMm * PHOTO.count,
    bottomWhitespaceMm: PAGE.heightMm - (rowY + photoHeightMm),
    edgeToEdge: mode === MODES.EXACT,
    withinPage,
    photos,
  };
}

/**
 * The rendered crop must itself be exactly 7:9. Pick a pixel width that is a
 * multiple of 7 so the integer height (width * 9 / 7) is exact.
 */
export function pixelSizeForPhoto(widthMm, dpi) {
  const raw = (widthMm / 25.4) * dpi;
  const width = Math.max(7, Math.round(raw / 7) * 7);
  const height = (width * 9) / 7;
  return {
    width,
    height,
    effectiveDpi: width / (widthMm / 25.4),
  };
}

/**
 * Cut guides, in millimetres, as plain line segments. Used by the preview SVG,
 * the PDF (jsPDF lines) and the print document (SVG) alike.
 */
export function buildGuideSegments(layout, style = 'cutmarks') {
  if (!style || style === 'none') return [];
  const segments = [];
  const { photos, rowX, rowY, rowWidthMm, rowHeightMm } = layout;
  const pageW = layout.pageWidthMm;
  const pageH = layout.pageHeightMm;

  if (style === 'hairline') {
    const xs = new Set();
    for (const photo of photos) {
      xs.add(photo.x);
      xs.add(photo.x + photo.widthMm);
    }
    for (const x of xs) {
      if (x > 0.05 && x < pageW - 0.05) {
        segments.push({ x1: x, y1: rowY, x2: x, y2: rowY + rowHeightMm });
      }
    }
    segments.push({ x1: rowX, y1: rowY, x2: rowX + rowWidthMm, y2: rowY });
    segments.push({
      x1: rowX,
      y1: rowY + rowHeightMm,
      x2: rowX + rowWidthMm,
      y2: rowY + rowHeightMm,
    });
  } else if (style === 'cutmarks') {
    const boundaries = new Set();
    for (const photo of photos) {
      boundaries.add(photo.x);
      boundaries.add(photo.x + photo.widthMm);
    }
    const tick = 4;
    for (const x of boundaries) {
      const topStart = Math.max(0, rowY - tick);
      const bottomEnd = Math.min(pageH, rowY + rowHeightMm + tick);
      if (rowY - topStart > 0.4) {
        segments.push({ x1: x, y1: topStart, x2: x, y2: rowY - 0.8 });
      }
      if (bottomEnd - (rowY + rowHeightMm) > 0.4) {
        segments.push({
          x1: x,
          y1: rowY + rowHeightMm + 0.8,
          x2: x,
          y2: bottomEnd,
        });
      }
    }
  }

  return segments;
}

/** Physical truth checks, surfaced in the UI and enforced before export. */
export function verifyLayout(layout) {
  const count = layout.photos.length;
  const rowAligned = layout.photos.every(
    (photo) => Math.abs(photo.y - layout.rowY) < 1e-9,
  );
  const ratiosExact = layout.photos.every(
    (photo) => Math.abs(photo.widthMm / photo.heightMm - PHOTO.aspect) < 1e-9,
  );
  const rowMath =
    Math.abs(
      layout.photos.reduce((sum, photo) => sum + photo.widthMm, 0) +
        layout.gapMm * (count - 1) -
        layout.rowWidthMm,
    ) < 1e-9;
  const pageOk = layout.pageWidthMm === 210 && layout.pageHeightMm === 297;
  const inside = layout.photos.every(
    (photo) =>
      photo.x >= -1e-9 &&
      photo.x + photo.widthMm <= 210 + 1e-9 &&
      photo.y >= -1e-9 &&
      photo.y + photo.heightMm <= 297 + 1e-9,
  );
  const dimsOk =
    layout.mode === MODES.EXACT
      ? Math.abs(layout.photoWidthMm - 35) < 1e-9 &&
        Math.abs(layout.photoHeightMm - 45) < 1e-9 &&
        layout.gapMm === 0 &&
        layout.sideMarginMm === 0
      : layout.photoWidthMm <= 35 + 1e-9;

  const checks = [
    { id: 'page', label: 'A4 portrait page 210 × 297 mm', pass: pageOk },
    { id: 'count', label: 'Six photos in one horizontal row', pass: count === 6 && rowAligned },
    { id: 'dims', label: 'Photo dimensions match the selected mode', pass: dimsOk },
    { id: 'ratio', label: 'Every crop is exactly 7:9 (no stretch)', pass: ratiosExact },
    { id: 'row', label: 'Row width = photos + gaps', pass: rowMath },
    { id: 'inside', label: 'All photos sit inside the sheet', pass: inside && layout.withinPage },
  ];

  return { checks, allPass: checks.every((check) => check.pass) };
}
