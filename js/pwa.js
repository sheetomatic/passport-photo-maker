/**
 * PWA glue: service worker, install button, iOS Add-to-Home-Screen steps.
 * Registration failures are non-fatal — the app still works online.
 */

const swSupported = 'serviceWorker' in navigator;
const hadServiceWorkerController = Boolean(navigator.serviceWorker?.controller);
let reloadingForUpdate = false;

// If this page was controlled by an older worker and a new version takes over,
// reload once so HTML, CSS and JS all come from the same build.
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!hadServiceWorkerController || reloadingForUpdate) return;
  reloadingForUpdate = true;
  window.location.reload();
});

window.__PASSPORT_APP_VERSION__ = '7';

const standalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOSNonSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
const isAndroid = /Android/i.test(ua);
const isTouchMobile = window.matchMedia?.('(pointer: coarse)').matches || isIOS || isAndroid;

let deferredPrompt = null;
let installed = false;

const btnInstall = document.getElementById('btnInstall');
const installDialog = document.getElementById('installDialog');
const installSteps = document.getElementById('installSteps');
const installSummary = document.getElementById('installSummary');
const btnCloseInstall = document.getElementById('btnCloseInstall');
const btnDoneInstall = document.getElementById('btnDoneInstall');

function syncInstallButton() {
  if (!btnInstall) return;
  const available = !standalone && !installed && (deferredPrompt || isTouchMobile);
  btnInstall.hidden = !available;
}

function setInstallSteps(steps) {
  installSteps.replaceChildren(
    ...steps.map((step, index) => {
      const item = document.createElement('li');
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      const copy = document.createElement('p');
      copy.innerHTML = step;
      item.append(number, copy);
      return item;
    }),
  );
}

function openInstallDialog() {
  if (!installDialog) return;

  if (isIOSNonSafari) {
    installSummary.textContent =
      'On iPhone and iPad, “Add to Home Screen” is available in Safari.';
    setInstallSteps([
      'Open this page in <strong>Safari</strong>.',
      'Tap the <strong>Share</strong> button in the toolbar.',
      'Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.',
    ]);
  } else if (isIOS) {
    installSummary.textContent =
      'Add the app to your Home Screen for full-screen access.';
    setInstallSteps([
      'Tap the <strong>Share</strong> button in Safari’s toolbar.',
      'Choose <strong>Add to Home Screen</strong>.',
      'Tap <strong>Add</strong> in the top-right corner.',
    ]);
  } else if (isAndroid) {
    installSummary.textContent =
      'Add the app to your Home Screen for full-screen access.';
    setInstallSteps([
      'Open the browser menu (<strong>⋮</strong>).',
      'Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.',
      'Confirm the install.',
    ]);
  } else {
    installSummary.textContent =
      'Install the app in your browser for a standalone window and offline access.';
    setInstallSteps([
      'Click the install icon in the address bar, or open the browser menu.',
      'Choose <strong>Install Passport Photo Maker</strong>.',
    ]);
  }

  if (typeof installDialog.showModal === 'function') {
    installDialog.showModal();
  } else {
    installDialog.setAttribute('open', '');
  }
}

function closeInstallDialog() {
  if (!installDialog) return;
  if (typeof installDialog.close === 'function') installDialog.close();
  else installDialog.removeAttribute('open');
}

btnInstall?.addEventListener('click', async () => {
  // iOS has no beforeinstallprompt; Safari installs through Share → Add to
  // Home Screen, so always show those instructions there.
  if (deferredPrompt && !isIOS) {
    deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        installed = true;
        syncInstallButton();
      }
    } catch {
      // The prompt can be dismissed; instructions remain available next time.
    }
    deferredPrompt = null;
    syncInstallButton();
    return;
  }
  openInstallDialog();
});

btnCloseInstall?.addEventListener('click', closeInstallDialog);
btnDoneInstall?.addEventListener('click', closeInstallDialog);
installDialog?.addEventListener('click', (event) => {
  if (event.target === installDialog) closeInstallDialog();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  syncInstallButton();
});

window.addEventListener('appinstalled', () => {
  installed = true;
  deferredPrompt = null;
  syncInstallButton();
});

window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', () => {
  syncInstallButton();
});

syncInstallButton();

if (swSupported) {
  window.addEventListener('load', async () => {
    try {
      const swUrl = new URL('../sw.js', import.meta.url);
      const scope = new URL('../', import.meta.url).pathname;
      const registration = await navigator.serviceWorker.register(swUrl, { scope });
      // Let a new build take over promptly; the shell is versioned by sw.js.
      await navigator.serviceWorker.ready;
      registration.update?.().catch(() => {});
    } catch (error) {
      // Plain-HTTP LAN access cannot register a service worker. The app and
      // camera still work; install/offline are HTTPS-only features.
      console.warn('Service worker registration skipped:', error);
    }
  });
}
