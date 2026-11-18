/**
 * app.js — wiring for the Passport Photo Maker.
 *
 * Flow: upload -> analyse/enhance -> crop at the selected passport ratio
 * (optional face suggestion) -> live A4 sheet preview -> full-resolution
 * render -> PDF / print.
 */

import {
  computeLayout,
  verifyLayout,
  pixelSizeForPhoto,
  layoutKey,
  mm,
  LIMITS,
  buildGuideSegments,
} from '#app/geometry';
import {
  loadPhoto,
  renderCrop,
  renderEditorImage,
  canvasToDataUrl,
  validatePhotoFile,
  UserError,
  DEFAULT_ENHANCE_SETTINGS,
} from '#app/image-processing';
import {
  createCropState,
  getCropRect,
  cropFractions,
  panCropByPixels,
  setCropZoom,
  setCropAspect,
  suggestCropFromFace,
} from '#app/crop';
import { detectFace } from '#app/face-detect';
import { createBackgroundMask } from '#app/background';
import { buildPdfDocument, pdfBytes } from '#app/pdf';
import { buildPrintDocument, printHtmlDocument } from '#app/print';

const PREVIEW_MAX_SIDE = 540;
const PREVIEW_EDITOR_SIDE = 1200;

const $ = (id) => document.getElementById(id);

const els = {
  sidebar: $('sidebar'),
  sidebarBackdrop: $('sidebarBackdrop'),
  btnOpenSidebar: $('btnOpenSidebar'),
  btnCloseSidebar: $('btnCloseSidebar'),
  sidebarToggleLabel: $('sidebarToggleLabel'),
  sidebarStageTitle: $('sidebarStageTitle'),
  stagePhoto: $('stagePhoto'),
  stagePrint: $('stagePrint'),
  stageRailPhoto: $('stageRailPhoto'),
  stageRailPrint: $('stageRailPrint'),
  btnToPrint: $('btnToPrint'),
  btnBackToPhoto: $('btnBackToPhoto'),
  previewStageLabel: $('previewStageLabel'),
  sheetEmpty: $('sheetEmpty'),

  uploadCard: $('uploadCard'),
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  cameraInput: $('cameraInput'),
  btnTakePhoto: $('btnTakePhoto'),
  btnChoosePhoto: $('btnChoosePhoto'),
  btnRetake: $('btnRetake'),
  uploadError: $('uploadError'),
  uploadBusy: $('uploadBusy'),
  workspace: $('workspace'),

  photoThumb: $('photoThumb'),
  photoName: $('photoName'),
  photoDims: $('photoDims'),
  photoSize: $('photoSize'),
  btnReplace: $('btnReplace'),
  btnRemove: $('btnRemove'),

  optOriginal: $('optOriginal'),
  optEnhanced: $('optEnhanced'),
  thumbOriginal: $('thumbOriginal'),
  thumbEnhanced: $('thumbEnhanced'),
  enhanceStatus: $('enhanceStatus'),
  strength: $('strength'),
  strengthValue: $('strengthValue'),
  brightness: $('brightness'),
  brightnessValue: $('brightnessValue'),
  contrast: $('contrast'),
  contrastValue: $('contrastValue'),
  warmth: $('warmth'),
  warmthValue: $('warmthValue'),
  sharpness: $('sharpness'),
  sharpnessValue: $('sharpnessValue'),
  smoothing: $('smoothing'),
  smoothingValue: $('smoothingValue'),
  btnResetEnhance: $('btnResetEnhance'),
  btnUseEnhanced: $('btnUseEnhanced'),
  bgToggle: $('bgToggle'),
  bgOptions: $('bgOptions'),
  bgCustom: $('bgCustom'),
  bgCustomSwatch: $('bgCustomSwatch'),
  bgCustomOption: $('bgCustomOption'),
  bgFeather: $('bgFeather'),
  bgFeatherValue: $('bgFeatherValue'),
  bgStatus: $('bgStatus'),
  bgStatusText: $('bgStatusText'),
  bgWarning: $('bgWarning'),

  cropFrame: $('cropFrame'),
  cropImage: $('cropImage'),
  cropZoom: $('cropZoom'),
  btnZoomOut: $('btnZoomOut'),
  btnZoomIn: $('btnZoomIn'),
  faceStatus: $('faceStatus'),
  faceStatusText: $('faceStatusText'),
  btnResetCrop: $('btnResetCrop'),
  btnDetectFace: $('btnDetectFace'),

  posTop: $('posTop'),
  posCentre: $('posCentre'),
  photoWidth: $('photoWidth'),
  photoHeight: $('photoHeight'),
  countHint: $('countHint'),
  countMinus: $('countMinus'),
  countPlus: $('countPlus'),
  countValue: $('countValue'),
  gapMinus: $('gapMinus'),
  gapPlus: $('gapPlus'),
  gapValue: $('gapValue'),
  layoutSummary: $('layoutSummary'),
  actualSize: $('actualSize'),
  guidesSelect: $('guidesSelect'),
  dpiSelect: $('dpiSelect'),
  printedLabels: $('printedLabels'),
  showMeasurements: $('showMeasurements'),
  printerWarning: $('printerWarning'),

  printReadyBadge: $('printReadyBadge'),
  geometryChecks: $('geometryChecks'),
  exportNote: $('exportNote'),

  sheet: $('sheet'),
  sheetPhotos: $('sheetPhotos'),
  sheetGuides: $('sheetGuides'),
  measureOverlay: $('measureOverlay'),
  printLabels: $('printLabels'),
  previewSub: $('previewSub'),
  modeBadge: $('modeBadge'),
  captionDims: $('captionDims'),
  metrics: $('metrics'),

  btnPrint: $('btnPrint'),
  btnGenerate: $('btnGenerate'),
  btnDownload: $('btnDownload'),
  summaryDot: $('summaryDot'),
  summaryTitle: $('summaryTitle'),
  summarySub: $('summarySub'),

  printDialog: $('printDialog'),
  printSummary: $('printSummary'),
  printWarning: $('printWarning'),
  btnClosePrint: $('btnClosePrint'),
  btnCancelPrint: $('btnCancelPrint'),
  btnSavePdfPrint: $('btnSavePdfPrint'),
  btnConfirmPrint: $('btnConfirmPrint'),
  toasts: $('toasts'),
};

const state = {
  photo: null,
  photoSeq: 0,
  loadSeq: 0,
  crop: null,
  enhance: { enabled: true, ...DEFAULT_ENHANCE_SETTINGS },
  background: { enabled: false, color: '#ffffff', feather: 20 },
  backgroundTimer: 0,
  layout: {
    photoCount: LIMITS.photoCount.default,
    photoWidthMm: LIMITS.photoWidthMm.default,
    photoHeightMm: LIMITS.photoHeightMm.default,
    gapMm: LIMITS.gapMm.default,
    verticalPlacement: 'top',
    verticalOffsetMm: 0,
  },
  guides: 'cutmarks',
  printedLabels: false,
  showMeasurements: true,
  dpi: 600,
  stage: 'photo',
  cropTouched: false,
  faceBusy: false,
  busy: false,
  printDialogOpen: false,
  exportAssets: null,
  previewDataUrl: null,
  editorOriginalUrl: null,
  editorEnhancedUrl: null,
  enhancedSettingsKey: null,
  sheetTimer: 0,
  editorTimer: 0,
};

let cropDrag = null;

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

function init() {
  syncEnhanceInputs();
  syncLayoutInputs();
  syncBackgroundUI();
  bindEvents();
  updateStepper();
  updateActionState();
  updateLayoutUI();
  if (els.sheetGuides) els.sheetGuides.replaceChildren();
}

