import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCropState,
  getCropRect,
  cropWindow,
  cropFractions,
  panCropByPixels,
  setCropZoom,
  setCropAspect,
  suggestCropFromFace,
  CROP_ASPECT,
} from '../../js/crop.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

function assertInside(rect, width, height) {
  assert.ok(rect.sx >= -1e-6, `sx ${rect.sx}`);
  assert.ok(rect.sy >= -1e-6, `sy ${rect.sy}`);
  assert.ok(rect.sx + rect.width <= width + 1e-6, `right ${rect.sx + rect.width} > ${width}`);
  assert.ok(rect.sy + rect.height <= height + 1e-6, `bottom ${rect.sy + rect.height} > ${height}`);
  close(rect.width / rect.height, CROP_ASPECT, 1e-9);
}

test('zoom-1 crop is the largest 7:9 window inside a portrait photo', () => {
  const state = createCropState(1200, 1600);
  const rect = getCropRect(state);
  close(rect.width, 1200);
  close(rect.height, 1200 / CROP_ASPECT);
  close(rect.sx, 0);
  close(rect.sy, (1600 - 1200 / CROP_ASPECT) / 2);
  assertInside(rect, 1200, 1600);
});

test('zoom-1 crop is the largest 7:9 window inside a landscape photo', () => {
  const state = createCropState(1600, 1200);
  const rect = getCropRect(state);
  close(rect.width, 1200 * CROP_ASPECT);
  close(rect.height, 1200);
  close(rect.sx, (1600 - 1200 * CROP_ASPECT) / 2);
  close(rect.sy, 0);
  assertInside(rect, 1600, 1200);
});

test('a square photo gets a full-height 7:9 crop', () => {
  const state = createCropState(1000, 1000);
  const rect = getCropRect(state);
  close(rect.width, 1000 * CROP_ASPECT);
  close(rect.height, 1000);
  close(rect.sx, (1000 - 1000 * CROP_ASPECT) / 2);
  assertInside(rect, 1000, 1000);
});

test('zoom keeps the ratio and never leaves the photo', () => {
  for (const [width, height] of [
    [1200, 1600],
    [3000, 2000],
    [800, 2400],
  ]) {
    const base = createCropState(width, height);
    for (const zoom of [1, 1.5, 2.5, 4]) {
      const state = setCropZoom(base, zoom);
      const rect = getCropRect(state);
      assertInside(rect, width, height);
      close(rect.width, (cropWindow(state).baseWidth / zoom), 1e-6);
    }
  }
});

test('zoom is clamped to 1..4', () => {
  const state = createCropState(1200, 1600);
  assert.equal(getCropRect(setCropZoom(state, 0.2)).zoom, 1);
  assert.equal(getCropRect(setCropZoom(state, 99)).zoom, 4);
});

test('panning is clamped at the photo edges', () => {
  const state = setCropZoom(createCropState(1200, 1600), 2);
  const frameWidth = 350;

  const pushedLeft = panCropByPixels(state, 100000, 0, frameWidth);
  const leftRect = getCropRect(pushedLeft);
  close(leftRect.sx, 0, 1e-6);

  const pushedRight = panCropByPixels(state, -100000, 0, frameWidth);
  const rightRect = getCropRect(pushedRight);
  close(rightRect.sx + rightRect.width, 1200, 1e-6);

  assertInside(leftRect, 1200, 1600);
  assertInside(rightRect, 1200, 1600);
});

test('crop fractions describe the same source rectangle', () => {
  const state = setCropZoom(createCropState(1200, 1600), 1.75);
  const rect = getCropRect(state);
  const fractions = cropFractions(state);
  close(fractions.x * 1200, rect.sx);
  close(fractions.width * 1200, rect.width);
  close(fractions.y * 1600, rect.sy);
  close(fractions.height * 1600, rect.height);
  assert.ok(fractions.width > 0 && fractions.width <= 1);
  assert.ok(fractions.height > 0 && fractions.height <= 1);
});

