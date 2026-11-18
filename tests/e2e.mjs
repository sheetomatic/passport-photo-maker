/**
 * End-to-end verification in a real Chrome browser.
 *
 * Covers: upload validation, crop/enhancement controls, live A4 geometry,
 * quantity/gap print layouts, full-resolution render, actual PDF download, the print
 * stylesheet, print dialog, replace/remove and mobile overflow.
 *
 * Run: npm run test:e2e
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const FIXTURES = path.join(HERE, 'fixtures');
const SCREENSHOTS = path.join(ROOT, 'screenshots');
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function close(actual, expected, tolerance, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

function parsePdfMediaBox(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const text = bytes.toString('latin1');
  assert.ok(text.startsWith('%PDF-'), 'not a PDF');
  const match = /\/MediaBox\s*\[([^\]]+)\]/.exec(text);
  assert.ok(match, 'MediaBox missing');
  const values = match[1].trim().split(/\s+/).map(Number);
  return { widthPt: values[2] - values[0], heightPt: values[3] - values[1], text };
}

function pageCount(pdfText) {
  return (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
}

const PORTRAIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#f2efe8"/><stop offset="1" stop-color="#cfc9be"/></radialGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9a77f"/><stop offset=".55" stop-color="#c68f66"/><stop offset="1" stop-color="#b57c55"/></linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c211b"/><stop offset="1" stop-color="#191310"/></linearGradient>
    <linearGradient id="shirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#39465a"/><stop offset="1" stop-color="#242d3b"/></linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#bg)"/>
  <ellipse cx="450" cy="1310" rx="340" ry="300" fill="url(#shirt)"/>
  <path d="M360 760 L360 860 Q450 930 540 860 L540 760 Z" fill="#b57c55"/>
  <ellipse cx="450" cy="560" rx="190" ry="250" fill="url(#skin)"/>
  <path d="M258 520 C250 330 350 250 450 250 C560 250 655 335 645 535 C640 455 600 415 560 405 C500 390 400 395 340 420 C300 435 268 470 258 520 Z" fill="url(#hair)"/>
  <ellipse cx="290" cy="590" rx="28" ry="52" fill="#c08a63"/>
  <ellipse cx="610" cy="590" rx="28" ry="52" fill="#c08a63"/>
  <ellipse cx="375" cy="565" rx="38" ry="22" fill="#f7f1e8"/>
  <ellipse cx="525" cy="565" rx="38" ry="22" fill="#f7f1e8"/>
  <circle cx="377" cy="566" r="14" fill="#3a2a1e"/><circle cx="523" cy="566" r="14" fill="#3a2a1e"/>
  <circle cx="377" cy="566" r="6" fill="#120d0a"/><circle cx="523" cy="566" r="6" fill="#120d0a"/>
  <circle cx="382" cy="561" r="4" fill="#fff"/><circle cx="528" cy="561" r="4" fill="#fff"/>
  <path d="M330 525 C355 500 400 500 420 518" stroke="#2a1d15" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M480 518 C500 500 545 500 570 525" stroke="#2a1d15" stroke-width="12" fill="none" stroke-linecap="round"/>
  <path d="M450 570 C445 625 438 655 425 675 C442 690 462 690 478 676" stroke="#a86f4d" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M385 735 C415 715 485 715 515 735 C500 780 470 800 450 800 C430 800 400 780 385 735 Z" fill="#9d5a4d"/>
  <path d="M400 742 C425 755 475 755 500 742" stroke="#7d4036" stroke-width="5" fill="none"/>
  <ellipse cx="335" cy="660" rx="38" ry="20" fill="#c98964" opacity=".45"/>
  <ellipse cx="565" cy="660" rx="38" ry="20" fill="#c98964" opacity=".45"/>
</svg>`;

async function makeFixtures(browser) {
  await fs.mkdir(FIXTURES, { recursive: true });
  const fixturePage = await browser.newPage();
  await fixturePage.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
  await fixturePage.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:#d8d4cc}svg{display:block}</style></head><body>${PORTRAIT_SVG}</body></html>`,
  );
  const portraitPath = path.join(FIXTURES, 'portrait.png');
  await fixturePage.screenshot({
    path: portraitPath,
    clip: { x: 0, y: 0, width: 900, height: 1200 },
  });

  // A second, deliberately different photo for the replace test.
  await fixturePage.setContent(
    `<!doctype html><html><head><style>html,body{margin:0}svg{display:block}</style></head><body>
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100">
        <rect width="800" height="1100" fill="#8fa4b8"/>
        <ellipse cx="400" cy="1180" rx="330" ry="300" fill="#31414f"/>
        <ellipse cx="400" cy="500" rx="170" ry="225" fill="#e0b696"/>
        <path d="M220 470 C220 290 320 220 400 220 C500 220 590 300 585 490 C560 400 500 380 400 385 C300 390 250 410 220 470 Z" fill="#5b4636"/>
        <ellipse cx="345" cy="505" rx="30" ry="17" fill="#fff"/><ellipse cx="460" cy="505" rx="30" ry="17" fill="#fff"/>
        <circle cx="347" cy="506" r="11" fill="#2f4a6b"/><circle cx="458" cy="506" r="11" fill="#2f4a6b"/>
        <path d="M320 470 C345 450 385 452 405 465" stroke="#3d2f24" stroke-width="10" fill="none" stroke-linecap="round"/>
        <path d="M445 462 C465 450 505 452 525 472" stroke="#3d2f24" stroke-width="10" fill="none" stroke-linecap="round"/>
        <path d="M400 515 C396 560 392 585 382 600 C396 612 412 610 428 598" stroke="#c08f6d" stroke-width="8" fill="none" stroke-linecap="round"/>
        <path d="M350 655 C375 640 425 640 450 655 C440 690 415 705 400 705 C385 705 360 690 350 655 Z" fill="#b06a5c"/>
        <text x="400" y="140" fill="#f5f5f2" font-family="Helvetica" font-size="34" text-anchor="middle" letter-spacing="6">REPLACEMENT PHOTO</text>
      </svg></body></html>`,
  );
  const replacementPath = path.join(FIXTURES, 'replacement.png');
  await fixturePage.screenshot({
    path: replacementPath,
    clip: { x: 0, y: 0, width: 800, height: 1100 },
  });
  await fixturePage.close();

  const corrupt = path.join(FIXTURES, 'corrupt.jpg');
  await fs.writeFile(corrupt, 'this is not an image');
  const unsupported = path.join(FIXTURES, 'animation.gif');
  await fs.writeFile(unsupported, 'GIF89a not really');
  const heic = path.join(FIXTURES, 'iphone.heic');
  await fs.writeFile(heic, Buffer.from('not a real heic, just enough to test decode failure'));

  return { portraitPath, replacementPath, corrupt, unsupported, heic };
}

async function getPhotoCorner(page) {
  return page.evaluate(async () => {
    const image = document.querySelector('#sheetPhotos img');
    if (!image) throw new Error('No sheet photo');
    if (typeof image.decode === 'function') await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const topLeft = Array.from(context.getImageData(3, 3, 1, 1).data);
    const topRight = Array.from(
      context.getImageData(canvas.width - 4, 3, 1, 1).data,
    );
    return { topLeft, topRight };
  });
}

async function getSheetGeometry(page) {
  return page.evaluate(() => {
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const images = [...document.querySelectorAll('#sheetPhotos img')].map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        x: rect.x - sheet.x,
        y: rect.y - sheet.y,
        width: rect.width,
        height: rect.height,
        src: img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    });
    return {
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
      images,
      mmPerPx: 210 / sheet.width,
    };
  });
}

async function main() {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const server = await startServer({ port: 0 });
  // A second origin guarantees no cached MediaPipe assets for the forced
  // face-detection-failure test (service-worker caches are origin-scoped).
  const mediapipeFailServer = await startServer({ port: 0 });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      '--force-color-profile=srgb',
    ],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
  });

  const errors = [];
  const externalRequests = [];
  const page = await browser.newPage();
  page.on('request', (request) => {
    const url = request.url();
    if (
      !url.startsWith(server.url) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:') &&
      !url.startsWith('about:')
    ) {
      externalRequests.push(url);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  let failed = false;
  try {
    const { portraitPath, replacementPath, corrupt, unsupported, heic } = await makeFixtures(browser);
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#uploadCard');

    console.log('1. initial disabled state');
    assert.equal(
      await page.$eval('#btnDownload', (button) => button.disabled),
      true,
      'Download must be disabled before upload',
    );
    assert.equal(await page.$eval('#btnGenerate', (button) => button.disabled), true);
    assert.equal(await page.$eval('#btnPrint', (button) => button.disabled), true);
    assert.equal(
      await page.$eval('#workspace', (element) => element.hidden),
      true,
      'settings workspace must be hidden before upload',
    );
    assert.equal(
      await page.$eval('#stagePhoto', (element) => element.hidden),
      true,
      'photo setup must not show before upload',
    );
    assert.equal(
      await page.$eval('#sidebar', (element) => element.offsetParent !== null),
      true,
      'desktop settings sidebar should be visible',
    );
    assert.equal(
      await page.$eval('#btnOpenSidebar', (element) => getComputedStyle(element).display),
      'none',
      'drawer toggle is mobile-only',
    );
    assert.equal(
      await page.$eval('#sheetEmpty', (element) => !element.hidden),
      true,
      'empty A4 preview should be shown',
    );
    assert.equal(
      await page.$eval('.capture-actions', (element) => getComputedStyle(element).display),
      'none',
      'camera buttons are for touch/mobile layouts',
    );
    assert.equal(await page.$eval('#cameraInput', (element) => element.getAttribute('capture')), 'user');

    console.log('2. invalid files are rejected without breaking the app');
    await (await page.$('#fileInput')).uploadFile(corrupt);
    await page.waitForFunction(
      () => !document.getElementById('uploadError').hidden,
      { timeout: 8000 },
    );
    const corruptError = await page.$eval('#uploadError', (element) => element.textContent);
    assert.match(corruptError, /read|couldn’t|unsupported/i);
    assert.equal(
      await page.$eval('#workspace', (element) => element.hidden),
      true,
      'a corrupt file must not open the editor',
    );

    await (await page.$('#fileInput')).uploadFile(unsupported);
    await page.waitForFunction(
      () => /supported|JPG/i.test(document.getElementById('uploadError').textContent),
      { timeout: 8000 },
    );

    await (await page.$('#fileInput')).uploadFile(heic);
    await page.waitForFunction(
      () => /HEIC/i.test(document.getElementById('uploadError').textContent),
      { timeout: 10000 },
    );
    assert.equal(await page.$eval('#workspace', (element) => element.hidden), true);

    console.log('3. uploading a valid portrait');
    await (await page.$('#fileInput')).uploadFile(portraitPath);
    await page.waitForFunction(
      () => !document.getElementById('workspace').hidden,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll('#sheetPhotos img').length === 6,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => {
        const status = document.getElementById('faceStatus').dataset.state;
        return status === 'ok' || status === 'warn';
      },
      { timeout: 45000 },
    );
    await sleep(900);

    assert.equal(await page.$eval('#photoName', (element) => element.textContent), 'portrait.png');
    const initialGeometry = await getSheetGeometry(page);
    assert.equal(initialGeometry.images.length, 6);
    const firstSrc = initialGeometry.images[0].src;
    assert.ok(firstSrc.startsWith('data:image/jpeg'));
    assert.ok(initialGeometry.images.every((image) => image.src === firstSrc), 'six identical copies');
    assert.ok(
      initialGeometry.images.every((image) => image.y === initialGeometry.images[0].y),
      'all photos share one row',
    );

    console.log('4. live A4 preview geometry is physically exact');
    const mm = initialGeometry.mmPerPx;
    close(initialGeometry.sheetWidth / initialGeometry.sheetHeight, 210 / 297, 0.002, 'sheet ratio');
    initialGeometry.images.forEach((image, index) => {
      close(image.width * mm, 35, 0.2, `photo ${index + 1} width`);
      close(image.height * mm, 45, 0.2, `photo ${index + 1} height`);
      close(image.x * mm, index * 35, 0.2, `photo ${index + 1} x`);
      close(image.y * mm, 0, 0.2, `photo ${index + 1} y`);
    });
    assert.equal(
      await page.$eval('#stagePhoto', (element) => element.hidden),
      false,
      'photo setup should be visible after upload',
    );
    assert.equal(
      await page.$eval('#stagePrint', (element) => element.hidden),
      true,
      'print setup should be hidden until approved',
    );
    assert.equal(
      await page.$eval('#sidebarStageTitle', (element) => element.textContent),
      'Photo setup',
    );
    assert.equal(await page.$eval('#countValue', (element) => element.textContent), '6');
    assert.equal(await page.$eval('#gapValue', (element) => element.textContent), '0.0 mm');
    assert.match(await page.$eval('#actualSize', (element) => element.textContent), /6 × 35\.00 × 45\.00/);
    assert.equal(
      await page.$eval('#modeBadge', (element) => element.textContent.trim()),
      '6 photos',
    );
    assert.equal(
      await page.$eval('#sheetEmpty', (element) => element.hidden),
      true,
      'empty preview overlay should be hidden after upload',
    );
    assert.equal(
      await page.$eval('#measureOverlay', (element) => element.hidden),
      false,
      'measurements should be visible by default',
    );

    console.log('5. approval gate moves from photo setup to print setup');
    await page.$eval('#btnToPrint', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.click('#btnToPrint');
    await page.waitForFunction(() => !document.getElementById('stagePrint').hidden, {
      timeout: 5000,
    });
    assert.equal(
      await page.$eval('#sidebarStageTitle', (element) => element.textContent),
      'Print setup',
    );
    assert.equal(await page.$eval('#stagePhoto', (element) => element.hidden), true);
    assert.equal(
      await page.$eval('#stageRailPrint', (element) => element.classList.contains('is-active')),
      true,
    );
    await page.$eval('#btnBackToPhoto', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.click('#btnBackToPhoto');
    await page.waitForFunction(() => !document.getElementById('stagePhoto').hidden, {
      timeout: 5000,
    });
    assert.equal(
      await page.$eval('#sidebarStageTitle', (element) => element.textContent),
      'Photo setup',
    );

    console.log('7. crop zoom, drag and reset');
    const beforeZoom = (await getSheetGeometry(page)).images[0].src;
    await page.evaluate(() => {
      const slider = document.getElementById('cropZoom');
      slider.value = '2';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(600);
    const zoom = await page.evaluate(() => window.__passportApp.state.crop.zoom);
    close(zoom, 2, 0.01, 'zoom state');
    const afterZoom = (await getSheetGeometry(page)).images[0].src;
    assert.notEqual(afterZoom, beforeZoom, 'zooming should re-render the print photo');

    await page.$eval('#cropFrame', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(250);
    const cropBox = await page.$eval('#cropFrame', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cropBox.x + cropBox.width / 2 + 40, cropBox.y + cropBox.height / 2 + 25, {
      steps: 8,
    });
    await page.mouse.up();
    await sleep(500);
    const afterDrag = await page.evaluate(() => ({
      crop: window.__passportApp.state.crop,
    }));
    assert.ok(Math.abs(afterDrag.crop.zoom - 2) < 0.01, 'drag must not change zoom');
    assert.notEqual((await getSheetGeometry(page)).images[0].src, afterZoom, 'drag should re-render');

    await page.click('#btnResetCrop');
    await sleep(500);
    close(await page.evaluate(() => window.__passportApp.state.crop.zoom), 1, 0.001, 'reset zoom');

    console.log('7b. enhancement comparison and reset');
    const enhancedSrc = (await getSheetGeometry(page)).images[0].src;
    await page.click('#optOriginal');
    await sleep(450);
    assert.equal(await page.evaluate(() => window.__passportApp.state.enhance.enabled), false);
    const originalSrc = (await getSheetGeometry(page)).images[0].src;
    assert.notEqual(originalSrc, enhancedSrc, 'original render should differ from enhanced');
    await page.$eval('#btnUseEnhanced', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(120);
    await page.click('#btnUseEnhanced');
    await sleep(450);
    assert.equal(await page.evaluate(() => window.__passportApp.state.enhance.enabled), true);
    assert.equal(await page.$eval('#btnUseEnhanced', (button) => button.disabled), true);

    await page.evaluate(() => {
      const brightness = document.getElementById('brightness');
      brightness.value = '18';
      brightness.dispatchEvent(new Event('input', { bubbles: true }));
      const sharpness = document.getElementById('sharpness');
      sharpness.value = '65';
      sharpness.dispatchEvent(new Event('input', { bubbles: true }));
      const strength = document.getElementById('strength');
      strength.value = '55';
      strength.dispatchEvent(new Event('input', { bubbles: true }));
      const warmth = document.getElementById('warmth');
      warmth.value = '12';
      warmth.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    const adjusted = await page.evaluate(() => {
      const app = window.__passportApp.state.enhance;
      return app;
    });
    assert.deepEqual(
      {
        strength: adjusted.strength,
        brightness: adjusted.brightness,
        sharpness: adjusted.sharpness,
        warmth: adjusted.warmth,
      },
      { strength: 55, brightness: 18, sharpness: 65, warmth: 12 },
    );
    await page.click('#btnResetEnhance');
    await sleep(500);
    assert.deepEqual(
      await page.evaluate(() => {
        const app = window.__passportApp.state;
        return {
          strength: app.enhance.strength,
          brightness: app.enhance.brightness,
          contrast: app.enhance.contrast,
          warmth: app.enhance.warmth,
          sharpness: app.enhance.sharpness,
          smoothing: app.enhance.smoothing,
        };
      }),
      { strength: 80, brightness: 0, contrast: 5, warmth: 0, sharpness: 50, smoothing: 30 },
    );

    console.log('8. background removal and replacement');
    assert.equal(
      await page.$eval('#bgToggle', (element) => element.getAttribute('aria-checked')),
      'false',
    );
    const originalCorner = await getPhotoCorner(page);
    assert.equal(originalCorner.topLeft[3], 255);
    assert.ok(
      !originalCorner.topLeft.slice(0, 3).every((value) => value > 245),
      `original background should not be white: ${originalCorner.topLeft}`,
    );

    await page.click('[data-bg="#ffffff"]');
    await page.waitForFunction(
      () => document.getElementById('bgStatus').dataset.state === 'ok',
      { timeout: 30000 },
    );
    await sleep(500);
    const whiteCorner = await getPhotoCorner(page);
    assert.ok(
      whiteCorner.topLeft.slice(0, 3).every((value) => value > 248),
      `white background expected: ${whiteCorner.topLeft}`,
    );
    assert.ok(
      whiteCorner.topRight.slice(0, 3).every((value) => value > 248),
      `white background expected at top-right: ${whiteCorner.topRight}`,
    );
    assert.equal(
      await page.$eval('#bgToggle', (element) => element.getAttribute('aria-checked')),
      'true',
    );
    assert.equal(
      await page.$eval('[data-bg="#ffffff"]', (element) => element.getAttribute('aria-pressed')),
      'true',
    );
    const backgroundCard = await page.$('#backgroundCard');
    await backgroundCard.screenshot({ path: path.join(SCREENSHOTS, 'app-background.png') });

    await page.click('[data-bg="#dbe9f7"]');
    await sleep(500);
    const blueCorner = await getPhotoCorner(page);
    close(blueCorner.topLeft[0], 219, 5, 'pale blue R');
    close(blueCorner.topLeft[1], 233, 5, 'pale blue G');
    close(blueCorner.topLeft[2], 247, 5, 'pale blue B');
    assert.equal(
      await page.evaluate(() => window.__passportApp.state.background.color),
      '#dbe9f7',
    );

    await page.click('[data-bg="original"]');
    await sleep(400);
    const restoredCorner = await getPhotoCorner(page);
    assert.ok(
      !restoredCorner.topLeft.slice(0, 3).every((value) => value > 245),
      'original background should return when background replacement is off',
    );
    assert.equal(
      await page.$eval('#bgToggle', (element) => element.getAttribute('aria-checked')),
      'false',
    );

    await page.click('[data-bg="#ffffff"]');
    await sleep(400);
    const reEnabledCorner = await getPhotoCorner(page);
    assert.ok(reEnabledCorner.topLeft.slice(0, 3).every((value) => value > 248));

    console.log('8b. reframe with the face suggestion for the final preview');
    await page.$eval('#btnDetectFace', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(120);
    await page.click('#btnDetectFace');
    await page.waitForFunction(
      () => /crop updated/i.test(document.getElementById('faceStatusText').textContent),
      { timeout: 30000 },
    );
    await sleep(500);

    console.log('9. quantity, gap, placement and print controls');
    await page.$eval('#btnToPrint', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.click('#btnToPrint');
    await page.waitForFunction(() => !document.getElementById('stagePrint').hidden, {
      timeout: 5000,
    });

    await page.$eval('#countPlus', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await page.click('#countPlus');
    await page.click('#countPlus');
    await page.click('[data-gap="2"]');
    await page.waitForFunction(() => document.querySelectorAll('#sheetPhotos img').length === 8, {
      timeout: 8000,
    });
    await sleep(500);

    const gridLayout = await page.evaluate(() => window.__passportApp.getLayout());
    assert.equal(gridLayout.photoCount, 8);
    assert.equal(gridLayout.gapMm, 2);
    assert.equal(gridLayout.columns, 4);
    assert.equal(gridLayout.rows, 2);
    close(gridLayout.blockWidth, 146, 1e-9, 'block width');
    close(gridLayout.blockX, 32, 1e-9, 'block x');

    const gridGeometry = await getSheetGeometry(page);
    assert.equal(gridGeometry.images.length, 8);
    const gridMm = gridGeometry.mmPerPx;
    gridGeometry.images.forEach((image, index) => {
      const photo = gridLayout.photos[index];
      close(image.width * gridMm, 35, 0.2, `grid photo ${index + 1} width`);
      close(image.height * gridMm, 45, 0.2, `grid photo ${index + 1} height`);
      close(image.x * gridMm, photo.x, 0.2, `grid photo ${index + 1} x`);
      close(image.y * gridMm, photo.y, 0.2, `grid photo ${index + 1} y`);
    });
    assert.equal(await page.$eval('#countValue', (element) => element.textContent), '8');
    assert.equal(await page.$eval('#gapValue', (element) => element.textContent), '2.0 mm');
    assert.match(
      await page.$eval('#layoutSummary', (element) => element.textContent),
      /8 photos · 4 across × 2 down · 2\.0 mm gaps/,
    );
    assert.match(
      await page.$eval('#previewSub', (element) => element.textContent),
      /8 photos/,
    );
    assert.equal(
      await page.$$eval('[data-count="8"]', (elements) => elements[0].classList.contains('is-selected')),
      true,
    );
    assert.equal(
      await page.$$eval('[data-gap="2"]', (elements) => elements[0].classList.contains('is-selected')),
      true,
    );

    await page.click('#posCentre');
    await sleep(300);
    close(
      await page.evaluate(() => window.__passportApp.getLayout().blockY),
      (297 - 92) / 2,
      0.01,
      'centred block',
    );
    await page.click('#posTop');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__passportApp.getLayout().blockY), 0);

    await page.click('#showMeasurements');
    await sleep(250);
    assert.equal(await page.$eval('#measureOverlay', (element) => element.hidden), true);
    await page.click('#showMeasurements');
    await sleep(250);
    assert.equal(await page.$eval('#measureOverlay', (element) => element.hidden), false);

    await page.select('#guidesSelect', 'none');
    await sleep(250);
    assert.equal(await page.$$eval('#sheetGuides line', (lines) => lines.length), 0);
    await page.select('#guidesSelect', 'hairline');
    await sleep(250);
    assert.equal(await page.$$eval('#sheetGuides line', (lines) => lines.length), 32);
    await page.select('#guidesSelect', 'cutmarks');
    await sleep(250);
    assert.equal(await page.$$eval('#sheetGuides line', (lines) => lines.length), 64);

    await page.click('#printedLabels');
    await sleep(350);
    assert.equal(await page.$$eval('#printLabels .print-label', (labels) => labels.length), 1);
    assert.match(
      await page.$eval('#printLabels .print-label', (element) => element.textContent),
      /8 × 35\.00 × 45\.00 mm · 2\.0 mm gaps/,
    );
    await page.click('#printedLabels');
    await sleep(250);
    assert.equal(await page.$$eval('#printLabels .print-label', (labels) => labels.length), 0);

    console.log('9b. editable passport size updates the crop and sheet');
    await page.click('[data-size="35x35"]');
    await page.waitForFunction(
      () => Math.abs(window.__passportApp.getLayout().photoWidthMm - 35) < 1e-9 &&
        Math.abs(window.__passportApp.getLayout().photoHeightMm - 35) < 1e-9,
      { timeout: 5000 },
    );
    await sleep(500);
    const squareLayout = await page.evaluate(() => window.__passportApp.getLayout());
    assert.equal(squareLayout.photoWidthMm, 35);
    assert.equal(squareLayout.photoHeightMm, 35);
    assert.equal(squareLayout.aspect, 1);
    close(
      await page.evaluate(() => window.__passportApp.state.crop.aspect),
      1,
      1e-9,
      'crop square aspect',
    );
    let squareGeometry = await getSheetGeometry(page);
    close(
      squareGeometry.images[0].width / squareGeometry.images[0].height,
      1,
      0.01,
      'square sheet image',
    );

    await page.evaluate(() => {
      const width = document.getElementById('photoWidth');
      const height = document.getElementById('photoHeight');
      width.value = '40';
      height.value = '50';
      height.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(
      () => Math.abs(window.__passportApp.getLayout().photoWidthMm - 40) < 1e-9 &&
        Math.abs(window.__passportApp.getLayout().photoHeightMm - 50) < 1e-9,
      { timeout: 5000 },
    );
    await sleep(500);
    const customLayout = await page.evaluate(() => window.__passportApp.getLayout());
    assert.equal(customLayout.photoWidthMm, 40);
    assert.equal(customLayout.photoHeightMm, 50);
    assert.equal(await page.$eval('#photoWidth', (el) => el.value), '40');
    assert.equal(await page.$eval('#photoHeight', (el) => el.value), '50');
    close(customLayout.aspect, 0.8, 1e-9, 'custom aspect');
    close(
      await page.evaluate(() => window.__passportApp.state.crop.aspect),
      0.8,
      1e-9,
      'crop custom aspect',
    );
    assert.equal(customLayout.photoCount, 8);
    assert.equal(customLayout.gapMm, 2);

    await page.click('[data-size="35x45"]');
    await page.waitForFunction(
      () => Math.abs(window.__passportApp.getLayout().photoWidthMm - 35) < 1e-9 &&
        Math.abs(window.__passportApp.getLayout().photoHeightMm - 45) < 1e-9,
      { timeout: 5000 },
    );
    await sleep(600);
    const restoredLayout = await page.evaluate(() => window.__passportApp.getLayout());
    assert.equal(restoredLayout.photoWidthMm, 35);
    assert.equal(restoredLayout.photoHeightMm, 45);
    assert.equal(restoredLayout.photoCount, 8);
    assert.equal(restoredLayout.gapMm, 2);
    assert.equal(await page.$eval('#photoWidth', (el) => el.value), '35');
    assert.equal(await page.$eval('#photoHeight', (el) => el.value), '45');
    squareGeometry = await getSheetGeometry(page);
    close(
      squareGeometry.images[0].width / squareGeometry.images[0].height,
      35 / 45,
      0.01,
      'restored sheet image ratio',
    );

    console.log('10. generate full-resolution preview');
    await page.click('#btnGenerate');
    await page.waitForFunction(
      () => document.getElementById('printReadyBadge').textContent.trim() === 'Ready',
      { timeout: 20000 },
    );
    await sleep(300);
    const checkCount = await page.$$eval('#geometryChecks li', (items) => items.length);
    assert.ok(checkCount >= 7, `expected at least 7 checks, got ${checkCount}`);
    assert.equal(
      await page.$$eval('#geometryChecks li.is-fail', (items) => items.length),
      0,
      'all geometry checks should pass',
    );
    const exportCorner = await page.evaluate(() => {
      const canvas = window.__passportApp.state.exportAssets?.canvas;
      if (!canvas) return null;
      const context = canvas.getContext('2d');
      return Array.from(context.getImageData(3, 3, 1, 1).data);
    });
    assert.ok(exportCorner, 'export canvas should exist');
    assert.ok(
      exportCorner.slice(0, 3).every((value) => value > 248),
      `exported print photo should have a white background: ${exportCorner}`,
    );

    await sleep(4800); // let transient toasts clear before the review screenshot
    await page.evaluate(() => {
      document.querySelector('.sidebar-scroll')?.scrollTo({ top: 0, behavior: 'instant' });
    });
    await sleep(350);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'app-desktop.png') });
    const sheetHandle = await page.$('#sheet');
    await sheetHandle.screenshot({ path: path.join(SCREENSHOTS, 'sheet-closeup.png') });

    console.log('11. PDF bytes contain all eight selected photos on one A4 page');
    const pdfInfo = await page.evaluate(() => window.__passportApp.generatePdfBytes());
    assert.equal(pdfInfo.allPass, true);
    assert.equal(pdfInfo.layout.photos.length, 8);
    close(pdfInfo.pixels.width / pdfInfo.pixels.height, 35 / 45, 0.002, 'print pixel ratio');
    assert.ok(pdfInfo.pixels.width > 800 && pdfInfo.pixels.height > 1000);
    const pdfBuffer = Buffer.from(pdfInfo.bytes);
    const parsed = parsePdfMediaBox(pdfBuffer);
    close(parsed.widthPt, 595.2756, 0.05, 'PDF width pt');
    close(parsed.heightPt, 841.8898, 0.05, 'PDF height pt');
    close((parsed.widthPt * 25.4) / 72, 210, 0.01, 'PDF width mm');
    close((parsed.heightPt * 25.4) / 72, 297, 0.01, 'PDF height mm');
    assert.equal(pageCount(parsed.text), 1, 'PDF should have exactly one page');

    console.log('12. actual PDF download works');
    const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passport-download-'));
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
    await page.click('#btnDownload');
    let downloaded = null;
    for (let attempt = 0; attempt < 80 && !downloaded; attempt += 1) {
      await sleep(200);
      const files = (await fs.readdir(downloadDir)).filter((file) => !file.endsWith('.crdownload'));
      if (files.length) {
        const filePath = path.join(downloadDir, files[0]);
        const stats = await fs.stat(filePath);
        if (stats.size > 0) downloaded = { filePath, name: files[0], size: stats.size };
      }
    }
    assert.ok(downloaded, 'PDF download did not complete');
    assert.match(downloaded.name, /passport-photos-8up-35-00x45-00mm-a4\.pdf/);
    assert.ok(downloaded.size > 20000, 'downloaded PDF looks too small');
    const downloadedPdf = await fs.readFile(downloaded.filePath);
    const downloadedParsed = parsePdfMediaBox(downloadedPdf);
    close((downloadedParsed.widthPt * 25.4) / 72, 210, 0.01, 'downloaded PDF width');
    close((downloadedParsed.heightPt * 25.4) / 72, 297, 0.01, 'downloaded PDF height');
    assert.equal(pageCount(downloadedParsed.text), 1);

    console.log('13. print stylesheet produces the same A4 geometry');
    const printHtml = await page.evaluate(() => window.__passportApp.buildPrintHtml());
    assert.match(printHtml, /@page \{ size: 210mm 297mm; margin: 0; \}/);
    assert.equal((printHtml.match(/<img class="photo"/g) || []).length, 8);
    assert.match(printHtml, /width:35mm;height:45mm/);

    const printPage = await browser.newPage();
    await printPage.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    const printErrors = [];
    printPage.on('pageerror', (error) => printErrors.push(error.message));
    await printPage.setContent(printHtml, { waitUntil: 'load' });
    await sleep(500);
    const printGeometry = await printPage.evaluate(() => {
      const sheet = document.querySelector('.sheet').getBoundingClientRect();
      const images = [...document.querySelectorAll('.photo')].map((img) => {
        const rect = img.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      return { sheet: { width: sheet.width, height: sheet.height }, images };
    });
    const pxPerMm = printGeometry.sheet.width / 210;
    close(printGeometry.sheet.height / pxPerMm, 297, 0.5, 'print sheet height');
    assert.equal(printGeometry.images.length, 8);
    printGeometry.images.forEach((image, index) => {
      const photo = gridLayout.photos[index];
      close(image.width / pxPerMm, 35, 0.2, `print photo ${index + 1} width`);
      close(image.height / pxPerMm, 45, 0.2, `print photo ${index + 1} height`);
      close(image.x / pxPerMm, photo.x, 0.2, `print photo ${index + 1} x`);
      close(image.y / pxPerMm, photo.y, 0.2, `print photo ${index + 1} y`);
    });
    const printedPdf = await printPage.pdf({ preferCSSPageSize: true, printBackground: true });
    const printedParsed = parsePdfMediaBox(printedPdf);
    close((printedParsed.widthPt * 25.4) / 72, 210, 0.2, 'printed PDF width');
    close((printedParsed.heightPt * 25.4) / 72, 297, 0.2, 'printed PDF height');
    assert.equal(pageCount(printedParsed.text), 1, 'print document must stay one page');
    assert.deepEqual(printErrors, []);
    await printPage.close();

    console.log('14. print dialog and instructions');
    await page.click('#btnPrint');
    await page.waitForFunction(() => document.getElementById('printDialog').open, { timeout: 15000 });
    assert.match(
      await page.$eval('#printSummary', (element) => element.textContent),
      /8 photos · A4 portrait · 35\.00 × 45\.00 mm each/,
    );
    assert.match(
      await page.$eval('#printWarning', (element) => element.textContent),
      /side margins|Actual size|Print at/i,
    );
    await page.click('#btnCancelPrint');
    assert.equal(await page.$eval('#printDialog', (dialog) => dialog.open), false);

    console.log('15. replacing the photo updates every selected copy');
    const oldSrc = (await getSheetGeometry(page)).images[0].src;
    await (await page.$('#fileInput')).uploadFile(replacementPath);
    await page.waitForFunction(
      () => document.getElementById('photoName').textContent === 'replacement.png',
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll('#sheetPhotos img').length === 8,
      { timeout: 20000 },
    );
    await sleep(900);
    const replacedGeometry = await getSheetGeometry(page);
    assert.notEqual(replacedGeometry.images[0].src, oldSrc);
    assert.equal(replacedGeometry.images.length, 8);
    assert.ok(replacedGeometry.images.every((image) => image.src === replacedGeometry.images[0].src));
    close(replacedGeometry.images[0].width * replacedGeometry.mmPerPx, 35, 0.2);

    console.log('16. mobile camera capture, layout and direct print/share');
    const mobile = await browser.newPage();
    const mobileErrors = [];
    mobile.on('pageerror', (error) => mobileErrors.push(error.message));
    await mobile.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    );
    await mobile.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await mobile.evaluateOnNewDocument(() => {
      window.__sharedFile = null;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => Boolean(data && data.files && data.files.length),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          const file = data?.files?.[0];
          window.__sharedFile = file
            ? { name: file.name, size: file.size, type: file.type }
            : null;
        },
      });
    });
    await mobile.goto(server.url, { waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('#uploadCard');
    await mobile.waitForFunction(
      () =>
        getComputedStyle(document.getElementById('btnOpenSidebar')).display !== 'none' &&
        getComputedStyle(document.getElementById('sidebar')).position === 'fixed',
      { timeout: 8000 },
    );
    await sleep(400);

    assert.equal(await mobile.evaluate(() => window.__passportApp.isMobileDevice()), true);
    assert.equal(
      await mobile.evaluate(() => window.__passportApp.state.stage),
      'photo',
    );
    const drawerClosed = await mobile.evaluate(() => {
      const sidebar = document.getElementById('sidebar').getBoundingClientRect();
      const toggle = document.getElementById('btnOpenSidebar');
      return {
        offscreen: sidebar.right <= 1,
        toggleVisible:
          toggle.getClientRects().length > 0 &&
          getComputedStyle(toggle).display !== 'none' &&
          getComputedStyle(toggle).visibility !== 'hidden',
        emptyVisible: !document.getElementById('sheetEmpty').hidden,
        label: document.getElementById('sidebarToggleLabel').textContent,
      };
    });
    assert.equal(drawerClosed.offscreen, true, 'sidebar starts off-canvas on a phone');
    assert.equal(drawerClosed.toggleVisible, true);
    assert.equal(drawerClosed.emptyVisible, true);
    assert.equal(drawerClosed.label, 'Upload');
    assert.equal(
      await mobile.$eval('.capture-actions', (element) => getComputedStyle(element).display),
      'grid',
    );
    assert.equal(
      await mobile.$eval('#cameraInput', (element) => element.getAttribute('capture')),
      'user',
    );
    assert.equal(
      await mobile.$eval('#cameraInput', (element) => element.getAttribute('accept')),
      'image/*',
    );
    assert.equal(
      await mobile.$eval('#btnInstall', (element) => element.offsetParent !== null),
      true,
      'install button should be visible on a non-installed phone',
    );
    await mobile.click('#btnInstall');
    await mobile.waitForFunction(() => document.getElementById('installDialog').open, {
      timeout: 5000,
    });
    assert.match(
      await mobile.$eval('#installSteps', (element) => element.textContent),
      /Add to Home Screen/i,
    );
    await mobile.click('#btnDoneInstall');

    await mobile.click('#btnOpenSidebar');
    await mobile.waitForFunction(() => document.body.classList.contains('sidebar-open'), {
      timeout: 3000,
    });
    await sleep(350);
    assert.equal(
      await mobile.$eval('#btnTakePhoto', (element) => element.offsetParent !== null),
      true,
      'Take Photo must be reachable in the mobile settings drawer',
    );
    await sleep(700);
    await mobile.screenshot({
      path: path.join(SCREENSHOTS, 'app-mobile-upload.png'),
      fullPage: false,
    });

    // Simulate the file a camera capture returns and feed it through the camera input.
    await (await mobile.$('#cameraInput')).uploadFile(portraitPath);
    await mobile.waitForFunction(() => !document.getElementById('workspace').hidden, {
      timeout: 20000,
    });
    await mobile.waitForFunction(
      () => document.querySelectorAll('#sheetPhotos img').length === 6,
      { timeout: 20000 },
    );
    await sleep(1200);
    assert.equal(
      await mobile.$eval('#btnRetake', (element) => element.offsetParent !== null),
      true,
      'Retake must be reachable on mobile',
    );
    await mobile.click('#btnCloseSidebar');
    await mobile.waitForFunction(() => !document.body.classList.contains('sidebar-open'), {
      timeout: 3000,
    });
    await sleep(400);

    const overflow = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.innerWidth + 1,
      `horizontal overflow: ${overflow.scrollWidth} > ${overflow.innerWidth}`,
    );
    const mobileGeometry = await getSheetGeometry(mobile);
    assert.equal(mobileGeometry.images.length, 6);
    close(mobileGeometry.images[0].width * mobileGeometry.mmPerPx, 35, 0.3, 'mobile photo width');
    assert.equal(
      await mobile.$eval('#sidebarToggleLabel', (element) => element.textContent),
      'Adjust photo',
    );
    await mobile.screenshot({ path: path.join(SCREENSHOTS, 'app-mobile.png'), fullPage: false });

    await mobile.click('#btnOpenSidebar');
    await sleep(300);
    await mobile.$eval('#btnToPrint', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await mobile.click('#btnToPrint');
    await mobile.waitForFunction(() => !document.getElementById('stagePrint').hidden, {
      timeout: 5000,
    });
    await mobile.$eval('#btnPrint', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await mobile.click('#btnPrint');
    await mobile.waitForFunction(() => document.getElementById('printDialog').open, {
      timeout: 20000,
    });
    assert.equal(
      await mobile.$eval('#btnConfirmPrint', (element) => element.textContent.trim()),
      'Print / Share PDF',
    );
    assert.equal(await mobile.$eval('#btnSavePdfPrint', (element) => element.hidden), false);
    await mobile.screenshot({
      path: path.join(SCREENSHOTS, 'app-mobile-print.png'),
      fullPage: false,
    });
    await mobile.click('#btnConfirmPrint');
    await mobile.waitForFunction(() => window.__sharedFile !== null, { timeout: 20000 });
    const shared = await mobile.evaluate(() => window.__sharedFile);
    assert.match(shared.name, /passport-photos-6up-35-00x45-00mm-a4\.pdf/);
    assert.equal(shared.type, 'application/pdf');
    assert.ok(shared.size > 20000, 'shared print PDF should be a real file');
    assert.equal(await mobile.$eval('#printDialog', (dialog) => dialog.open), false);

    // Without Web Share (common on plain-HTTP phones) the same button must
    // still print directly, using the exact-size print portal.
    await mobile.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
      window.__printCalled = false;
      window.__printPortalImages = 0;
      window.__printPortalGuides = 0;
      window.__originalPrint = window.print;
      window.print = () => {
        window.__printCalled = true;
        window.__printPortalImages = document.querySelectorAll('#printPortal img').length;
        window.__printPortalGuides = document.querySelectorAll('#printPortal svg line').length;
      };
    });
    await mobile.$eval('#btnPrint', (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await mobile.click('#btnPrint');
    await mobile.waitForFunction(() => document.getElementById('printDialog').open, {
      timeout: 20000,
    });
    await mobile.click('#btnConfirmPrint');
    await mobile.waitForFunction(() => window.__printCalled === true, { timeout: 20000 });
    const portalInfo = await mobile.evaluate(() => ({
      images: window.__printPortalImages,
      guides: window.__printPortalGuides,
    }));
    assert.equal(portalInfo.images, 6);
    assert.ok(portalInfo.guides >= 48, `expected cut-mark lines, got ${portalInfo.guides}`);
    assert.equal(
      await mobile.evaluate(() => document.documentElement.classList.contains('has-print-portal')),
      true,
      'print portal mode should be active',
    );

    await mobile.emulateMediaType('print');
    const portalGeometry = await mobile.evaluate(() => {
      const sheet = document.querySelector('#printPortal .print-portal-sheet').getBoundingClientRect();
      const images = [...document.querySelectorAll('#printPortal img')].map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          x: rect.x - sheet.x,
          y: rect.y - sheet.y,
          width: rect.width,
          height: rect.height,
        };
      });
      return {
        sheet: { width: sheet.width, height: sheet.height },
        images,
        pxPerMm: sheet.width / 210,
      };
    });

    // The direct-print fallback must stay a single A4 portrait page.
    const portalPdf = await mobile.pdf({ preferCSSPageSize: true, printBackground: true });
    await mobile.emulateMediaType('screen');
    close(portalGeometry.sheet.height / portalGeometry.pxPerMm, 297, 0.4, 'print portal height');
    portalGeometry.images.forEach((image, index) => {
      close(image.width / portalGeometry.pxPerMm, 35, 0.2, `portal photo ${index + 1} width`);
      close(image.height / portalGeometry.pxPerMm, 45, 0.2, `portal photo ${index + 1} height`);
      close(image.x / portalGeometry.pxPerMm, index * 35, 0.2, `portal photo ${index + 1} x`);
      close(image.y / portalGeometry.pxPerMm, 0, 0.2, `portal photo ${index + 1} y`);
    });

    const portalParsed = parsePdfMediaBox(portalPdf);
    close((portalParsed.widthPt * 25.4) / 72, 210, 0.2, 'direct print width');
    close((portalParsed.heightPt * 25.4) / 72, 297, 0.2, 'direct print height');
    assert.equal(pageCount(portalParsed.text), 1, 'direct print must stay one page');

    await mobile.evaluate(() => {
      document.getElementById('printPortal')?.remove();
      document.documentElement.classList.remove('has-print-portal');
      window.print = window.__originalPrint;
    });

    assert.deepEqual(mobileErrors, []);
    await mobile.close();

    console.log('17. PWA is installable and works offline');
    const pwaPage = await browser.newPage();
    await pwaPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await pwaPage.goto(server.url, { waitUntil: 'load' });
    await pwaPage.waitForFunction(
      async () => {
        if (!('serviceWorker' in navigator)) return false;
        const registration = await navigator.serviceWorker.ready;
        return Boolean(registration.active);
      },
      { timeout: 30000 },
    );
    if (!(await pwaPage.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await pwaPage.reload({ waitUntil: 'load' });
    }
    await pwaPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {
      timeout: 30000,
    });
    const manifestProbe = await pwaPage.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const response = await fetch(link.href);
      const data = await response.json();
      return {
        status: response.status,
        display: data.display,
        icons: data.icons.length,
        name: data.name,
        cacheKeys: await caches.keys(),
      };
    });
    assert.equal(manifestProbe.status, 200);
    assert.equal(manifestProbe.display, 'standalone');
    assert.equal(manifestProbe.icons, 3);
    assert.ok(manifestProbe.cacheKeys.some((key) => key.startsWith('passport-photo-maker-')));

    const installability = await pwaPage.createCDPSession();
    const installabilityResult = await installability.send('Page.getInstallabilityErrors');
    assert.deepEqual(
      installabilityResult.installabilityErrors,
      [],
      `installability errors: ${JSON.stringify(installabilityResult.installabilityErrors)}`,
    );

    await pwaPage.setOfflineMode(true);
    await pwaPage.reload({ waitUntil: 'domcontentloaded' });
    await pwaPage.waitForSelector('#uploadCard');
    assert.equal(
      await pwaPage.$eval('#uploadCard', (element) => !element.hidden && element.offsetParent !== null),
      true,
      'offline launch should show the app shell',
    );
    assert.match(await pwaPage.title(), /Passport Photo Maker/);
    await pwaPage.setOfflineMode(false);
    await pwaPage.close();

    console.log('18. face detection failure falls back to a manual crop');
    // Use an isolated context so the PWA's cached MediaPipe assets cannot mask
    // the simulated load failure.
    const offlineContext = await browser.createBrowserContext();
    const offline = await offlineContext.newPage();
    await offline.setRequestInterception(true);
    offline.on('request', (request) => {
      if (request.url().includes('/vendor/mediapipe/')) {
        request.abort();
      } else {
        request.continue();
      }
    });
    const offlineErrors = [];
    offline.on('pageerror', (error) => offlineErrors.push(error.message));
    const offlineCdp = await offline.createCDPSession();
    await offlineCdp.send('Network.enable');
    await offlineCdp.send('Network.setBypassServiceWorker', { bypass: true });
    await offlineCdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await offline.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await offline.goto(mediapipeFailServer.url, { waitUntil: 'domcontentloaded' });
    await (await offline.$('#fileInput')).uploadFile(portraitPath);
    await offline.waitForFunction(() => !document.getElementById('workspace').hidden, {
      timeout: 20000,
    });
    await offline.waitForFunction(
      () => document.getElementById('faceStatus').dataset.state === 'warn',
      { timeout: 40000 },
    );
    assert.match(
      await offline.$eval('#faceStatusText', (element) => element.textContent),
      /unavailable|No face|centred/i,
    );
    await offline.waitForFunction(
      () => document.querySelectorAll('#sheetPhotos img').length === 6,
      { timeout: 20000 },
    );
    const offlineZoom = await offline.evaluate(() => {
      const slider = document.getElementById('cropZoom');
      slider.value = '1.6';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return window.__passportApp.state.crop.zoom;
    });
    close(offlineZoom, 1.6, 0.01, 'manual crop still works after detection failure');
    assert.deepEqual(offlineErrors, []);
    await offlineContext.close();

    console.log('19. removing the photo returns to the empty state');
    await page.click('#btnRemove');
    await sleep(400);
    assert.equal(await page.$eval('#workspace', (element) => element.hidden), true);
    assert.equal(await page.$eval('#uploadCard', (element) => element.hidden), false);
    assert.equal(await page.$eval('#btnDownload', (button) => button.disabled), true);

    assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
    assert.deepEqual(externalRequests, [], `external requests: ${externalRequests.join('\n')}`);
    console.log('\nAll end-to-end checks passed.');
  } catch (error) {
    failed = true;
    console.error('\nE2E FAILED:', error);
    if (errors.length) console.error('Browser errors:\n' + errors.join('\n'));
    await page
      .screenshot({ path: path.join(SCREENSHOTS, 'failure.png'), fullPage: false })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await server.close();
    await mediapipeFailServer.close();
    if (failed) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