function bindEvents() {
  els.dropzone.addEventListener('click', () => {
    if (!state.busy) els.fileInput.click();
  });
  els.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  });
  els.cameraInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) handleFile(file);
  });
  els.btnTakePhoto.addEventListener('click', openCamera);
  els.btnRetake.addEventListener('click', openCamera);
  els.btnChoosePhoto.addEventListener('click', () => els.fileInput.click());

  els.dropzone.addEventListener('dragenter', onDragOver);
  els.dropzone.addEventListener('dragover', onDragOver);
  els.dropzone.addEventListener('dragleave', onDragLeave);
  els.dropzone.addEventListener('dragend', onDragLeave);
  els.dropzone.addEventListener('drop', onDrop);

  // Dropping anywhere else should not navigate away from the app.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  els.btnReplace.addEventListener('click', () => els.fileInput.click());
  els.btnRemove.addEventListener('click', removePhoto);

  els.optOriginal.addEventListener('click', () => setEnhancementMode('original'));
  els.optEnhanced.addEventListener('click', () => setEnhancementMode('enhanced'));
  els.btnUseEnhanced.addEventListener('click', () => setEnhancementMode('enhanced'));

  for (const input of [
    els.strength,
    els.brightness,
    els.contrast,
    els.warmth,
    els.sharpness,
    els.smoothing,
  ]) {
    input.addEventListener('input', onEnhanceInput);
  }
  els.btnResetEnhance.addEventListener('click', resetEnhancement);

  els.bgToggle.addEventListener('click', () => {
    setBackgroundEnabled(!state.background.enabled);
  });
  els.bgOptions.querySelectorAll('[data-bg]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.bg;
      if (value === 'original') {
        setBackgroundEnabled(false);
      } else {
        setBackgroundEnabled(true, value);
      }
    });
  });
  els.bgCustom.addEventListener('input', () => {
    state.background.color = els.bgCustom.value;
    if (!state.background.enabled) {
      setBackgroundEnabled(true, state.background.color);
    } else {
      syncBackgroundUI();
      scheduleBackgroundRefresh();
    }
  });
  els.bgFeather.addEventListener('input', () => {
    state.background.feather = Number(els.bgFeather.value);
    els.bgFeatherValue.textContent = String(state.background.feather);
    if (state.background.enabled) scheduleBackgroundRefresh();
  });

  els.cropFrame.addEventListener('pointerdown', onCropPointerDown);
  els.cropFrame.addEventListener('pointermove', onCropPointerMove);
  els.cropFrame.addEventListener('pointerup', onCropPointerUp);
  els.cropFrame.addEventListener('pointercancel', onCropPointerUp);
  els.cropFrame.addEventListener('wheel', onCropWheel, { passive: false });
  els.cropFrame.addEventListener('keydown', onCropKeyDown);
  els.cropZoom.addEventListener('input', () => {
    if (!state.crop) return;
    state.crop = setCropZoom(state.crop, Number(els.cropZoom.value));
    state.cropTouched = true;
    syncCropImage();
    scheduleSheet(160);
  });
  els.btnZoomIn.addEventListener('click', () => nudgeZoom(1.18));
  els.btnZoomOut.addEventListener('click', () => nudgeZoom(1 / 1.18));
  els.btnResetCrop.addEventListener('click', resetCrop);
  els.btnDetectFace.addEventListener('click', () => runFaceDetection({ manual: true }));

  els.posTop.addEventListener('click', () => setPlacement('top'));
  els.posCentre.addEventListener('click', () => setPlacement('centre'));

  els.countMinus.addEventListener('click', () => changePhotoCount(-1));
  els.countPlus.addEventListener('click', () => changePhotoCount(1));
  els.gapMinus.addEventListener('click', () => changeGap(-LIMITS.gapMm.step));
  els.gapPlus.addEventListener('click', () => changeGap(LIMITS.gapMm.step));
  for (const button of document.querySelectorAll('[data-count]')) {
    button.addEventListener('click', () => setPhotoCount(Number(button.dataset.count)));
  }
  for (const button of document.querySelectorAll('[data-gap]')) {
    button.addEventListener('click', () => setGap(Number(button.dataset.gap)));
  }
  for (const button of document.querySelectorAll('[data-size]')) {
    button.addEventListener('click', () => {
      const [width, height] = button.dataset.size.split('x').map(Number);
      applyPhotoSize(width, height, { announce: true });
    });
  }
  for (const input of [els.photoWidth, els.photoHeight]) {
    input.addEventListener('change', onSizeInput);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  els.btnToPrint.addEventListener('click', () => setStage('print'));
  els.btnBackToPhoto.addEventListener('click', () => setStage('photo'));
  els.btnOpenSidebar.addEventListener('click', () => setSidebarOpen(true));
  els.btnCloseSidebar.addEventListener('click', () => setSidebarOpen(false));
  els.sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      setSidebarOpen(false);
    }
  });
  els.guidesSelect.addEventListener('change', () => {
    state.guides = els.guidesSelect.value;
    refreshLayout();
  });
  els.dpiSelect.addEventListener('change', () => {
    state.dpi = Number(els.dpiSelect.value) === 300 ? 300 : 600;
    refreshLayout();
    toast('Print quality updated. Regenerate before downloading.', 'success', 3000);
  });
  els.printedLabels.addEventListener('change', () => {
    state.printedLabels = els.printedLabels.checked;
    refreshLayout();
  });
  els.showMeasurements.addEventListener('change', () => {
    state.showMeasurements = els.showMeasurements.checked;
    refreshLayout();
  });

  els.btnGenerate.addEventListener('click', () => generatePreview(els.btnGenerate));
  els.btnDownload.addEventListener('click', downloadPdf);
  els.btnPrint.addEventListener('click', openPrintDialog);

  els.btnClosePrint.addEventListener('click', closePrintDialog);
  els.btnCancelPrint.addEventListener('click', closePrintDialog);
  els.btnSavePdfPrint.addEventListener('click', savePrintPdf);
  els.btnConfirmPrint.addEventListener('click', confirmPrint);
  els.printDialog.addEventListener('close', () => {
    state.printDialogOpen = false;
  });
  els.printDialog.addEventListener('cancel', () => {
    state.printDialogOpen = false;
  });

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => syncCropImage());
    observer.observe(els.cropFrame);
  } else {
    window.addEventListener('resize', syncCropImage);
  }

  exposeTestApi();
}

/* ------------------------------------------------------------------ */
/* Upload                                                             */
/* ------------------------------------------------------------------ */

function openCamera() {
  if (state.busy) return;
  els.cameraInput.click();
}

function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  els.btnOpenSidebar.setAttribute('aria-expanded', String(open));
  if (open) {
    window.requestAnimationFrame(() => els.btnCloseSidebar.focus());
  } else {
    els.btnOpenSidebar.focus({ preventScroll: true });
  }
}

function setStage(stage) {
  if (stage === 'print' && !state.photo) return;
  state.stage = stage === 'print' ? 'print' : 'photo';
  updateStepper();
  const scroll = els.sidebar.querySelector('.sidebar-scroll');
  scroll?.scrollTo({ top: 0, behavior: 'smooth' });
  if (state.stage === 'photo') {
    window.requestAnimationFrame(() => syncCropImage());
  }
}

function setPhotoCount(value) {
  const requested = Math.round(
    Math.min(LIMITS.photoCount.max, Math.max(LIMITS.photoCount.min, value)),
  );
  if (requested === state.layout.photoCount) return;
  state.layout = { ...state.layout, photoCount: requested };
  const layout = computeLayout(state.layout);
  if (layout.photoCount !== requested) {
    state.layout = { ...state.layout, photoCount: layout.photoCount };
    toast(
      `Only ${layout.photoCount} photo${layout.photoCount === 1 ? '' : 's'} fit at this size and gap on one A4 sheet.`,
      'error',
      4500,
    );
  }
  syncLayoutInputs();
  refreshLayout();
}

function changePhotoCount(delta) {
  setPhotoCount(state.layout.photoCount + delta);
}

function setGap(value) {
  const step = LIMITS.gapMm.step;
  const rounded = Math.round(value / step) * step;
  const next = Math.min(LIMITS.gapMm.max, Math.max(LIMITS.gapMm.min, rounded));
  if (Math.abs(next - state.layout.gapMm) < 1e-9) return;
  state.layout = { ...state.layout, gapMm: next };
  const layout = computeLayout(state.layout);
  if (layout.photoCount !== state.layout.photoCount) {
    state.layout = { ...state.layout, photoCount: layout.photoCount };
    toast(
      `Only ${layout.photoCount} photo${layout.photoCount === 1 ? '' : 's'} fit with this size and gap.`,
      'error',
      4500,
    );
  }
  syncLayoutInputs();
  refreshLayout();
}

function changeGap(delta) {
  setGap(state.layout.gapMm + delta);
}

function formatSizeValue(value) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function onSizeInput() {
  const width = Number(els.photoWidth.value);
  const height = Number(els.photoHeight.value);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    syncLayoutInputs();
    return;
  }
  applyPhotoSize(width, height, { announce: true });
}

function applyPhotoSize(widthValue, heightValue, { announce = false } = {}) {
  const width = Math.min(
    LIMITS.photoWidthMm.max,
    Math.max(LIMITS.photoWidthMm.min, Math.round(widthValue * 10) / 10),
  );
  const height = Math.min(
    LIMITS.photoHeightMm.max,
    Math.max(LIMITS.photoHeightMm.min, Math.round(heightValue * 10) / 10),
  );

  if (
    Math.abs(width - state.layout.photoWidthMm) < 1e-9 &&
    Math.abs(height - state.layout.photoHeightMm) < 1e-9
  ) {
    syncLayoutInputs();
    return;
  }

  state.layout = {
    ...state.layout,
    photoWidthMm: width,
    photoHeightMm: height,
  };
  const layout = computeLayout(state.layout);
  const limited = layout.photoCount !== state.layout.photoCount;
  state.layout = { ...state.layout, photoCount: layout.photoCount };

  if (state.crop) {
    state.crop = setCropAspect(state.crop, width / height);
    syncCropFrameAspect();
    syncCropImage();
  }

  syncLayoutInputs();
  invalidateExport(layout);
  updateLayoutUI();
  updatePrintStatus(layout);
  scheduleSheet(0);

  if (announce) {
    toast(
      limited
        ? `Photo size ${formatSizeValue(width)} × ${formatSizeValue(height)} mm. Only ${layout.photoCount} fit on this sheet, so the quantity was reduced.`
        : `Photo size ${formatSizeValue(width)} × ${formatSizeValue(height)} mm. The crop frame now matches this ratio.`,
      'success',
      4500,
    );
  }
}

function onDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  els.dropzone.classList.add('is-dragover');
}

function onDragLeave(event) {
  event.preventDefault();
  els.dropzone.classList.remove('is-dragover');
}

function onDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  els.dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
}

