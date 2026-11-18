import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

function pngSize(file) {
  const buffer = fs.readFileSync(path.join(ROOT, file));
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${file} should be a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('manifest is installable and scoped to the app directory', () => {
  assert.equal(manifest.name, 'Passport Photo Maker');
  assert.equal(manifest.short_name, 'Passport Pix');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.display_override.includes('standalone'));
  assert.equal(manifest.orientation, 'portrait');
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.prefer_related_applications, false);
});

test('manifest icons exist at the declared sizes, including maskable', () => {
  assert.ok(manifest.icons.length >= 3);
  for (const icon of manifest.icons) {
    const [width, height] = icon.sizes.split('x').map(Number);
    const size = pngSize(icon.src.replace('./', ''));
    assert.equal(size.width, width, `${icon.src} width`);
    assert.equal(size.height, height, `${icon.src} height`);
    assert.ok(['any', 'maskable'].includes(icon.purpose));
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'));
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/apple-touch-icon.png')));
  assert.ok(fs.existsSync(path.join(ROOT, 'icons/favicon-32.png')));
});

test('manifest screenshots exist and match their advertised sizes', () => {
  for (const screenshot of manifest.screenshots) {
    const [width, height] = screenshot.sizes.split('x').map(Number);
    const size = pngSize(screenshot.src.replace('./', ''));
    assert.equal(size.width, width);
    assert.equal(size.height, height);
    assert.ok(['narrow', 'wide'].includes(screenshot.form_factor));
  }
});

test('HTML wires the manifest, icons, theme and PWA script', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.match(html, /<meta name="theme-color" content="#f5f4f1">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<script type="module" src="js\/pwa\.js\?v=4"><\/script>/);
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /"#app\/geometry": "\.\/js\/geometry\.js\?v=4"/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css\?v=4">/);
  assert.match(html, /id="btnInstall"/);
  assert.match(html, /id="installDialog"/);
});

test('service worker precaches the shell and supports offline navigation', () => {
  const sw = read('sw.js');
  assert.match(sw, /CACHE_VERSION/);
  assert.match(sw, /addEventListener\('install'/);
  assert.match(sw, /addEventListener\('activate'/);
  assert.match(sw, /addEventListener\('fetch'/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /\.\/index\.html/);
  assert.match(sw, /vendor\/jspdf\.umd\.min\.js/);
  assert.match(sw, /vendor\/mediapipe\//);
  assert.match(sw, /selfie_segmenter\.tflite/);
  assert.match(sw, /js\/background\.js/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')));
});
