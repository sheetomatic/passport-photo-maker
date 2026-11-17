import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { computeLayout } from '../../js/geometry.js';
import { buildPdfDocument } from '../../js/pdf.js';

const HERE = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let jsPDFPromise;
async function getJsPDF() {
  if (!jsPDFPromise) {
    globalThis.self = globalThis;
    await import(pathToFileURL(path.join(HERE, 'vendor/jspdf.umd.min.js')).href);
    jsPDFPromise = Promise.resolve(globalThis.self.jspdf.jsPDF);
  }
  return jsPDFPromise;
}

const close = (actual, expected, tolerance = 0.005) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

const toMm = (points) => (points * 25.4) / 72;

function parseMediaBox(text) {
  const match = /\/MediaBox\s*\[([^\]]+)\]/.exec(text);
  assert.ok(match, 'PDF should contain a MediaBox');
  const values = match[1].trim().split(/\s+/).map(Number);
  return { widthPt: values[2] - values[0], heightPt: values[3] - values[1] };
}

function parsePlacements(text) {
  const pattern = /(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s*\/I\d+ Do/g;
  const placements = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    placements.push({
      widthPt: Number(match[1]),
      heightPt: Number(match[2]),
      xPt: Number(match[3]),
      yPt: Number(match[4]),
    });
  }
  return placements;
}

test('PDF is one A4 portrait page with six exact 35 x 45 mm images', async () => {
  const jsPDF = await getJsPDF();
  const layout = computeLayout({ mode: 'exact' });
  const result = buildPdfDocument({
    jsPDF,
    layout,
    imageDataUrl: PNG_1PX,
    imageFormat: 'PNG',
    guides: 'cutmarks',
    printedLabels: false,
    compress: false,
  });

  assert.equal(result.widthMm, 210);
  assert.equal(result.heightMm, 297);
  assert.equal(result.allPass, true, JSON.stringify(result.checks.filter((c) => !c.pass)));

  const buffer = Buffer.from(result.doc.output('arraybuffer'));
  const text = buffer.toString('latin1');
  assert.ok(text.startsWith('%PDF-'), 'should be a real PDF');

  const media = parseMediaBox(text);
  close(media.widthPt, 595.2756, 0.01);
  close(media.heightPt, 841.8898, 0.01);
  close(toMm(media.widthPt), 210, 0.002);
  close(toMm(media.heightPt), 297, 0.002);

  const pageCount = (text.match(/\/Type\s*\/Page\b/g) || []).length;
  assert.equal(pageCount, 1);
  assert.equal((text.match(/\/Count\s+1\b/) || []).length, 1);

  const placements = parsePlacements(text);
  assert.equal(placements.length, 6, 'six image draw operations');

  for (const placement of placements) {
    close(toMm(placement.widthPt), 35, 0.002);
    close(toMm(placement.heightPt), 45, 0.002);
    close(placement.widthPt / placement.heightPt, 7 / 9, 1e-9);
    // PDF coordinates start at the bottom-left: the top row's bottom edge is
    // 297 - 45 = 252 mm up from the page bottom.
    close(toMm(placement.yPt), 252, 0.002);
  }

  placements.forEach((placement, index) => {
    close(toMm(placement.xPt), index * 35, 0.002);
  });
  close(toMm(placements[0].xPt), 0);
  close(toMm(placements[5].xPt + placements[5].widthPt), 210);

  // The placements are identical in size and evenly spaced.
  const widths = new Set(placements.map((p) => p.widthPt.toFixed(6)));
  assert.equal(widths.size, 1);
  const steps = placements.slice(1).map((p, i) => p.xPt - placements[i].xPt);
  assert.ok(steps.every((step) => Math.abs(step - steps[0]) < 1e-9));
  close(toMm(steps[0]), 35, 0.002);
});

test('PDF in printer-safe mode uses the reduced dimensions and margins', async () => {
  const jsPDF = await getJsPDF();
  const layout = computeLayout({ mode: 'safe', safeMarginMm: 6, gapMm: 2 });
  const result = buildPdfDocument({
    jsPDF,
    layout,
    imageDataUrl: PNG_1PX,
    imageFormat: 'PNG',
    guides: 'none',
    compress: false,
  });
  const text = Buffer.from(result.doc.output('arraybuffer')).toString('latin1');
  const placements = parsePlacements(text);
  assert.equal(placements.length, 6);

  const photoWidthMm = toMm(placements[0].widthPt);
  const photoHeightMm = toMm(placements[0].heightPt);
  close(photoWidthMm, 188 / 6, 0.01);
  close(photoHeightMm, (188 / 6) * (45 / 35), 0.01);
  assert.ok(photoWidthMm < 35, 'must not claim 35 mm when reduced');

  close(toMm(placements[0].xPt), 6, 0.01);
  close(toMm(placements[5].xPt + placements[5].widthPt), 204, 0.01);
  const gapMm = toMm(placements[1].xPt - (placements[0].xPt + placements[0].widthPt));
  close(gapMm, 2, 0.01);
});

test('Compressed PDF (the production path) still reports A4 page size', async () => {
  const jsPDF = await getJsPDF();
  const layout = computeLayout({ mode: 'exact' });
  const result = buildPdfDocument({
    jsPDF,
    layout,
    imageDataUrl: PNG_1PX,
    imageFormat: 'PNG',
    compress: true,
  });
  const text = Buffer.from(result.doc.output('arraybuffer')).toString('latin1');
  const media = parseMediaBox(text);
  close(toMm(media.widthPt), 210, 0.002);
  close(toMm(media.heightPt), 297, 0.002);
  assert.equal((text.match(/\/Type\s*\/Page\b/g) || []).length, 1);
});

test('Printed labels appear only when explicitly enabled', async () => {
  const jsPDF = await getJsPDF();
  const layout = computeLayout({ mode: 'exact' });

  const without = buildPdfDocument({
    jsPDF,
    layout,
    imageDataUrl: PNG_1PX,
    imageFormat: 'PNG',
    printedLabels: false,
    compress: false,
  });
  const withoutText = Buffer.from(without.doc.output('arraybuffer')).toString('latin1');
  assert.ok(!withoutText.includes('35.00 mm × 45.00 mm'));

  const withLabels = buildPdfDocument({
    jsPDF,
    layout,
    imageDataUrl: PNG_1PX,
    imageFormat: 'PNG',
    printedLabels: true,
    compress: false,
  });
  const withText = Buffer.from(withLabels.doc.output('arraybuffer')).toString('latin1');
  assert.equal((withText.match(/\(35\.00 mm × 45\.00 mm\) Tj/g) || []).length, 6);
});