async function handleFile(file) {
  const hadPhoto = Boolean(state.photo);
  clearError();

  try {
    validatePhotoFile(file);
  } catch (error) {
    showError(error.message, { toastOnly: hadPhoto });
    return;
  }

  setUploadBusy(true);
  state.loadSeq += 1;
  const loadToken = state.loadSeq;
  try {
    const photo = await loadPhoto(file);
    if (loadToken !== state.loadSeq) return;
    state.photoSeq += 1;
    photo.id = `photo-${state.photoSeq}`;
    startSession(photo);
    els.uploadError.hidden = true;
    els.fileInput.value = '';
  } catch (error) {
    if (loadToken !== state.loadSeq) return;
    if (error instanceof UserError) {
      console.warn('Photo rejected:', error.message);
    } else {
      console.error('Photo load failed', error);
    }
    const message =
      error instanceof UserError
        ? error.message
        : 'We couldn’t process that photo. Please try another JPG, PNG, or WEBP file.';
    if (hadPhoto) {
      toast(message, 'error', 6000);
    } else {
      showError(message);
    }
  } finally {
    if (loadToken === state.loadSeq) {
      setUploadBusy(false);
      els.fileInput.value = '';
    }
  }
}

function startSession(photo) {
  state.photo = photo;
  state.crop = createCropState(photo.width, photo.height, {
    zoom: 1,
    aspect: getPhotoAspect(),
  });
  state.cropTouched = false;
  state.enhance = { enabled: true, ...DEFAULT_ENHANCE_SETTINGS };
  state.background = { enabled: false, color: '#ffffff', feather: 20 };
  photo.segmentMask = null;
  photo.segmentPromise = null;
  state.exportAssets = null;
  state.printAssets = null;
  state.previewDataUrl = null;
  state.editorEnhancedUrl = null;
  state.enhancedSettingsKey = null;
  state.faceBusy = false;
  window.clearTimeout(state.sheetTimer);
  window.clearTimeout(state.editorTimer);

  document.body.classList.add('has-photo');
  state.stage = 'photo';
  els.photoThumb.alt = `Uploaded photo: ${photo.name}`;
  els.cropImage.alt = `Crop preview of ${photo.name}`;
  updatePhotoCard();
  syncEnhanceInputs();
  syncLayoutInputs();
  syncBackgroundUI();
  setBgStatus('idle', 'Original background.');
  setEnhancementMode('enhanced', { rebuild: false });
  buildEditorOriginal();

  syncCropImage();
  updateSheetPreview();
  updateLayoutUI();
  updatePrintStatus();
  updateActionState();
  updateStepper();

  if (photo.warnings?.length) {
    toast(photo.warnings.join(' '), 'success', 5000);
  }

  // Build the enhanced editor image after the first paint, then detect a face.
  window.requestAnimationFrame(() => {
    scheduleEditorEnhance(0);
    runFaceDetection({ manual: false });
    els.sidebar.querySelector('.sidebar-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function updatePhotoCard() {
  const photo = state.photo;
  if (!photo) return;
  els.photoName.textContent = photo.name;
  els.photoDims.textContent = `${photo.originalWidth} × ${photo.originalHeight} px${photo.width !== photo.originalWidth ? ` · working ${photo.width} × ${photo.height}` : ''}`;
  els.photoSize.textContent = `${formatBytes(photo.size)} · ${photo.type.replace('image/', '').toUpperCase()}`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setUploadBusy(busy) {
  els.uploadBusy.hidden = !busy;
  els.dropzone.classList.toggle('is-busy', busy);
  els.dropzone.setAttribute('aria-busy', String(busy));
}

function showError(message, { toastOnly = false } = {}) {
  if (toastOnly) {
    toast(message, 'error', 6000);
    return;
  }
  els.uploadError.textContent = message;
  els.uploadError.hidden = false;
  toast(message, 'error', 5000);
}

function clearError() {
  els.uploadError.hidden = true;
  els.uploadError.textContent = '';
}

function removePhoto() {
  state.photo = null;
  state.crop = null;
  state.exportAssets = null;
  state.printAssets = null;
  state.previewDataUrl = null;
  state.editorOriginalUrl = null;
  state.editorEnhancedUrl = null;
  state.enhancedSettingsKey = null;
  state.stage = 'photo';
  state.enhance = { enabled: true, ...DEFAULT_ENHANCE_SETTINGS };
  state.background = { enabled: false, color: '#ffffff', feather: 20 };
  window.clearTimeout(state.backgroundTimer);
  state.layout = {
    photoCount: LIMITS.photoCount.default,
    photoWidthMm: LIMITS.photoWidthMm.default,
    photoHeightMm: LIMITS.photoHeightMm.default,
    gapMm: LIMITS.gapMm.default,
    verticalPlacement: 'top',
    verticalOffsetMm: 0,
  };
  state.guides = 'cutmarks';
  state.printedLabels = false;
  state.showMeasurements = true;
  state.dpi = 600;

  els.workspace.hidden = true;
  els.uploadCard.hidden = false;
  document.body.classList.remove('has-photo');
  els.cropImage.removeAttribute('src');
  els.photoThumb.removeAttribute('src');
  els.thumbOriginal.removeAttribute('src');
  els.thumbEnhanced.removeAttribute('src');
  els.sheetPhotos.replaceChildren();
  els.sheetGuides.replaceChildren();
  els.measureOverlay.replaceChildren();
  els.printLabels.replaceChildren();
  els.printReadyBadge.textContent = 'Not generated';
  clearError();
  syncEnhanceInputs();
  syncLayoutInputs();
  syncBackgroundUI();
  updateStepper();
  updateLayoutUI();
  updateActionState();
  setFaceStatus('idle', 'Face detection runs after upload.');
  setBgStatus('idle', 'Original background.');
  toast('Photo removed. Nothing was uploaded.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Enhancement                                                        */
/* ------------------------------------------------------------------ */

function getEnhanceSettings() {
  return {
    strength: Number(els.strength.value),
    brightness: Number(els.brightness.value),
    contrast: Number(els.contrast.value),
    warmth: Number(els.warmth.value),
    sharpness: Number(els.sharpness.value),
    smoothing: Number(els.smoothing.value),
  };
}

function enhanceKey() {
  const settings = getEnhanceSettings();
  return `${settings.strength}:${settings.brightness}:${settings.contrast}:${settings.warmth}:${settings.sharpness}:${settings.smoothing}`;
}

function syncEnhanceInputs() {
  els.strength.value = String(state.enhance.strength);
  els.brightness.value = String(state.enhance.brightness);
  els.contrast.value = String(state.enhance.contrast);
  els.warmth.value = String(state.enhance.warmth);
  els.sharpness.value = String(state.enhance.sharpness);
  els.smoothing.value = String(state.enhance.smoothing);
  els.strengthValue.textContent = String(state.enhance.strength);
  els.brightnessValue.textContent = formatSigned(state.enhance.brightness);
  els.contrastValue.textContent = formatSigned(state.enhance.contrast);
  els.warmthValue.textContent = formatSigned(state.enhance.warmth);
  els.sharpnessValue.textContent = String(state.enhance.sharpness);
  els.smoothingValue.textContent = String(state.enhance.smoothing);
}

function formatSigned(value) {
  const number = Number(value);
  return number > 0 ? `+${number}` : String(number);
}

function onEnhanceInput() {
  state.enhance = { ...getEnhanceSettings(), enabled: state.enhance.enabled };
  els.strengthValue.textContent = String(state.enhance.strength);
  els.brightnessValue.textContent = formatSigned(state.enhance.brightness);
  els.contrastValue.textContent = formatSigned(state.enhance.contrast);
  els.warmthValue.textContent = formatSigned(state.enhance.warmth);
  els.sharpnessValue.textContent = String(state.enhance.sharpness);
  els.smoothingValue.textContent = String(state.enhance.smoothing);
  scheduleEditorEnhance(140);
  scheduleSheet(200);
}

function resetEnhancement() {
  state.enhance = { enabled: state.enhance.enabled, ...DEFAULT_ENHANCE_SETTINGS };
  syncEnhanceInputs();
  state.enhancedSettingsKey = null;
  scheduleEditorEnhance(0);
  scheduleSheet(0);
  toast('Enhancement adjustments reset.');
}

function setEnhancementMode(mode, { rebuild = true } = {}) {
  const enhanced = mode !== 'original';
  state.enhance.enabled = enhanced;
  els.optOriginal.classList.toggle('is-selected', !enhanced);
  els.optEnhanced.classList.toggle('is-selected', enhanced);
  els.optOriginal.setAttribute('aria-pressed', String(!enhanced));
  els.optEnhanced.setAttribute('aria-pressed', String(enhanced));
  els.btnUseEnhanced.disabled = enhanced;
  els.enhanceStatus.textContent = enhanced
    ? 'Auto tone, colour, skin smoothing and detail are applied on-device. Compare with the original any time.'
    : 'Showing the original photo. Enhanced is recommended for print.';

  if (!state.photo) return;

  if (enhanced && rebuild && !state.editorEnhancedUrl) {
    buildEditorEnhancement();
  }
  const url = enhanced ? state.editorEnhancedUrl || state.editorOriginalUrl : state.editorOriginalUrl;
  if (url) {
    els.cropImage.src = url;
    els.photoThumb.src = url;
  }
  scheduleSheet(rebuild ? 30 : 180);
}

function scheduleEditorEnhance(delay = 140) {
  window.clearTimeout(state.editorTimer);
  state.editorTimer = window.setTimeout(buildEditorEnhancement, delay);
}

function getBackgroundSettings() {
  const enabled = Boolean(state.photo?.segmentMask && state.background.enabled);
  return {
    enabled,
    color: state.background.color,
    feather: state.background.feather,
  };
}

function backgroundKey() {
  return [
    state.background.enabled ? 1 : 0,
    state.background.color,
    state.background.feather,
    state.photo?.segmentMask ? 1 : 0,
  ].join(':');
}

function backgroundStatusLabel() {
  const names = {
    '#ffffff': 'White',
    '#dbe9f7': 'Pale blue',
    '#e7e5df': 'Light grey',
  };
  const name = names[String(state.background.color).toLowerCase()] || state.background.color.toUpperCase();
  return `Background removed · ${name}.`;
}

function setBgStatus(kind, text) {
  if (!els.bgStatus) return;
  els.bgStatus.dataset.state = kind;
  els.bgStatusText.textContent = text;
}

function syncBackgroundUI() {
  const enabled = state.background.enabled;
  els.bgToggle.setAttribute('aria-checked', String(enabled));
  els.bgToggle.classList.toggle('is-on', enabled);
  els.bgWarning.hidden = !enabled;
  els.bgFeather.disabled = !enabled;
  els.bgFeather.value = String(state.background.feather);
  els.bgFeatherValue.textContent = String(state.background.feather);
  els.bgCustom.value = state.background.color;
  els.bgCustomSwatch.style.setProperty('--bg-color', state.background.color);

  let presetSelected = false;
  for (const button of els.bgOptions.querySelectorAll('[data-bg]')) {
    const value = button.dataset.bg;
    const selected =
      value === 'original'
        ? !enabled
        : enabled && state.background.color.toLowerCase() === value.toLowerCase();
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    if (selected && value !== 'original') presetSelected = true;
  }
  els.bgCustomOption.classList.toggle('is-selected', enabled && !presetSelected);
}

function buildEditorOriginal() {
  if (!state.photo) return;
  const background = getBackgroundSettings();
  const canvas = renderEditorImage(state.photo.source, {
    maxSide: PREVIEW_EDITOR_SIDE,
    enhance: false,
    background,
    maskCanvas: background.enabled ? state.photo.segmentMask : null,
  });
  state.editorOriginalUrl = canvasToDataUrl(canvas, 0.92);
  els.thumbOriginal.src = state.editorOriginalUrl;
  const url =
    state.enhance.enabled && state.editorEnhancedUrl
      ? state.editorEnhancedUrl
      : state.editorOriginalUrl;
  els.cropImage.src = url;
  els.photoThumb.src = url;
  syncCropImage();
}

function refreshBackgroundViews() {
  if (!state.photo) return;
  state.enhancedSettingsKey = null;
  state.editorEnhancedUrl = null;
  state.exportAssets = null;
  state.printAssets = null;
  buildEditorOriginal();
  buildEditorEnhancement();
  scheduleSheet(0);
  updatePrintStatus();
}

function scheduleBackgroundRefresh() {
  window.clearTimeout(state.backgroundTimer);
  state.backgroundTimer = window.setTimeout(refreshBackgroundViews, 160);
}

function setBackgroundEnabled(enabled, color) {
  if (!state.photo) return;
  state.background = {
    ...state.background,
    enabled,
    ...(color ? { color } : {}),
  };
  syncBackgroundUI();

  if (!enabled) {
    setBgStatus('idle', 'Original background.');
    refreshBackgroundViews();
    return;
  }

  if (state.photo.segmentMask) {
    setBgStatus('ok', backgroundStatusLabel());
    refreshBackgroundViews();
    return;
  }

  setBgStatus('loading', 'Removing background…');
  refreshBackgroundViews();
  ensureBackgroundMask();
}

async function ensureBackgroundMask() {
  const photo = state.photo;
  if (!photo) return null;
  if (photo.segmentMask) return photo.segmentMask;
  if (photo.segmentPromise) return photo.segmentPromise;

  const photoId = photo.id;
  photo.segmentPromise = createBackgroundMask(photo.source)
    .then((mask) => {
      if (!state.photo || state.photo.id !== photoId) return null;
      photo.segmentMask = mask;
      if (state.background.enabled) {
        setBgStatus('ok', backgroundStatusLabel());
        refreshBackgroundViews();
      }
      return mask;
    })
    .catch((error) => {
      console.warn('Background removal failed', error);
      if (!state.photo || state.photo.id !== photoId) return null;
      state.background.enabled = false;
      syncBackgroundUI();
      setBgStatus('warn', 'Background removal unavailable — using the original.');
      refreshBackgroundViews();
      toast(
        'Background removal could not run on this photo. The original background is kept.',
        'error',
        6500,
      );
      return null;
    })
    .finally(() => {
      if (state.photo === photo) photo.segmentPromise = null;
    });

  return photo.segmentPromise;
}

function buildEditorEnhancement() {
  if (!state.photo) return;
  const background = getBackgroundSettings();
  const key = `${state.photo.id}|${enhanceKey()}|${backgroundKey()}|${PREVIEW_EDITOR_SIDE}`;
  if (state.enhancedSettingsKey === key && state.editorEnhancedUrl) {
    if (state.enhance.enabled) els.cropImage.src = state.editorEnhancedUrl;
    return;
  }

  const canvas = renderEditorImage(state.photo.source, {
    maxSide: PREVIEW_EDITOR_SIDE,
    enhance: true,
    analysis: state.photo.analysis,
    settings: getEnhanceSettings(),
    background,
    maskCanvas: background.enabled ? state.photo.segmentMask : null,
  });
  state.editorEnhancedUrl = canvasToDataUrl(canvas, 0.92);
  state.enhancedSettingsKey = key;
  els.thumbEnhanced.src = state.editorEnhancedUrl;
  if (state.enhance.enabled) {
    els.cropImage.src = state.editorEnhancedUrl;
    els.photoThumb.src = state.editorEnhancedUrl;
    syncCropImage();
  }
}

/* ------------------------------------------------------------------ */
/* Crop                                                               */
/* ------------------------------------------------------------------ */

function syncCropFrameAspect() {
  if (!state.crop) return;
  const aspect = state.crop.aspect;
  // Cap the on-screen frame height while keeping its exact width:height ratio.
  const frameWidth = Math.min(286, 380 * aspect);
  els.cropFrame.style.aspectRatio = String(aspect);
  els.cropFrame.style.width = `${Math.max(1, frameWidth)}px`;
}

function syncCropImage() {
  if (!state.photo || !state.crop) return;
  syncCropFrameAspect();
  const frameWidth = els.cropFrame.clientWidth;
  const frameHeight = els.cropFrame.clientHeight;
  if (!frameWidth || !frameHeight) return;

  const fractions = cropFractions(state.crop);
  const imageWidth = frameWidth / fractions.width;
  const imageHeight = imageWidth * (state.photo.height / state.photo.width);

  els.cropImage.style.width = `${imageWidth}px`;
  els.cropImage.style.height = `${imageHeight}px`;
  els.cropImage.style.transform = `translate(${-fractions.x * imageWidth}px, ${
    -fractions.y * imageHeight
  }px)`;
  els.cropImage.style.maxWidth = 'none';

  if (Number(els.cropZoom.value) !== state.crop.zoom) {
    els.cropZoom.value = String(state.crop.zoom);
  }
}

function onCropPointerDown(event) {
  if (!state.photo || !state.crop) return;
  if (event.button !== undefined && event.button !== 0) return;
  els.cropFrame.setPointerCapture?.(event.pointerId);
  cropDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startCx: state.crop.cx,
    startCy: state.crop.cy,
    frameWidth: els.cropFrame.clientWidth,
  };
  state.cropTouched = true;
  event.preventDefault();
}

function onCropPointerMove(event) {
  if (!cropDrag || event.pointerId !== cropDrag.pointerId) return;
  state.crop = panCropByPixels(
    { ...state.crop, cx: cropDrag.startCx, cy: cropDrag.startCy },
    event.clientX - cropDrag.startX,
    event.clientY - cropDrag.startY,
    cropDrag.frameWidth,
  );
  syncCropImage();
  scheduleSheet(180);
}

function onCropPointerUp(event) {
  if (!cropDrag || event.pointerId !== cropDrag.pointerId) return;
  cropDrag = null;
  scheduleSheet(60);
}

function onCropWheel(event) {
  if (!state.photo || !state.crop) return;
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  state.crop = setCropZoom(state.crop, state.crop.zoom * factor);
  state.cropTouched = true;
  syncCropImage();
  scheduleSheet(180);
}

function onCropKeyDown(event) {
  if (!state.photo || !state.crop) return;
  const frameWidth = els.cropFrame.clientWidth;
  const stepPx = event.shiftKey ? 30 : 10;
  let handled = true;

  switch (event.key) {
    case 'ArrowLeft':
      state.crop = panCropByPixels(state.crop, -stepPx, 0, frameWidth);
      break;
    case 'ArrowRight':
      state.crop = panCropByPixels(state.crop, stepPx, 0, frameWidth);
      break;
    case 'ArrowUp':
      state.crop = panCropByPixels(state.crop, 0, stepPx, frameWidth);
      break;
    case 'ArrowDown':
      state.crop = panCropByPixels(state.crop, 0, -stepPx, frameWidth);
      break;
    case '+':
    case '=':
      state.crop = setCropZoom(state.crop, state.crop.zoom * 1.12);
      break;
    case '-':
    case '_':
      state.crop = setCropZoom(state.crop, state.crop.zoom / 1.12);
      break;
    case 'Home':
      resetCrop();
      return;
    default:
      handled = false;
  }

  if (!handled) return;
  event.preventDefault();
  state.cropTouched = true;
  syncCropImage();
  scheduleSheet(160);
}

function nudgeZoom(factor) {
  if (!state.crop) return;
  state.crop = setCropZoom(state.crop, state.crop.zoom * factor);
  state.cropTouched = true;
  syncCropImage();
  scheduleSheet(160);
}

function resetCrop() {
  if (!state.photo) return;
  state.crop = createCropState(state.photo.width, state.photo.height, {
    zoom: 1,
    aspect: getPhotoAspect(),
  });
  state.cropTouched = false;
  syncCropImage();
  scheduleSheet(0);
  setFaceStatus('idle', 'Centred crop. Drag to fine-tune.');
}

function setFaceStatus(kind, text) {
  els.faceStatus.dataset.state = kind;
  els.faceStatusText.textContent = text;
}

async function runFaceDetection({ manual = false } = {}) {
  if (!state.photo || state.faceBusy) return;
  const photoId = state.photo.id;
  state.faceBusy = true;
  els.btnDetectFace.disabled = true;
  setFaceStatus('loading', 'Detecting face…');

  try {
    const box = await detectFace(state.photo.source);
    if (!state.photo || state.photo.id !== photoId) return;
    if (state.printDialogOpen) {
      setFaceStatus('ok', 'Face detected — print sheet left as previewed.');
      return;
    }
    if (!box) {
      setFaceStatus('warn', 'No face detected — centred crop applied.');
      if (manual) toast('No face found. You can position the crop manually.', 'error');
      return;
    }

    if (!state.cropTouched || manual) {
      state.crop = suggestCropFromFace(
        state.photo.width,
        state.photo.height,
        box,
        getPhotoAspect(),
      );
      state.cropTouched = false;
      syncCropImage();
      scheduleSheet(0);
      setFaceStatus(
        'ok',
        manual ? 'Face detected — crop updated.' : 'Face detected — crop suggested.',
      );
    } else {
      setFaceStatus('ok', 'Face detected — keeping your manual crop.');
    }
  } catch (error) {
    console.warn('Face detection unavailable', error);
    setFaceStatus('warn', 'Face detection unavailable — centred crop.');
    if (manual) {
      toast('Face detection could not load. Adjust the crop manually.', 'error', 5000);
    }
  } finally {
    state.faceBusy = false;
    els.btnDetectFace.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Layout                                                             */
/* ------------------------------------------------------------------ */

function setPlacement(placement) {
  if (!['top', 'centre'].includes(placement)) return;
  state.layout = {
    ...state.layout,
    verticalPlacement: placement,
    verticalOffsetMm: 0,
  };
  syncPlacementButtons();
  refreshLayout();
}

function arrangementLabel(layout) {
  if (layout.photoCount === 1) return 'one photo';
  if (layout.rows === 1) return 'one row';
  return `${layout.columns} across × ${layout.rows} down`;
}

function syncLayoutInputs() {
  const layout = computeLayout(state.layout);
  const maxCount = Math.min(LIMITS.photoCount.max, layout.capacity);
  els.photoWidth.value = formatSizeValue(layout.photoWidthMm);
  els.photoHeight.value = formatSizeValue(layout.photoHeightMm);
  els.countValue.textContent = String(layout.photoCount);
  els.gapValue.textContent = `${layout.gapMm.toFixed(1)} mm`;
  els.countMinus.disabled = layout.photoCount <= LIMITS.photoCount.min;
  els.countPlus.disabled = layout.photoCount >= maxCount;
  els.gapMinus.disabled = layout.gapMm <= LIMITS.gapMm.min;
  els.gapPlus.disabled = layout.gapMm >= LIMITS.gapMm.max;
  els.countHint.textContent =
    maxCount >= LIMITS.photoCount.max
      ? '1–24 photos · same passport size'
      : `1–${maxCount} at this size and gap · one sheet`;

  for (const button of document.querySelectorAll('[data-size]')) {
    const [width, height] = button.dataset.size.split('x').map(Number);
    const selected =
      Math.abs(width - layout.photoWidthMm) < 1e-9 &&
      Math.abs(height - layout.photoHeightMm) < 1e-9;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }

  for (const button of document.querySelectorAll('[data-count]')) {
    const quickCount = Number(button.dataset.count);
    button.classList.toggle('is-selected', quickCount === layout.photoCount);
    button.disabled = quickCount > maxCount;
  }
  for (const button of document.querySelectorAll('[data-gap]')) {
    button.classList.toggle(
      'is-selected',
      Math.abs(Number(button.dataset.gap) - layout.gapMm) < 1e-9,
    );
  }

  els.guidesSelect.value = state.guides;
  syncPlacementButtons();
  els.dpiSelect.value = String(state.dpi);
  els.printedLabels.checked = state.printedLabels;
  els.showMeasurements.checked = state.showMeasurements;
}

function refreshLayout() {
  if (!state.previewDataUrl) {
    updateLayoutUI();
    scheduleSheet(0);
    return;
  }
  const layout = computeLayout(state.layout);
  invalidateExport(layout);
  renderSheet(state.previewDataUrl, layout);
  updateLayoutUI();
  updatePrintStatus(layout);
}

function updateLayoutUI() {
  const layout = computeLayout(state.layout);
  syncLayoutInputs();

  const countLabel = `${layout.photoCount} × ${layout.photoWidthMm.toFixed(
    2,
  )} × ${layout.photoHeightMm.toFixed(2)} mm`;
  els.actualSize.textContent = countLabel;
  els.layoutSummary.textContent = `${layout.photoCount} photo${
    layout.photoCount === 1 ? '' : 's'
  } · ${arrangementLabel(layout)} · ${layout.gapMm.toFixed(1)} mm gaps`;

  const sizeLabel = `${layout.photoWidthMm.toFixed(2)} × ${layout.photoHeightMm.toFixed(2)} mm`;
  const edgeToEdge = layout.blockWidth >= 210 - 1e-6;
  els.printerWarning.textContent = edgeToEdge
    ? 'These photos span the full A4 width. Print borderless for edge-to-edge output.'
    : layout.rows > 1
      ? `Photos stay exactly ${sizeLabel}. The sheet uses ${layout.blockX.toFixed(
          2,
        )} mm side margins and ${layout.rows} rows — print at 100% / actual size.`
      : `Photos stay exactly ${sizeLabel}. Side margins are ${layout.blockX.toFixed(
          2,
        )} mm — print at 100% / actual size.`;

  els.printedLabels.checked = state.printedLabels;
  els.showMeasurements.checked = state.showMeasurements;
  els.guidesSelect.value = state.guides;
  els.measureOverlay.hidden = !state.showMeasurements;
  els.modeBadge.textContent = `${layout.photoCount} photo${
    layout.photoCount === 1 ? '' : 's'
  }`;
  if (!state.photo) {
    els.previewSub.textContent = '210 × 297 mm portrait';
  }

  updateActionSummary(layout);
  updateStepper();
}

function syncPlacementButtons() {
  const placement = state.layout.verticalPlacement === 'centre' ? 'centre' : 'top';
  els.posTop.setAttribute('aria-pressed', String(placement === 'top'));
  els.posCentre.setAttribute('aria-pressed', String(placement === 'centre'));
  els.posTop.classList.toggle('is-selected', placement === 'top');
  els.posCentre.classList.toggle('is-selected', placement === 'centre');
}

function scheduleSheet(delay = 180) {
  window.clearTimeout(state.sheetTimer);
  state.sheetTimer = window.setTimeout(updateSheetPreview, delay);
}

function updateSheetPreview() {
  if (!state.photo || !state.crop) return;
  const crop = getCropRect(state.crop);
  const background = getBackgroundSettings();
  const preview = previewPixelSize(state.crop.aspect);
  const canvas = renderCrop(state.photo.source, crop, preview.width, {
    targetHeight: preview.height,
    enhance: state.enhance.enabled,
    analysis: state.photo.analysis,
    settings: getEnhanceSettings(),
    background,
    maskCanvas: background.enabled ? state.photo.segmentMask : null,
  });
  state.previewDataUrl = canvasToDataUrl(canvas, 0.92);
  const layout = computeLayout(state.layout);
  invalidateExport(layout);
  renderSheet(state.previewDataUrl, layout);
  updateLayoutUI();
  updatePrintStatus(layout);
}

function renderSheet(dataUrl, layout = computeLayout(state.layout)) {
  const images = layout.photos.map((photo) => {
    const image = document.createElement('img');
    image.className = 'sheet-photo';
    image.src = dataUrl;
    image.alt = `Passport photo ${photo.index + 1} of ${layout.photoCount}`;
    image.draggable = false;
    image.style.left = percent(photo.x, layout.pageWidthMm);
    image.style.top = percent(photo.y, layout.pageHeightMm);
    image.style.width = percent(photo.widthMm, layout.pageWidthMm);
    image.style.height = percent(photo.heightMm, layout.pageHeightMm);
    return image;
  });
  els.sheetPhotos.replaceChildren(...images);

  renderGuideLines(layout);
  renderPrintLabels(layout);
  renderMeasurements(layout);
  renderMetrics(layout);

  els.previewSub.textContent = `A4 portrait · ${layout.photoCount} photo${
    layout.photoCount === 1 ? '' : 's'
  } · ${layout.photoWidthMm.toFixed(2)} × ${layout.photoHeightMm.toFixed(2)} mm`;
  els.modeBadge.textContent = `${layout.photoCount} photo${
    layout.photoCount === 1 ? '' : 's'
  }`;
  els.captionDims.textContent = `${layout.photoWidthMm.toFixed(
    2,
  )} × ${layout.photoHeightMm.toFixed(2)} mm each · ${layout.gapMm.toFixed(
    1,
  )} mm gaps · ${arrangementLabel(layout)}`;
  els.sheet.setAttribute(
    'aria-label',
    `A4 portrait print preview. ${layout.photoCount} passport photos, each ${layout.photoWidthMm.toFixed(
      2,
    )} by ${layout.photoHeightMm.toFixed(2)} millimetres, arranged in ${layout.rows} row${
      layout.rows === 1 ? '' : 's'
    }.`,
  );
  els.sheetEmpty.hidden = Boolean(state.photo);
}

function percent(value, total) {
  return `${((value / total) * 100).toFixed(5)}%`;
}

function renderGuideLines(layout) {
  const NS = 'http://www.w3.org/2000/svg';
  const segments = layout.photos.length ? buildGuideSegments(layout, state.guides) : [];
  const lines = segments.map((segment) => {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(segment.x1));
    line.setAttribute('y1', String(segment.y1));
    line.setAttribute('x2', String(segment.x2));
    line.setAttribute('y2', String(segment.y2));
    return line;
  });
  els.sheetGuides.replaceChildren(...lines);
}

function renderPrintLabels(layout) {
  if (!state.printedLabels || !state.photo) {
    els.printLabels.replaceChildren();
    return;
  }
  const label = document.createElement('div');
  label.className = 'print-label';
  label.textContent = `${layout.photoCount} × ${layout.photoWidthMm.toFixed(
    2,
  )} × ${layout.photoHeightMm.toFixed(2)} mm · ${layout.gapMm.toFixed(1)} mm gaps`;
  label.style.left = percent(layout.blockX + layout.blockWidth / 2, layout.pageWidthMm);
  label.style.top = percent(
    clampMm(layout.blockY + layout.blockHeight + 4),
    layout.pageHeightMm,
  );
  els.printLabels.replaceChildren(label);
}

function renderMeasurements(layout) {
  const overlay = els.measureOverlay;
  overlay.hidden = !state.showMeasurements;
  if (!state.showMeasurements) {
    overlay.replaceChildren();
    return;
  }

  const nodes = [];
  const px = (value) => percent(value, layout.pageWidthMm);
  const py = (value) => percent(value, layout.pageHeightMm);
  const edgeToEdge = layout.blockWidth >= 210 - 1e-6;
  const above = layout.blockY >= 24;
  const lineY = above
    ? layout.blockY - 12
    : layout.blockY + layout.blockHeight + 12;

  const outline = document.createElement('div');
  outline.className = 'm-row-outline';
  outline.style.left = px(layout.blockX);
  outline.style.top = py(layout.blockY);
  outline.style.width = px(layout.blockWidth);
  outline.style.height = px(layout.blockHeight);
  nodes.push(outline);

  if (layout.blockY + layout.blockHeight + 50 > 297) {
    const summary = document.createElement('div');
    summary.className = 'm-label';
    summary.style.left = px(layout.blockX + layout.blockWidth / 2);
    summary.style.top = py(clampMm(layout.blockY + layout.blockHeight + 6));
    summary.textContent = `${layout.photoCount} × ${layout.photoWidthMm.toFixed(
      2,
    )} × ${layout.photoHeightMm.toFixed(2)} mm · block ${layout.blockWidth.toFixed(
      2,
    )} × ${layout.blockHeight.toFixed(2)} mm · ${layout.gapMm.toFixed(1)} mm gaps`;
    overlay.replaceChildren(outline, summary);
    return;
  }

  const line = document.createElement('div');
  line.className = 'm-width-line';
  line.style.left = px(layout.blockX);
  line.style.width = px(layout.blockWidth);
  line.style.top = py(clampMm(lineY));
  nodes.push(line);

  const widthLabel = document.createElement('div');
  widthLabel.className = 'm-label';
  widthLabel.style.left = px(layout.blockX + layout.blockWidth / 2);
  widthLabel.style.top = py(clampMm(above ? lineY - 7 : lineY + 7));
  widthLabel.textContent = edgeToEdge
    ? '210.00 mm · edge-to-edge'
    : `Block ${layout.blockWidth.toFixed(2)} mm`;
  nodes.push(widthLabel);

  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'm-label m-muted';
  sizeLabel.style.left = px(layout.blockX + layout.blockWidth / 2);
  sizeLabel.style.top = py(clampMm(above ? lineY - 19 : lineY + 19));
  sizeLabel.textContent = `${layout.photoCount} × ${layout.photoWidthMm.toFixed(
    2,
  )} × ${layout.photoHeightMm.toFixed(2)} mm`;
  nodes.push(sizeLabel);

  const heightLabel = document.createElement('div');
  heightLabel.className = 'm-label m-muted';
  heightLabel.style.left = px(layout.blockX + layout.blockWidth / 2);
  heightLabel.style.top = py(
    clampMm(
      above
        ? layout.blockY + layout.blockHeight + (state.printedLabels ? 13 : 7)
        : lineY + 32,
    ),
  );
  heightLabel.textContent = `${layout.blockHeight.toFixed(2)} mm high`;
  nodes.push(heightLabel);

  const pageLabel = document.createElement('div');
  pageLabel.className = 'm-page-label';
  pageLabel.style.left = px(3);
  pageLabel.style.top = py(4);
  pageLabel.textContent = 'A4 · 210 × 297 mm';
  if (layout.blockY > 16) nodes.push(pageLabel);

  if (layout.gapMm > 0) {
    const gapLabel = document.createElement('div');
    gapLabel.className = 'm-label m-muted';
    gapLabel.style.left = px(layout.blockX + layout.blockWidth / 2);
    gapLabel.style.top = py(
      clampMm(
        above
          ? layout.blockY + layout.blockHeight + (state.printedLabels ? 26 : 20)
          : lineY + 45,
      ),
    );
    gapLabel.textContent = `gaps ${layout.gapMm.toFixed(1)} mm · margins ${layout.blockX.toFixed(2)} mm`;
    nodes.push(gapLabel);
  }

  overlay.replaceChildren(...nodes);
}

function clampMm(value) {
  return Math.min(292, Math.max(5, value));
}

function renderMetrics(layout) {
  const px = pixelSizeForPhoto(layout.photoWidthMm, layout.photoHeightMm, state.dpi);
  const rows = [
    ['Sheet', 'A4 portrait', '210.00 × 297.00 mm', false],
    [
      'Photos',
      `${layout.photoCount} × ${layout.photoWidthMm.toFixed(2)} × ${layout.photoHeightMm.toFixed(2)} mm`,
      `${layout.photoWidthMm.toFixed(2)}:${layout.photoHeightMm.toFixed(2)} · selected size`,
      false,
    ],
    [
      'Arrangement',
      `${layout.columns} across × ${layout.rows} down`,
      arrangementLabel(layout),
      false,
    ],
    ['Gap', `${layout.gapMm.toFixed(1)} mm`, 'horizontal and vertical', false],
    [
      'Margins',
      `${layout.blockX.toFixed(2)} mm sides`,
      `top ${layout.blockY.toFixed(2)} mm`,
      false,
    ],
    [
      'Print file',
      `${px.width} × ${px.height} px`,
      `≈${Math.round(px.effectiveDpi)} dpi effective`,
      false,
    ],
  ];

  els.metrics.replaceChildren(
    ...rows.map(([label, value, note, warn]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'metric';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (warn) dd.classList.add('is-warn');
      const small = document.createElement('small');
      small.textContent = note;
      dd.appendChild(small);
      wrapper.append(dt, dd);
      return wrapper;
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Action state                                                       */
/* ------------------------------------------------------------------ */

function updateActionSummary(layout = computeLayout(state.layout)) {
  const hasPhoto = Boolean(state.photo);
  els.summaryDot.classList.toggle('is-ready', hasPhoto);
  if (!hasPhoto) {
    els.summaryTitle.textContent = 'Add a photo to begin';
    els.summarySub.textContent = `A4 portrait · ${layout.photoWidthMm.toFixed(
      2,
    )} × ${layout.photoHeightMm.toFixed(2)} mm passport photos`;
    return;
  }
  els.summaryTitle.textContent = `${layout.photoCount} × ${layout.photoWidthMm.toFixed(
    2,
  )} × ${layout.photoHeightMm.toFixed(2)} mm · A4 portrait`;
  const placement = layout.verticalPlacement === 'centre' ? 'Centred' : 'Top-aligned';
  els.summarySub.textContent = `${placement} · ${arrangementLabel(layout)} · ${layout.gapMm.toFixed(
    1,
  )} mm gaps${layout.blockX > 0.01 ? ` · ${layout.blockX.toFixed(2)} mm side margins` : ''}`;
}

function updateActionState() {
  const hasPhoto = Boolean(state.photo);
  for (const button of [els.btnGenerate, els.btnDownload, els.btnPrint]) {
    button.disabled = !hasPhoto || state.busy;
  }
  if (els.btnToPrint) els.btnToPrint.disabled = !hasPhoto || state.busy;
  els.btnDownload.classList.toggle('is-busy', state.busy && state.busyTarget === els.btnDownload);
  els.btnPrint.classList.toggle('is-busy', state.busy && state.busyTarget === els.btnPrint);
  els.btnGenerate.classList.toggle('is-busy', state.busy && state.busyTarget === els.btnGenerate);
}

function setBusy(busy, target = null) {
  state.busy = busy;
  state.busyTarget = target;
  updateActionState();
}

function updateStepper() {
  const hasPhoto = Boolean(state.photo);
  const printStage = hasPhoto && state.stage === 'print';
  if (!hasPhoto) state.stage = 'photo';

  els.uploadCard.hidden = hasPhoto;
  els.workspace.hidden = !hasPhoto;
  els.stagePhoto.hidden = !hasPhoto || printStage;
  els.stagePrint.hidden = !hasPhoto || !printStage;
  els.sheetEmpty.hidden = hasPhoto;

  els.stageRailPhoto.classList.toggle('is-active', !printStage);
  els.stageRailPhoto.classList.toggle('is-done', printStage);
  els.stageRailPrint.classList.toggle('is-active', printStage);
  els.sidebarStageTitle.textContent = printStage ? 'Print setup' : 'Photo setup';
  els.previewStageLabel.textContent = printStage ? 'Print setup' : 'Photo setup';
  els.sidebarToggleLabel.textContent = !hasPhoto
    ? 'Upload'
    : printStage
      ? 'Print settings'
      : 'Adjust photo';
  els.modeBadge.hidden = !hasPhoto;
  if (!hasPhoto) {
    els.previewSub.textContent = '210 × 297 mm portrait';
    els.modeBadge.textContent = '';
  }
  els.btnToPrint.disabled = !hasPhoto || state.busy;
}

function toast(message, type = 'success', timeout = 4200) {
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' is-error' : ''}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 240);
  }, timeout);
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

function getPhotoAspect(layout = computeLayout(state.layout)) {
  return layout.photoWidthMm / layout.photoHeightMm;
}

function previewPixelSize(aspect = getPhotoAspect()) {
  if (aspect >= 1) {
    return {
      width: PREVIEW_MAX_SIDE,
      height: Math.max(1, Math.round(PREVIEW_MAX_SIDE / aspect)),
    };
  }
  return {
    width: Math.max(1, Math.round(PREVIEW_MAX_SIDE * aspect)),
    height: PREVIEW_MAX_SIDE,
  };
}

function currentPixelSize(layout = computeLayout(state.layout)) {
  return pixelSizeForPhoto(layout.photoWidthMm, layout.photoHeightMm, state.dpi);
}

function exportKey() {
  if (!state.photo || !state.crop) return null;
  const layout = computeLayout(state.layout);
  const px = currentPixelSize(layout);
  const crop = getCropRect(state.crop);
  return [
    state.photo.id,
    layoutKey(layout),
    state.dpi,
    px.width,
    crop.sx.toFixed(3),
    crop.sy.toFixed(3),
    crop.width.toFixed(3),
    enhanceKey(),
    state.enhance.enabled ? 'enhanced' : 'original',
    state.background.enabled ? backgroundKey() : 'background-off',
  ].join('|');
}

function invalidateExport(layout = computeLayout(state.layout)) {
  if (!state.exportAssets) return;
  if (state.exportAssets.key !== exportKey()) {
    state.exportAssets = null;
    state.printAssets = null;
    updatePrintStatus(layout);
  }
}

async function ensureExportAssets({ force = false } = {}) {
  if (!state.photo || !state.crop) {
    throw new Error('Upload a photo first.');
  }

  const wantedBackground = state.background.enabled;
  if (wantedBackground && !state.photo.segmentMask) {
    const mask = await ensureBackgroundMask();
    if (!mask) {
      throw new Error(
        'Background removal could not prepare a cutout. Choose Original background and try again.',
      );
    }
  }

  const key = exportKey();
  if (!force && state.exportAssets?.key === key) return state.exportAssets;

  // Let the busy state paint before the (synchronous) canvas work.
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

  const layout = computeLayout(state.layout);
  const px = currentPixelSize(layout);
  const crop = getCropRect(state.crop);
  const background = getBackgroundSettings();
  const canvas = renderCrop(state.photo.source, crop, px.width, {
    targetHeight: px.height,
    enhance: state.enhance.enabled,
    analysis: state.photo.analysis,
    settings: getEnhanceSettings(),
    background,
    maskCanvas: background.enabled ? state.photo.segmentMask : null,
  });
  const dataUrl = canvasToDataUrl(canvas, 0.96);

  const assets = {
    key,
    layout,
    canvas,
    dataUrl,
    px,
    generatedAt: Date.now(),
  };
  state.exportAssets = assets;
  updatePrintStatus(layout, assets);
  return assets;
}

async function generatePreview(trigger) {
  if (!state.photo || state.busy) return;
  setBusy(true, trigger);
  try {
    const assets = await ensureExportAssets({ force: true });
    state.previewDataUrl = assets.dataUrl;
    renderSheet(assets.dataUrl, assets.layout);
    updateLayoutUI();
    updateStepper();
    updatePrintStatus(assets.layout, assets);
    toast(
      `Print file ready — ${assets.px.width} × ${assets.px.height} px at about ${Math.round(
        assets.px.effectiveDpi,
      )} dpi.`,
      'success',
      4500,
    );
  } catch (error) {
    console.error('Preview generation failed', error);
    toast(error.message || 'Could not render the print file.', 'error', 6000);
  } finally {
    setBusy(false);
  }
}

function downloadPdf() {
  if (!state.photo || state.busy) return;
  runExport(els.btnDownload, async () => {
    const assets = await ensureExportAssets();
    const artifact = createPdfArtifact(assets);
    triggerDownload(artifact.blob, artifact.filename);
    updateStepper();
    toast(
      `PDF downloaded — one A4 portrait page, ${layoutCountLabel(state.layout)}.`,
    );
  });
}

function createPdfArtifact(assets) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    throw new Error('The PDF library could not be loaded. Reload the page and try again.');
  }
  const { doc, allPass, checks } = buildPdfDocument({
    jsPDF,
    layout: assets.layout,
    imageDataUrl: assets.dataUrl,
    guides: state.guides,
    printedLabels: state.printedLabels,
  });
  if (!allPass) {
    console.error('PDF geometry checks failed', checks);
    throw new Error('The geometry check failed, so the PDF was not generated.');
  }
  return {
    blob: doc.output('blob'),
    filename: fileNameFor(assets.layout),
    checks,
  };
}

function isMobileDevice() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const ua = navigator.userAgent || '';
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return Boolean(coarse) || iPadOS || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
}

function openPdfForPrinting(artifact) {
  const url = URL.createObjectURL(artifact.blob);
  const opened = window.open(url, '_blank');
  updateStepper();
  if (!opened) {
    triggerDownload(artifact.blob, artifact.filename);
    toast(
      'Pop-up blocked — the PDF was downloaded instead. Open it and use Print.',
      'error',
      6500,
    );
    return;
  }
  try {
    opened.opener = null;
  } catch {
    // Cross-origin window proxies can refuse this; harmless either way.
  }
  toast(
    'PDF opened. Use Share → Print, or the print button in your PDF viewer.',
    'success',
    7500,
  );
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function buildPrintPortal(assets) {
  const root = document.createElement('div');
  root.id = 'printPortal';
  root.className = 'print-portal';
  root.setAttribute('aria-hidden', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'print-portal-sheet';

  for (const photo of assets.layout.photos) {
    const image = document.createElement('img');
    image.src = assets.dataUrl;
    image.alt = '';
    image.style.left = `${photo.x}mm`;
    image.style.top = `${photo.y}mm`;
    image.style.width = `${photo.widthMm}mm`;
    image.style.height = `${photo.heightMm}mm`;
    sheet.append(image);
  }

  if (state.guides !== 'none') {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 210 297');
    svg.setAttribute('width', '210mm');
    svg.setAttribute('height', '297mm');
    svg.setAttribute('aria-hidden', 'true');
    for (const segment of buildGuideSegments(assets.layout, state.guides)) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(segment.x1));
      line.setAttribute('y1', String(segment.y1));
      line.setAttribute('x2', String(segment.x2));
      line.setAttribute('y2', String(segment.y2));
      svg.append(line);
    }
    sheet.append(svg);
  }

  if (state.printedLabels) {
    for (const photo of assets.layout.photos) {
      const label = document.createElement('div');
      label.className = 'print-portal-label';
      label.textContent = `${assets.layout.photoWidthMm.toFixed(2)} × ${assets.layout.photoHeightMm.toFixed(2)} mm`;
      label.style.left = `${photo.x + photo.widthMm / 2}mm`;
      label.style.top = `${photo.y + photo.heightMm + 5}mm`;
      sheet.append(label);
    }
  }

  root.append(sheet);
  document.body.append(root);
  return root;
}

async function printDirect(assets) {
  if (typeof window.print !== 'function') {
    openPdfForPrinting(createPdfArtifact(assets));
    return;
  }

  const portal = buildPrintPortal(assets);
  document.documentElement.classList.add('has-print-portal');
  await Promise.all(
    [...portal.querySelectorAll('img')].map((image) =>
      typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve(),
    ),
  );

  updateStepper();
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    portal.remove();
    document.documentElement.classList.remove('has-print-portal');
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, 60000);

  try {
    window.print();
    toast('Choose A4, Portrait and 100% / Actual size in the print dialog.', 'success', 7000);
  } catch (error) {
    console.warn('Direct print failed', error);
    cleanup();
    openPdfForPrinting(createPdfArtifact(assets));
    toast('Direct printing is unavailable — the PDF is open instead.', 'error', 6500);
  }
}

function sharePrintPdf(assets = state.printAssets ?? state.exportAssets) {
  if (!assets) {
    void prepareAndPrintDirect();
    return;
  }

  let artifact;
  try {
    artifact = createPdfArtifact(assets);
  } catch (error) {
    console.error('Print PDF failed', error);
    toast(error.message || 'Could not build the print PDF.', 'error', 6000);
    return;
  }

  let canShareFiles = false;
  const file = new File([artifact.blob], artifact.filename, { type: 'application/pdf' });
  try {
    canShareFiles =
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
  } catch {
    canShareFiles = false;
  }

  if (!canShareFiles) {
    void printDirect(assets);
    return;
  }

  let sharePromise;
  try {
    sharePromise = navigator.share({
      files: [file],
      title: 'Passport photos — A4',
      text: `${assets.layout.photoCount} × ${assets.layout.photoWidthMm.toFixed(2)} × ${assets.layout.photoHeightMm.toFixed(2)} mm passport photos on one A4 page. Print at 100% / actual size.`,
    });
  } catch (error) {
    console.warn('Share could not start', error);
    void printDirect(assets);
    return;
  }

  sharePromise
    .then(() => {
      updateStepper();
      toast(
        'Share sheet opened. Choose Print (AirPrint) or your printer app, then A4 and 100%.',
        'success',
        8000,
      );
    })
    .catch((error) => {
      if (error?.name === 'AbortError') return;
      console.warn('Share failed', error);
      void printDirect(assets);
      toast(
        'Sharing isn’t available here, so the print dialog was opened instead.',
        'error',
        6500,
      );
    });
}

function savePrintPdf() {
  const assets = state.printAssets ?? state.exportAssets;
  if (!assets) {
    toast('Prepare the print file first, then try again.', 'error');
    return;
  }
  try {
    const artifact = createPdfArtifact(assets);
    triggerDownload(artifact.blob, artifact.filename);
    closePrintDialog();
    updateStepper();
    toast('PDF saved. Open it and print at 100% / Actual size.');
  } catch (error) {
    console.error('Saving print PDF failed', error);
    toast(error.message || 'Could not save the print PDF.', 'error', 6000);
  }
}

async function runExport(trigger, task) {
  setBusy(true, trigger);
  try {
    await task();
  } catch (error) {
    console.error('Export failed', error);
    toast(error.message || 'Something went wrong while preparing the file.', 'error', 6500);
  } finally {
    setBusy(false);
  }
}

function layoutCountLabel(value) {
  const layout = computeLayout(value);
  return `${layout.photoCount} photo${layout.photoCount === 1 ? '' : 's'}`;
}

function fileNameFor(layout) {
  const width = layout.photoWidthMm.toFixed(2).replace('.', '-');
  const height = layout.photoHeightMm.toFixed(2).replace('.', '-');
  return `passport-photos-${layout.photoCount}up-${width}x${height}mm-a4.pdf`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function updatePrintStatus(layout = computeLayout(state.layout), assets = state.exportAssets) {
  if (!state.photo) {
    els.printReadyBadge.textContent = 'Not generated';
    els.exportNote.textContent = 'Generate a preview to render the full-resolution print file.';
    return;
  }

  const px = assets?.px ?? currentPixelSize(layout);
  const { checks } = verifyLayout(layout);
  const displayChecks = [...checks];
  if (assets) {
    displayChecks.push({
      id: 'render',
      label: `Print image ${px.width} × ${px.height} px (${Math.round(px.effectiveDpi)} dpi)`,
      pass:
        Math.abs(
          px.width / px.height - layout.photoWidthMm / layout.photoHeightMm,
        ) /
          (layout.photoWidthMm / layout.photoHeightMm) <
        0.002,
    });
  }

  els.geometryChecks.replaceChildren(
    ...displayChecks.map((check) => {
      const item = document.createElement('li');
      item.textContent = check.label;
      if (!check.pass) item.classList.add('is-fail');
      return item;
    }),
  );

  if (assets) {
    els.printReadyBadge.textContent = 'Ready';
    els.exportNote.textContent = `Ready to export · ${layout.photoCount} photo${
      layout.photoCount === 1 ? '' : 's'
    } · ${px.width} × ${px.height} px · ${mm(layout.photoWidthMm)} × ${mm(
      layout.photoHeightMm,
    )} each. Changing photo or print settings will ask you to regenerate.`;
  } else {
    els.printReadyBadge.textContent = 'Not generated';
    els.exportNote.textContent =
      'The A4 preview is live. Generate a preview to render the full-resolution print file before exporting.';
  }
}

/* ------------------------------------------------------------------ */
/* Print                                                              */
/* ------------------------------------------------------------------ */

async function openPrintDialog() {
  if (!state.photo || state.busy) return;
  setBusy(true, els.btnPrint);
  state.printDialogOpen = true;
  try {
    state.printAssets = await ensureExportAssets();
    const layout = state.printAssets.layout;
    const mobile = isMobileDevice();
    els.printSummary.textContent = `${layout.photoCount} photo${
      layout.photoCount === 1 ? '' : 's'
    } · A4 portrait · ${layout.photoWidthMm.toFixed(2)} × ${layout.photoHeightMm.toFixed(2)} mm each`;

    const edgeToEdge = layout.blockWidth >= 210 - 1e-6;
    const modeNote = edgeToEdge
      ? 'These photos reach the paper edge. If your printer has non-printable margins, the outer photos may be clipped — print borderless or trim the sheet.'
      : `The photos stay exactly ${layout.photoWidthMm.toFixed(2)} × ${layout.photoHeightMm.toFixed(
          2,
        )} mm with ${layout.blockX.toFixed(2)} mm side margins. Print at 100% / Actual size.`;
    const mobileModeNote = edgeToEdge
      ? 'The sheet runs edge-to-edge — use borderless printing if possible.'
      : `Side margins are ${layout.blockX.toFixed(2)} mm; photos stay ${layout.photoWidthMm.toFixed(
          2,
        )} × ${layout.photoHeightMm.toFixed(2)} mm.`;
    els.printWarning.textContent = mobile
      ? `Tap Print / Share PDF. If the share sheet opens, choose Print (AirPrint); otherwise the print dialog opens directly. Keep A4, Portrait and 100% / Actual size. ${mobileModeNote}`
      : modeNote;
    els.printDialog.dataset.mobile = String(mobile);
    els.btnSavePdfPrint.hidden = !mobile;
    els.btnConfirmPrint.textContent = mobile ? 'Print / Share PDF' : 'Open print dialog';
    if (typeof els.printDialog.showModal === 'function') {
      els.printDialog.showModal();
    } else {
      els.printDialog.setAttribute('open', '');
    }
  } catch (error) {
    state.printDialogOpen = false;
    console.error('Print preparation failed', error);
    toast(error.message || 'Could not prepare the print file.', 'error', 6000);
  } finally {
    setBusy(false);
  }
}

function closePrintDialog() {
  state.printDialogOpen = false;
  if (typeof els.printDialog.close === 'function') {
    els.printDialog.close();
  } else {
    els.printDialog.removeAttribute('open');
  }
}

function confirmPrint() {
  const mobile = isMobileDevice();
  const assets = state.printAssets;
  closePrintDialog();
  if (!mobile) {
    printNow();
    return;
  }
  if (assets) {
    sharePrintPdf(assets);
  } else {
    prepareAndPrintDirect();
  }
}

async function prepareAndPrintDirect() {
  setBusy(true, els.btnPrint);
  try {
    const assets = await ensureExportAssets({ force: true });
    state.printAssets = assets;
    await printDirect(assets);
  } catch (error) {
    console.error('Print preparation failed', error);
    toast(error.message || 'Could not prepare the print file.', 'error', 6000);
  } finally {
    setBusy(false);
  }
}

async function printNow() {
  if (!state.photo) return;
  setBusy(true, els.btnPrint);
  try {
    const assets = state.printAssets ?? (await ensureExportAssets());
    const html = buildPrintDocument({
      layout: assets.layout,
      imageDataUrl: assets.dataUrl,
      guides: state.guides,
      printedLabels: state.printedLabels,
    });
    printHtmlDocument(html, {
      onPrinted: () => {
        updateStepper();
        setBusy(false);
        toast('Print dialog opened. Choose A4, Portrait and 100% / Actual size.', 'success', 5500);
      },
      onError: () => {
        setBusy(false);
        toast(
          'The browser blocked printing. Download the PDF and print that instead.',
          'error',
          6500,
        );
      },
    });
  } catch (error) {
    console.error('Print failed', error);
    setBusy(false);
    toast(error.message || 'Could not open the print dialog.', 'error', 6000);
  }
}

/* ------------------------------------------------------------------ */
/* Test hooks                                                         */
/* ------------------------------------------------------------------ */

function exposeTestApi() {
  window.__passportApp = {
    state,
    computeLayout,
    getLayout: () => computeLayout(state.layout),
    getPixelSize: () => currentPixelSize(),
    getSheetImageCount: () => els.sheetPhotos.querySelectorAll('img').length,
    isMobileDevice,
    generatePdfBytes: async () => {
      const assets = await ensureExportAssets();
      const jsPDF = window.jspdf?.jsPDF;
      if (!jsPDF) throw new Error('jsPDF missing');
      const result = buildPdfDocument({
        jsPDF,
        layout: assets.layout,
        imageDataUrl: assets.dataUrl,
        guides: state.guides,
        printedLabels: state.printedLabels,
      });
      return {
        bytes: Array.from(pdfBytes(result.doc)),
        checks: result.checks,
        allPass: result.allPass,
        layout: assets.layout,
        pixels: assets.px,
      };
    },
    buildPrintHtml: async () => {
      const assets = await ensureExportAssets();
      return buildPrintDocument({
        layout: assets.layout,
        imageDataUrl: assets.dataUrl,
        guides: state.guides,
        printedLabels: state.printedLabels,
      });
    },
    generatePreview: () => generatePreview(els.btnGenerate),
  };
}

init();
