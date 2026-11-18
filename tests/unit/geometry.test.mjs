import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLayout,
  verifyLayout,
  pixelSizeForPhoto,
  buildGuideSegments,
  PAGE,
  PHOTO,
  mm,
} from '../../js/geometry.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

test('A4 and passport photo constants are exact', () => {
  assert.equal(PAGE.widthMm, 210);
  assert.equal(PAGE.heightMm, 297);
  assert.equal(PHOTO.widthMm, 35);
  assert.equal(PHOTO.heightMm, 45);
  assert.equal(PHOTO.aspect, 7 / 9);
  assert.equal(PHOTO.count, 6);
});

test('default layout: six 35 x 45 mm photos in one exact top row', () => {
  const layout = computeLayout();

  assert.equal(layout.photoCount, 6);
  assert.equal(layout.photoWidthMm, 35);
  assert.equal(layout.photoHeightMm, 45);
  assert.equal(layout.gapMm, 0);
  assert.equal(layout.columns, 6);
  assert.equal(layout.rows, 1);
  assert.equal(layout.blockWidth, 210);
  assert.equal(layout.blockHeight, 45);
  assert.equal(layout.blockX, 0);
  assert.equal(layout.blockY, 0);
  assert.equal(layout.photos.length, 6);
  assert.ok(layout.withinPage);

  layout.photos.forEach((photo, index) => {
    close(photo.x, index * 35);
    assert.equal(photo.y, 0);
    close(photo.x + photo.widthMm, (index + 1) * 35);
    assert.equal(photo.widthMm, 35);
    assert.equal(photo.heightMm, 45);
  });
  assert.equal(verifyLayout(layout).allPass, true);
});

test('quantity and gap wrap into a balanced, centred grid', () => {
  const layout = computeLayout({ photoCount: 8, gapMm: 2 });

  assert.equal(layout.photoCount, 8);
  assert.equal(layout.gapMm, 2);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 2);
  close(layout.blockWidth, 4 * 35 + 3 * 2); // 146
  close(layout.blockHeight, 2 * 45 + 2); // 92
  close(layout.blockX, (210 - 146) / 2); // 32
  assert.equal(layout.blockY, 0);
  assert.equal(layout.photos.length, 8);
  assert.ok(layout.withinPage);

  for (const photo of layout.photos) {
    assert.equal(photo.widthMm, 35);
    assert.equal(photo.heightMm, 45);
  }
  // Horizontal and vertical gaps are exactly the requested gap.
  for (const photo of layout.photos) {
    const right = layout.photos.find(
      (candidate) => candidate.row === photo.row && candidate.column === photo.column + 1,
    );
    if (right) close(right.x - (photo.x + photo.widthMm), 2);
    const below = layout.photos.find(
      (candidate) => candidate.row === photo.row + 1 && candidate.column === photo.column,
    );
    if (below) close(below.y - (photo.y + photo.heightMm), 2);
  }
  assert.equal(verifyLayout(layout).allPass, true);
});

