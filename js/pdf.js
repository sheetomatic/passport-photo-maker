/**
 * pdf.js — one-page A4 portrait PDF positioned entirely in millimetres.
 *
 * The jsPDF constructor is injected so the same module runs in the browser
 * (window.jspdf.jsPDF) and in Node-based tests against the vendored UMD build.
 */

import {
  PAGE,
  buildGuideSegments,
  mm,
  verifyLayout,
} from '#app/geometry';

const ALIAS = 'passportPhoto';
const GUIDE_RGB = [122, 122, 122];
const LABEL_RGB = [110, 110, 110];

export function buildPdfDocument({
  jsPDF,
  layout,
  imageDataUrl,
  imageFormat = 'JPEG',
  guides = 'cutmarks',
  printedLabels = false,
  compress = true,
}) {
  if (typeof jsPDF !== 'function') {
    throw new Error('The PDF library is unavailable. Reload the page and try again.');
  }
  if (!layout || !imageDataUrl) {
    throw new Error('No print image has been generated yet.');
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [PAGE.widthMm, PAGE.heightMm],
    compress,
  });

  // Paint the paper explicitly. PDF viewers otherwise choose their own page
  // background, and the sheet must read as white everywhere.
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE.widthMm, PAGE.heightMm, 'F');

  // Six identical placements. The alias makes jsPDF embed the JPEG once.
  for (const photo of layout.photos) {
    doc.addImage(
      imageDataUrl,
      imageFormat,
      photo.x,
      photo.y,
      photo.widthMm,
      photo.heightMm,
      ALIAS,
      'MEDIUM',
    );
  }

  if (guides !== 'none') {
    const segments = buildGuideSegments(layout, guides);
    doc.setDrawColor(...GUIDE_RGB);
    doc.setLineWidth(0.15);
    for (const segment of segments) {
      doc.line(segment.x1, segment.y1, segment.x2, segment.y2);
    }
  }

  if (printedLabels) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...LABEL_RGB);
    const label = `${mm(layout.photoWidthMm)} × ${mm(layout.photoHeightMm)}`;
    for (const photo of layout.photos) {
      doc.text(label, photo.x + photo.widthMm / 2, photo.y + photo.heightMm + 7, {
        align: 'center',
      });
    }
  }

  const widthMm = doc.internal.pageSize.getWidth();
  const heightMm = doc.internal.pageSize.getHeight();
  const { checks } = verifyLayout(layout);
  const pdfChecks = [
    ...checks,
    {
      id: 'pdf-page',
      label: 'PDF page is portrait 210 × 297 mm',
      pass: Math.abs(widthMm - 210) < 0.01 && Math.abs(heightMm - 297) < 0.01,
    },
    {
      id: 'pdf-placements',
      label: 'Six photo placements written to the PDF',
      pass: layout.photos.length === 6,
    },
  ];

  return {
    doc,
    widthMm,
    heightMm,
    checks: pdfChecks,
    allPass: pdfChecks.every((check) => check.pass),
  };
}

export function pdfBytes(doc) {
  return new Uint8Array(doc.output('arraybuffer'));
}
