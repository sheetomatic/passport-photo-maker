/**
 * geometry.js — the single source of truth for every physical dimension.
 *
 * Photos are always 35 x 45 mm on A4 portrait. The layout supports a
 * configurable quantity and gap; rows are balanced and centred, and the whole
 * block is top-aligned by default. The default (6 photos, 0 mm gap) is the
 * exact edge-to-edge six-up row.
 */

export const PAGE = Object.freeze({ widthMm: 210, heightMm: 297 });
export const PHOTO = Object.freeze({
  widthMm: 35,
  heightMm: 45,
  aspect: 7 / 9,
  count: 6,
});
export const PLACEMENTS = Object.freeze({ TOP: 'top', CENTRE: 'centre' });

export const LIMITS = Object.freeze({
  photoCount: { min: 1, max: 24, step: 1, default: 6 },
  gapMm: { min: 0, max: 8, step: 0.5, default: 0 },
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
    layout.photoCount,
    layout.gapMm.toFixed(5),
    layout.photoWidthMm.toFixed(5),
    layout.photoHeightMm.toFixed(5),
    layout.blockX.toFixed(5),
    layout.blockY.toFixed(5),
  ].join(':');
}

/**
 * Compute the A4 sheet.
 *
 * With 35 mm photos and no gap, six fit exactly across the 210 mm width.
 * Adding a gap wraps the block into balanced rows, because six 35 mm photos
 * plus gaps cannot fit in one row. Every photo stays exactly 35 x 45 mm.
 */
