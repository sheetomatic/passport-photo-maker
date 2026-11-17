import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../../js/geometry.js';
import { buildPrintDocument } from '../../js/print.js';

const IMAGE = 'data:image/jpeg;base64,AAAA';

const close = (actual, expected, tolerance = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

function parsePhotos(html) {
  const pattern =
    /<img class="photo"[^>]*style="left:([\d.]+)mm;top:([\d.]+)mm;width:([\d.]+)mm;height:([\d.]+)mm"/g;
  const photos = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    photos.push({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    });
  }
  return photos;
}

test('print document is exactly A4 portrait with zero page margin', () => {
  const html = buildPrintDocument({
    layout: computeLayout({ mode: 'exact' }),
    imageDataUrl: IMAGE,
    guides: 'cutmarks',
  });
  assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
  assert.match(html, /\.sheet \{ position: relative; width: 210mm; height: 297mm;/);
  assert.match(html, /<html lang="en">/);
  assert.equal((html.match(/<img class="photo"/g) || []).length, 6);
});

test('print photos are positioned in millimetres at 35 x 45 mm', () => {
  const html = buildPrintDocument({
    layout: computeLayout({ mode: 'exact' }),
    imageDataUrl: IMAGE,
    guides: 'none',
  });
  const photos = parsePhotos(html);
  assert.equal(photos.length, 6);
  photos.forEach((photo, index) => {
    close(photo.x, index * 35);
    close(photo.y, 0);
    close(photo.width, 35);
    close(photo.height, 45);
  });
});

test('printer-safe print document uses calculated millimetres throughout', () => {
  const layout = computeLayout({ mode: 'safe', safeMarginMm: 6, gapMm: 2 });
  const html = buildPrintDocument({ layout, imageDataUrl: IMAGE, guides: 'none' });
  const photos = parsePhotos(html);
  close(photos[0].x, 6, 0.01);
  close(photos[0].y, 6, 0.01);
  close(photos[0].width, 188 / 6, 0.01);
  close(photos[0].height, (188 / 6) * (45 / 35), 0.01);
  close(photos[1].x - (photos[0].x + photos[0].width), 2, 0.01);
  close(photos[5].x + photos[5].width, 204, 0.01);
});

test('cut guides are vector SVG lines outside the image area', () => {
  const layout = computeLayout({ mode: 'exact' });
  const html = buildPrintDocument({ layout, imageDataUrl: IMAGE, guides: 'cutmarks' });
  assert.equal((html.match(/<line /g) || []).length, 7);
  assert.match(html, /viewBox="0 0 210 297"/);
  assert.match(html, /stroke-width: 0.15;/);

  const none = buildPrintDocument({ layout, imageDataUrl: IMAGE, guides: 'none' });
  assert.equal((none.match(/<line /g) || []).length, 0);
});

test('size labels are opt-in and measured in millimetres', () => {
  const layout = computeLayout({ mode: 'exact' });
  const off = buildPrintDocument({ layout, imageDataUrl: IMAGE, printedLabels: false });
  assert.equal((off.match(/class="label"/g) || []).length, 0);

  const on = buildPrintDocument({ layout, imageDataUrl: IMAGE, printedLabels: true });
  assert.equal((on.match(/class="label"/g) || []).length, 6);
  assert.equal((on.match(/35\.00 × 45\.00 mm/g) || []).length, 6);
});

test('print document contains no titles, logos or instructions on the sheet', () => {
  const html = buildPrintDocument({
    layout: computeLayout({ mode: 'exact' }),
    imageDataUrl: IMAGE,
  });
  const body = html.slice(html.indexOf('<body>'));
  assert.ok(!/Passport Photo Maker/i.test(body));
  assert.ok(!/<h1|<h2|<p\b/.test(body));
});