test('six photos with a gap do not overflow A4; they become two rows', () => {
  const layout = computeLayout({ photoCount: 6, gapMm: 2 });
  assert.equal(layout.rows, 2);
  assert.equal(layout.columns, 3);
  close(layout.blockWidth, 3 * 35 + 2 * 2); // 109
  close(layout.blockX, (210 - 109) / 2);
  assert.equal(layout.photos.length, 6);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('one photo is centred horizontally and top-aligned by default', () => {
  const layout = computeLayout({ photoCount: 1, gapMm: 4 });
  assert.equal(layout.photoCount, 1);
  close(layout.photos[0].x, (210 - 35) / 2);
  assert.equal(layout.photos[0].y, 0);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('24 photos with the maximum gap still fit one A4 portrait sheet', () => {
  const layout = computeLayout({ photoCount: 24, gapMm: 8 });
  assert.equal(layout.photoCount, 24);
  assert.equal(layout.rows, 5);
  assert.equal(layout.columns, 5);
  close(layout.blockWidth, 5 * 35 + 4 * 8); // 207
  close(layout.blockHeight, 5 * 45 + 4 * 8); // 257
  assert.ok(layout.blockY + layout.blockHeight <= 297);
  assert.ok(layout.blockX >= 0);
  assert.equal(layout.photos.length, 24);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('quantity and gap are clamped to the supported ranges', () => {
  assert.equal(computeLayout({ photoCount: 0 }).photoCount, 1);
  assert.equal(computeLayout({ photoCount: 99 }).photoCount, 24);
  assert.equal(computeLayout({ gapMm: -3 }).gapMm, 0);
  assert.equal(computeLayout({ gapMm: 99 }).gapMm, 8);
});

test('top/centre placement and downward nudge stay inside the sheet', () => {
  const top = computeLayout({ photoCount: 8, gapMm: 2, verticalOffsetMm: 30 });
  assert.equal(top.blockY, 30);
  const centred = computeLayout({
    photoCount: 8,
    gapMm: 2,
    verticalPlacement: 'centre',
  });
  close(centred.blockY, (297 - 92) / 2);
  const clamped = computeLayout({ photoCount: 8, gapMm: 2, verticalOffsetMm: 999 });
  assert.ok(clamped.blockY + clamped.blockHeight <= 297);
  assert.equal(verifyLayout(clamped).allPass, true);
});

test('pixel output follows the selected millimetre size', () => {
  const standard = pixelSizeForPhoto(35, 45, 600);
  assert.equal(standard.width, 827);
  assert.equal(standard.height, 1063);
  assert.ok(Math.abs(standard.effectiveDpi - 600) < 0.2);

  const square = pixelSizeForPhoto(35, 35, 600);
  assert.equal(square.width, 827);
  assert.equal(square.height, 827);

  const twoInch = pixelSizeForPhoto(50.8, 50.8, 600);
  assert.equal(twoInch.width, 1200);
  assert.equal(twoInch.height, 1200);

  const india = pixelSizeForPhoto(33, 48, 600);
  assert.equal(india.width, 780);
  assert.equal(india.height, 1134);

  const at300 = pixelSizeForPhoto(35, 45, 300);
  assert.equal(at300.width, 413);
  assert.equal(at300.height, 531);
});

test('a custom size keeps exact physical dimensions and adjusts the grid', () => {
  const layout = computeLayout({
    photoWidthMm: 50.8,
    photoHeightMm: 50.8,
    photoCount: 20,
    gapMm: 2,
  });
  assert.equal(layout.photoWidthMm, 50.8);
  assert.equal(layout.photoHeightMm, 50.8);
  assert.equal(layout.photoCount, 20);
  assert.equal(layout.capacity, 20);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 5);
  close(layout.blockWidth, 4 * 50.8 + 3 * 2, 1e-9);
  close(layout.blockHeight, 5 * 50.8 + 4 * 2, 1e-9);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('large photos clamp the quantity to what actually fits on one sheet', () => {
  const layout = computeLayout({
    photoWidthMm: 100,
    photoHeightMm: 150,
    photoCount: 24,
    gapMm: 8,
  });
  assert.equal(layout.photoWidthMm, 100);
  assert.equal(layout.photoHeightMm, 150);
  assert.equal(layout.capacity, 2);
  assert.equal(layout.photoCount, 2);
  assert.equal(layout.countLimited, true);
  assert.equal(layout.requestedPhotoCount, 24);
  assert.equal(layout.photos.length, 2);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('a custom portrait format keeps its own aspect without stretch', () => {
  const layout = computeLayout({
    photoWidthMm: 33,
    photoHeightMm: 48,
    photoCount: 6,
    gapMm: 0,
  });
  assert.equal(layout.columns, 6);
  close(layout.blockWidth, 198);
  close(layout.blockX, 6);
  assert.equal(layout.aspect, 33 / 48);
  for (const photo of layout.photos) {
    close(photo.widthMm / photo.heightMm, 33 / 48);
  }
  assert.equal(verifyLayout(layout).allPass, true);
});

test('cut guides trace every photo; hairlines cover every edge', () => {
  const layout = computeLayout();
  const cutmarks = buildGuideSegments(layout, 'cutmarks');
  assert.equal(cutmarks.length, layout.photoCount * 8);

  const hairlines = buildGuideSegments(layout, 'hairline');
  assert.equal(hairlines.length, layout.photoCount * 4);

  assert.deepEqual(buildGuideSegments(layout, 'none'), []);
});

test('measurement formatting is millimetres with two decimals', () => {
  assert.equal(mm(35), '35.00 mm');
  assert.equal(mm(188 / 6), '31.33 mm');
});

test('verifyLayout rejects a tampered sheet', () => {
  const layout = computeLayout();
  const tampered = {
    ...layout,
    photos: layout.photos.map((photo, index) =>
      index === 0 ? { ...photo, heightMm: 44 } : photo,
    ),
  };
  assert.equal(verifyLayout(tampered).allPass, false);
});
