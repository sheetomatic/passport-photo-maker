/**
 * print.js — builds an exact A4 print document in millimetres and sends it to
 * the browser's print dialog.
 *
 * The geometry comes from the same computeLayout() result as the PDF, so the
 * print preview, the PDF and the on-screen A4 sheet are the same document at
 * three different resolutions. `@page { size: 210mm 297mm; margin: 0 }` plus
 * 100% / Actual Size in the dialog is what makes the paper output physical.
 */

import { buildGuideSegments } from '#app/geometry';

const mmValue = (value) => Number(value.toFixed(4));

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildPrintDocument({
  layout,
  imageDataUrl,
  guides = 'cutmarks',
  printedLabels = false,
}) {
  if (!layout || !imageDataUrl) {
    throw new Error('No print image has been generated yet.');
  }

  const photos = layout.photos
    .map(
      (photo) => `<img class="photo" src="${escapeAttribute(imageDataUrl)}" alt="" style="left:${mmValue(
        photo.x,
      )}mm;top:${mmValue(photo.y)}mm;width:${mmValue(photo.widthMm)}mm;height:${mmValue(
        photo.heightMm,
      )}mm">`,
    )
    .join('');

  const segments = buildGuideSegments(layout, guides);
  const guidesSvg = segments.length
    ? `<svg class="cut-guides" xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" aria-hidden="true">${segments
        .map(
          (segment) =>
            `<line x1="${mmValue(segment.x1)}" y1="${mmValue(segment.y1)}" x2="${mmValue(
              segment.x2,
            )}" y2="${mmValue(segment.y2)}"/>`,
        )
        .join('')}</svg>`
    : '';

  const labels = printedLabels
    ? `<div class="label" style="left:${mmValue(
        layout.blockX + layout.blockWidth / 2,
      )}mm;top:${mmValue(layout.blockY + layout.blockHeight + 5)}mm">${layout.photoCount} × ${layout.photoWidthMm.toFixed(
        2,
      )} × ${layout.photoHeightMm.toFixed(2)} mm · ${layout.gapMm.toFixed(1)} mm gaps</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Passport photos — A4</title>
<style>
  @page { size: 210mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 210mm; height: 297mm; background: #fff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; }
  .photo { position: absolute; display: block; }
  .cut-guides { position: absolute; top: 0; left: 0; overflow: visible; }
  .cut-guides line { stroke: #7a7a7a; stroke-width: 0.15; }
  .label { position: absolute; transform: translateX(-50%); font-family: Helvetica, Arial, sans-serif; font-size: 2.2mm; line-height: 1; color: #6e6e6e; white-space: nowrap; }
</style>
</head>
<body>
<div class="sheet">${photos}${guidesSvg}${labels}</div>
</body>
</html>`;
}

/**
 * Print an exact-size document through a hidden iframe. The iframe is laid out
 * at real A4 size off-screen, not display:none, so the browser can paginate it.
 */
export function printHtmlDocument(html, { onPrinted, onError } = {}) {
  const previous = document.getElementById('passport-print-frame');
  previous?.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'passport-print-frame';
  iframe.title = 'Print passport photos';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;background:#ffffff;';

  let printed = false;
  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 120000);
  };

  iframe.onload = () => {
    if (printed) return;
    printed = true;
    // The load event fires after the JPEG has decoded. One frame of breathing
    // room keeps Safari from printing a blank sheet.
    window.setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        if (!win || typeof win.print !== 'function') throw new Error('Printing is unavailable.');
        win.focus();
        win.print();
        onPrinted?.();
      } catch (error) {
        console.error('Print failed', error);
        onError?.(error);
      } finally {
        cleanup();
      }
    }, 200);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  return iframe;
}