test('face suggestion frames the head with headroom and a chin line', () => {
  const imageWidth = 1200;
  const imageHeight = 1600;
  const faceBox = { x: 450, y: 500, width: 300, height: 380 };
  const state = suggestCropFromFace(imageWidth, imageHeight, faceBox);
  const rect = getCropRect(state);

  assertInside(rect, imageWidth, imageHeight);
  assert.ok(rect.zoom > 1, 'should zoom in for a face smaller than the frame');

  const faceCenterX = faceBox.x + faceBox.width / 2;
  close(rect.sx + rect.width / 2, faceCenterX, 20);

  const faceTopFraction = (faceBox.y - rect.sy) / rect.height;
  const faceBottomFraction = (faceBox.y + faceBox.height - rect.sy) / rect.height;
  assert.ok(faceTopFraction > 0.1 && faceTopFraction < 0.3, `headroom ${faceTopFraction}`);
  assert.ok(faceBottomFraction > 0.75 && faceBottomFraction < 0.92, `chin ${faceBottomFraction}`);
  close(rect.width, faceBox.width / 0.64, 1e-6);
});

test('landmarks keep the eye line at 48% and leave hair headroom', () => {
  const imageWidth = 900;
  const imageHeight = 1200;
  const faceBox = {
    x: 248,
    y: 436,
    width: 401,
    height: 401,
    keypoints: [
      { x: 0.4086, y: 0.4652 },
      { x: 0.5875, y: 0.4648 },
      { x: 0.5, y: 0.5555 },
      { x: 0.5006, y: 0.6155 },
      { x: 0.311, y: 0.4822 },
      { x: 0.6863, y: 0.4805 },
    ],
  };
  const rect = getCropRect(suggestCropFromFace(imageWidth, imageHeight, faceBox));
  const eyeY = ((0.4652 + 0.4648) / 2) * imageHeight;
  close((eyeY - rect.sy) / rect.height, 0.48, 0.01);
  close(rect.width, faceBox.width / 0.64, 1e-6);
  assertInside(rect, imageWidth, imageHeight);

  const hairTop = 250; // known from the test portrait
  const headroomMm = ((hairTop - rect.sy) / rect.height) * 45;
  assert.ok(headroomMm > 2.5, `headroom ${headroomMm} mm`);
  assert.ok(headroomMm < 8, `headroom ${headroomMm} mm`);
});

test('face suggestion never pushes the crop outside a portrait photo', () => {
  const imageWidth = 900;
  const imageHeight = 1600;
  const faceBox = { x: 10, y: 10, width: 180, height: 220 };
  const rect = getCropRect(suggestCropFromFace(imageWidth, imageHeight, faceBox));
  assertInside(rect, imageWidth, imageHeight);
});

test('missing face data falls back to a centred crop', () => {
  const rect = getCropRect(suggestCropFromFace(1200, 1600, null));
  close(rect.sx + rect.width / 2, 600);
  close(rect.sy + rect.height / 2, 800);
  close(rect.zoom, 1);
});


test('a square aspect produces a square crop', () => {
  const state = createCropState(900, 1200, { aspect: 1 });
  const rect = getCropRect(state);
  close(rect.width, 900);
  close(rect.height, 900);
  close(rect.width / rect.height, 1);
});

test('changing aspect keeps the centre and changes the crop ratio', () => {
  const original = createCropState(900, 1200, { aspect: 7 / 9, zoom: 1.2 });
  const square = setCropAspect(original, 1);
  assert.equal(square.aspect, 1);
  close(square.zoom, 1.2);
  const rect = getCropRect(square);
  close(rect.width / rect.height, 1);
  close(rect.cx, original.cx);
  close(rect.cy, original.cy);
});

test('face suggestion respects a custom aspect', () => {
  const face = {
    x: 330,
    y: 300,
    width: 240,
    height: 300,
    keypoints: [
      { x: 0.4, y: 0.42 },
      { x: 0.6, y: 0.42 },
    ],
  };
  const state = suggestCropFromFace(900, 1200, face, 1);
  const rect = getCropRect(state);
  close(rect.width / rect.height, 1);
  assert.ok(rect.width > 0 && rect.height > 0);
});
