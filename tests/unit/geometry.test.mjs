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

test('A4 constants are exact', () => {
  assert.equal(PAGE.widthMm, 210);
  assert.equal(PAGE.heightMm, 297);
  assert.equal(PHOTO.widthMm, 35);
  assert.equal(PHOTO.heightMm, 45);
  assert.equal(PHOTO.aspect, 7 / 9);
  assert.equal(PHOTO.count, 6);
});

test('EXACT mode: six 35 x 45 mm photos start at the top, with zero margins and gaps', () => {
  const layout = computeLayout({ mode: 'exact' });

  assert.equal(layout.photos.length, 6);
  assert.equal(layout.photoWidthMm, 35);
  assert.equal(layout.photoHeightMm, 45);
  assert.equal(layout.gapMm, 0);
  assert.equal(layout.sideMarginMm, 0);
  assert.equal(layout.rowWidthMm, 210);
  assert.equal(layout.rowX, 0);
  assert.equal(layout.rowY, 0);
  assert.equal(layout.verticalPlacement, 'top');
  assert.equal(layout.edgeToEdge, true);
  assert.equal(layout.isReduced, false);
  assert.ok(layout.withinPage);

  layout.photos.forEach((photo, index) => {
    close(photo.x, index * 35);
    assert.equal(photo.y, 0);
    assert.equal(photo.widthMm, 35);
    assert.equal(photo.heightMm, 45);
    close(photo.widthMm / photo.heightMm, 7 / 9);
  });

  // The row touches the top edge and the last photo ends on the right edge.
  close(layout.photos[0].y, 0);
  close(layout.photos[5].x + layout.photos[5].widthMm, 210);
  close(layout.rowY + layout.rowHeightMm, 45);

  const { checks, allPass } = verifyLayout(layout);
  assert.equal(allPass, true, JSON.stringify(checks.filter((check) => !check.pass)));
});

