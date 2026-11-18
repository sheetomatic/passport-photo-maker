/* Passport Photo Maker service worker — versioned shell, offline fallback, vendor cache. */
const CACHE_VERSION = 'ppm-v5';
const CACHE = `passport-photo-maker-${CACHE_VERSION}`;
const ASSET_VERSION = '5';

const CORE_ASSETS = [
  './',
  './index.html',
  // Versioned shell assets: the page loads these exact URLs, so a deploy can
  // never mix new HTML with an old cached stylesheet or module.
  './styles.css?v=5',
  './js/app.js?v=5',
  './js/geometry.js?v=5',
  './js/crop.js?v=5',
  './js/image-processing.js?v=5',
  './js/face-detect.js?v=5',
  './js/background.js?v=5',
  './js/pdf.js?v=5',
  './js/print.js?v=5',
  './js/pwa.js?v=5',
  // Keep the unversioned copies too so an older open tab cannot break when the
  // previous cache is removed during activation.
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/geometry.js',
  './js/crop.js',
  './js/image-processing.js',
  './js/face-detect.js',
  './js/background.js',
  './js/pdf.js',
  './js/print.js',
  './js/pwa.js',
  './vendor/jspdf.umd.min.js',
  './vendor/mediapipe/selfie_segmenter.tflite',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' bypasses the browser HTTP cache, which GitHub Pages
      // holds for 10 minutes and which previously caused stale CSS to be
      // written into a brand-new service-worker cache.
      .then((cache) =>
        cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('passport-photo-maker-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheResponse(request, response) {
  if (!response || response.status !== 200) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(event, fallbackUrl = null) {
  const { request } = event;
  try {
    const response = await fetch(new Request(request, { cache: 'no-cache' }));
    if (response && response.status === 200) {
      await cacheResponse(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request)) ||
      (fallbackUrl ? await caches.match(fallbackUrl) : null) ||
      Response.error()
    );
  }
}

async function handleNavigation(event) {
  try {
    const response = await fetch(new Request(event.request, { cache: 'no-cache' }));
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('./index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Vendor models and WASM are large and immutable; cache them once.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => cacheResponse(request, response)),
      ),
    );
    return;
  }

  // The app shell is always checked against the network when online. This is
  // the critical bit that prevents mixed versions after a deployment.
  if (/\.(?:css|js|mjs|json|html)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(event));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => cached);
      return cached || network;
    }),
  );
});