export function computeLayout(input = {}) {
  const requestedCount = Math.round(
    numberOr(input.photoCount, LIMITS.photoCount.default),
  );
  const photoCount = clamp(requestedCount, LIMITS.photoCount.min, LIMITS.photoCount.max);
  const gapMm = clamp(
    numberOr(input.gapMm, LIMITS.gapMm.default),
    LIMITS.gapMm.min,
    LIMITS.gapMm.max,
  );
  const verticalPlacement =
    input.verticalPlacement === PLACEMENTS.CENTRE ? PLACEMENTS.CENTRE : PLACEMENTS.TOP;
  const nudgeMm = clamp(
    numberOr(input.verticalOffsetMm, LIMITS.verticalOffsetMm.default),
    LIMITS.verticalOffsetMm.min,
    LIMITS.verticalOffsetMm.max,
  );

  const photoWidthMm = PHOTO.widthMm;
  const photoHeightMm = PHOTO.heightMm;

  // A gap consumes horizontal space, so fewer photos fit per row.
  const maxColumns = Math.max(
    1,
    Math.floor((PAGE.widthMm + gapMm) / (photoWidthMm + gapMm)),
  );
  const rows = Math.ceil(photoCount / maxColumns);
  const columns = Math.ceil(photoCount / rows);

  const blockWidth = columns * photoWidthMm + Math.max(0, columns - 1) * gapMm;
  const blockHeight = rows * photoHeightMm + Math.max(0, rows - 1) * gapMm;
  const blockX = (PAGE.widthMm - blockWidth) / 2;
  const centredY = (PAGE.heightMm - blockHeight) / 2;
  const baseY = verticalPlacement === PLACEMENTS.CENTRE ? centredY : 0;
  const blockY = clamp(baseY + nudgeMm, 0, PAGE.heightMm - blockHeight);

  const photos = [];
  for (let row = 0; row < rows; row += 1) {
    const countInRow = Math.min(columns, photoCount - row * columns);
    const rowWidth =
      countInRow * photoWidthMm + Math.max(0, countInRow - 1) * gapMm;
    const rowX = blockX + (blockWidth - rowWidth) / 2;
    const y = blockY + row * (photoHeightMm + gapMm);
    for (let column = 0; column < countInRow; column += 1) {
      photos.push({
        index: photos.length,
        row,
        column,
        x: rowX + column * (photoWidthMm + gapMm),
        y,
        widthMm: photoWidthMm,
        heightMm: photoHeightMm,
      });
    }
  }

  const withinPage =
    blockX >= -1e-9 &&
    blockX + blockWidth <= PAGE.widthMm + 1e-9 &&
    blockY >= -1e-9 &&
    blockY + blockHeight <= PAGE.heightMm + 1e-9;

  return {
    pageWidthMm: PAGE.widthMm,
    pageHeightMm: PAGE.heightMm,
    photoCount,
    requestedPhotoCount: requestedCount,
    photoWidthMm,
    photoHeightMm,
    gapMm,
    columns,
    rows,
    maxColumns,
    blockX,
    blockY,
    blockWidth,
    blockHeight,
    centredBlockY: centredY,
    verticalPlacement,
    appliedOffsetMm: blockY - baseY,
    nudgeMm,
    sideMarginMm: blockX,
    topMarginMm: blockY,
    bottomWhitespaceMm: PAGE.heightMm - (blockY + blockHeight),
    photos,
    withinPage,
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
 * Cut guides, in millimetres. Corner marks trace each photo without covering
 * the centre; hairlines follow every photo edge.
 */
export function buildGuideSegments(layout, style = 'cutmarks') {
  if (!style || style === 'none') return [];
  const segments = [];
  const tick = 2.4;

  if (style === 'hairline') {
    for (const photo of layout.photos) {
      const { x, y, widthMm, heightMm } = photo;
      segments.push(
        { x1: x, y1: y, x2: x + widthMm, y2: y },
        { x1: x, y1: y + heightMm, x2: x + widthMm, y2: y + heightMm },
        { x1: x, y1: y, x2: x, y2: y + heightMm },
        { x1: x + widthMm, y1: y, x2: x + widthMm, y2: y + heightMm },
      );
    }
    return segments;
  }

  if (style === 'cutmarks') {
    for (const photo of layout.photos) {
      const { x, y, widthMm, heightMm } = photo;
      const T = Math.min(tick, widthMm / 3, heightMm / 3);
      segments.push(
        { x1: x, y1: y, x2: x + T, y2: y },
        { x1: x, y1: y, x2: x, y2: y + T },
        { x1: x + widthMm - T, y1: y, x2: x + widthMm, y2: y },
        { x1: x + widthMm, y1: y, x2: x + widthMm, y2: y + T },
        { x1: x, y1: y + heightMm - T, x2: x, y2: y + heightMm },
        { x1: x, y1: y + heightMm, x2: x + T, y2: y + heightMm },
        { x1: x + widthMm - T, y1: y + heightMm, x2: x + widthMm, y2: y + heightMm },
        { x1: x + widthMm, y1: y + heightMm - T, x2: x + widthMm, y2: y + heightMm },
      );
    }
  }

  return segments;
}

/** Physical truth checks, surfaced in the UI and enforced before export. */
export function verifyLayout(layout) {
  const count = layout.photos.length;
  const ratiosExact = layout.photos.every(
    (photo) => Math.abs(photo.widthMm / photo.heightMm - PHOTO.aspect) < 1e-9,
  );
  const pageOk = layout.pageWidthMm === 210 && layout.pageHeightMm === 297;
  const dimsOk = layout.photos.every(
    (photo) =>
      Math.abs(photo.widthMm - PHOTO.widthMm) < 1e-9 &&
      Math.abs(photo.heightMm - PHOTO.heightMm) < 1e-9,
  );
  const gapsOk = (() => {
    if (layout.photoCount < 2) return true;
    for (const photo of layout.photos) {
      const sameRow = layout.photos.find(
        (candidate) =>
          candidate.row === photo.row && candidate.column === photo.column + 1,
      );
      if (sameRow) {
        const gap = sameRow.x - (photo.x + photo.widthMm);
        if (Math.abs(gap - layout.gapMm) > 1e-9) return false;
      }
      const below = layout.photos.find(
        (candidate) =>
          candidate.row === photo.row + 1 && candidate.column === photo.column,
      );
      if (below) {
        const gap = below.y - (photo.y + photo.heightMm);
        if (Math.abs(gap - layout.gapMm) > 1e-9) return false;
      }
    }
    return true;
  })();
  const inside = layout.photos.every(
    (photo) =>
      photo.x >= -1e-9 &&
      photo.x + photo.widthMm <= 210 + 1e-9 &&
      photo.y >= -1e-9 &&
      photo.y + photo.heightMm <= 297 + 1e-9,
  );
  const blockFits =
    layout.blockX >= -1e-9 &&
    layout.blockX + layout.blockWidth <= 210 + 1e-9 &&
    layout.blockY >= -1e-9 &&
    layout.blockY + layout.blockHeight <= 297 + 1e-9;

  const checks = [
    { id: 'page', label: 'A4 portrait page 210 × 297 mm', pass: pageOk },
    {
      id: 'count',
      label: `${layout.photoCount} passport photo${layout.photoCount === 1 ? '' : 's'} on the sheet`,
      pass: count === layout.photoCount,
    },
    { id: 'dims', label: 'Every photo is exactly 35 × 45 mm', pass: dimsOk },
    { id: 'ratio', label: 'Every crop is exactly 7:9 (no stretch)', pass: ratiosExact },
    { id: 'gaps', label: 'Gaps match the selected spacing', pass: gapsOk },
    {
      id: 'inside',
      label: 'All photos sit inside the sheet',
      pass: inside && blockFits && layout.withinPage,
    },
  ];

  return { checks, allPass: checks.every((check) => check.pass) };
}