test('CENTRE placement restores the 126 mm vertically centred row', () => {
  const layout = computeLayout({ mode: 'exact', verticalPlacement: 'centre' });
  assert.equal(layout.verticalPlacement, 'centre');
  assert.equal(layout.rowY, 126);
  close(layout.rowY + layout.rowHeightMm, 171);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('SAFE mode: photos are honestly reduced and margins/gaps are respected', () => {
  const layout = computeLayout({ mode: 'safe', safeMarginMm: 6, gapMm: 2 });

  // (210 - 2*6 - 5*2) / 6 = 31.3333...
  close(layout.photoWidthMm, 188 / 6);
  close(layout.photoHeightMm, (188 / 6) * (45 / 35));
  close(layout.rowX, 6);
  close(layout.rowWidthMm, 198);
  close(layout.rowY, 6);
  assert.equal(layout.gapMm, 2);
  assert.equal(layout.sideMarginMm, 6);
  assert.equal(layout.verticalPlacement, 'top');
  assert.equal(layout.isReduced, true);
  close(layout.reductionMm, 35 - 188 / 6);
  assert.equal(layout.mode, 'safe');
  assert.ok(layout.withinPage);

  layout.photos.forEach((photo, index) => {
    close(photo.x, 6 + index * (188 / 6 + 2));
    close(photo.y, 6);
    close(photo.widthMm, 188 / 6);
    close(photo.widthMm / photo.heightMm, 7 / 9);
  });
  for (let i = 1; i < layout.photos.length; i += 1) {
    const previous = layout.photos[i - 1];
    close(layout.photos[i].x - (previous.x + previous.widthMm), 2);
  }
  close(layout.photos[5].x + layout.photos[5].widthMm, 210 - 6);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('SAFE mode with zero margin and zero gap is equivalent to exact size', () => {
  const layout = computeLayout({ mode: 'safe', safeMarginMm: 0, gapMm: 0 });
  assert.equal(layout.photoWidthMm, 35);
  assert.equal(layout.photoHeightMm, 45);
  assert.equal(layout.rowX, 0);
  assert.equal(layout.rowWidthMm, 210);
  assert.equal(layout.isReduced, false);
  assert.equal(verifyLayout(layout).allPass, true);
});

test('Nudge moves the top row down; centre can be nudged too, all clamped', () => {
  const nudged = computeLayout({ mode: 'exact', verticalOffsetMm: 30 });
  assert.equal(nudged.rowY, 30);
  assert.equal(nudged.appliedOffsetMm, 30);

  const clamped = computeLayout({ mode: 'exact', verticalOffsetMm: 400 });
  assert.equal(clamped.rowY, 80); // input clamps to +80
  assert.equal(verifyLayout(clamped).allPass, true);

  const centredNudged = computeLayout({
    mode: 'exact',
    verticalPlacement: 'centre',
    verticalOffsetMm: 30,
  });
  assert.equal(centredNudged.rowY, 156);

  const negative = computeLayout({ mode: 'exact', verticalOffsetMm: -50 });
  assert.equal(negative.rowY, 0);
});

test('The row stays horizontally centred in both modes', () => {
  for (const mode of ['exact', 'safe']) {
    const layout = computeLayout({ mode, safeMarginMm: 4, gapMm: 3 });
    close(layout.rowX + layout.rowWidthMm / 2, 105);
  }
});

test('Pixel output keeps the exact 7:9 ratio', () => {
  const at600 = pixelSizeForPhoto(35, 600);
  assert.equal(at600.width, 826);
  assert.equal(at600.height, 1062);
  assert.equal(at600.width % 7, 0);
  assert.equal(at600.height * 7, at600.width * 9);
  close(at600.effectiveDpi, 599.44, 0.05);

  const at300 = pixelSizeForPhoto(35, 300);
  assert.equal(at300.width, 413);
  assert.equal(at300.height, 531);
  assert.equal(at300.height * 7, at300.width * 9);
  close(at300.effectiveDpi, 299.75, 0.05);

  const safe = pixelSizeForPhoto(188 / 6, 600);
  assert.equal(safe.width % 7, 0);
  assert.equal(safe.height * 7, safe.width * 9);
});

test('Cut marks sit outside the photos; hairlines sit on photo edges', () => {
  const layout = computeLayout({ mode: 'exact' });

  // At the top edge there is no room above the row, so only the bottom ticks exist.
  const cutmarks = buildGuideSegments(layout, 'cutmarks');
  assert.equal(cutmarks.length, 7);
  assert.ok(cutmarks.every((segment) => segment.y1 >= layout.rowHeightMm));

  const centred = computeLayout({ mode: 'exact', verticalPlacement: 'centre' });
  const centredMarks = buildGuideSegments(centred, 'cutmarks');
  assert.equal(centredMarks.length, 14); // 7 boundaries x above + below
  const above = centredMarks.filter((segment) => segment.y2 <= centred.rowY + 1e-9);
  const below = centredMarks.filter(
    (segment) => segment.y1 >= centred.rowY + centred.rowHeightMm - 1e-9,
  );
  assert.equal(above.length, 7);
  assert.equal(below.length, 7);

  const hairlines = buildGuideSegments(layout, 'hairline');
  // 5 internal boundaries + top and bottom edges.
  assert.equal(hairlines.length, 7);
  const vertical = hairlines.filter((segment) => segment.x1 === segment.x2);
  const horizontal = hairlines.filter((segment) => segment.y1 === segment.y2);
  assert.equal(vertical.length, 5);
  assert.equal(horizontal.length, 2);
  assert.ok(vertical.every((segment) => segment.x1 > 0 && segment.x1 < 210));

  assert.deepEqual(buildGuideSegments(layout, 'none'), []);
});

test('Measurement formatting is millimetres with two decimals', () => {
  assert.equal(mm(35), '35.00 mm');
  assert.equal(mm(188 / 6), '31.33 mm');
});

test('verifyLayout rejects a tampered sheet', () => {
  const layout = computeLayout({ mode: 'exact' });
  const tampered = {
    ...layout,
    photos: layout.photos.map((photo, index) =>
      index === 0 ? { ...photo, heightMm: 44 } : photo,
    ),
  };
  assert.equal(verifyLayout(tampered).allPass, false);
});
