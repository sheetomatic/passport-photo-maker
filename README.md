# Passport Photo Maker

A complete, browser-only passport photo tool built from the supplied DeepSeek prompt pack, then reworked around a settings sidebar and a preview-only front.

Upload one portrait — or take one with your phone camera — → enhance, clean up the background and crop in the sidebar → approve the photo → choose quantity and gaps in print setup → print-ready A4 PDF or direct print.

Photo editing runs entirely on the device. A Sheetomatic account is used only for the subscription/licensing and invoice flow; **photos are never uploaded**. There is no analytics.

**Current public app:** https://sheetomatic.github.io/passport-photo-maker/ — installable PWA with account registration, the ₹100/month subscription and invoices through the Sheetomatic Workspace API.

**Production GCP URL:** https://ppm.sheetomatic.com/ — same build served by Caddy on the GCP VM (pending its DNS A record).

![Desktop app](screenshots/app-desktop.png)

## Run it

Requirements: Node.js 18+ (only to serve static files). There is no build step and no runtime dependency.

```bash
cd passport-photo-maker
npm run dev
```

Open **http://127.0.0.1:5173**.

To use it from a phone on the same Wi-Fi, start the LAN mode instead:

```bash
npm run dev:lan
```

The terminal prints the phone URL (for example `http://192.168.1.24:5173`). Allow the connection if macOS asks about incoming network connections.

`node server.mjs` is a small static server included for convenience. Any static file server that serves `.mjs` as JavaScript and `.wasm` as `application/wasm` works, for example:

```bash
python3 -m http.server 5173
```

Do not open `index.html` directly with `file://` — ES modules and WebAssembly need HTTP.

Tests use `puppeteer-core`, so install dev dependencies once:

```bash
npm install
npm test          # 50 geometry/crop/PDF/print/upload/PWA tests
npm run test:e2e  # real Chrome end-to-end (macOS path auto-detected)
npm run test:all  # both
```

Set `CHROME_PATH` if Chrome lives somewhere else.

### Install it on your phone

Open **https://sheetomatic.github.io/passport-photo-maker/** and add it to your Home Screen.

- **iPhone / iPad (Safari):** tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** tap **Install** in the app header, or open the browser menu and choose **Install app** / **Add to Home screen**.
- **Desktop Chrome:** use the install icon in the address bar, or the **Install** button in the app header.

The install prompt is available on phones in the header. Once installed, the app opens full-screen without browser chrome and the shell works offline; face detection is cached after its first use.

![Install on iPhone](screenshots/app-mobile-install.png)

For local LAN testing, `npm run dev:lan` prints the phone URL (same Wi-Fi; allow incoming connections if macOS asks).

- **Take Photo** uses the phone's native camera through `<input type="file" capture="user">`. That works over plain HTTP and lets the phone switch cameras and confirm/retake in its own camera UI.
- **Print / Share PDF** uses the Web Share API when available (HTTPS or localhost). Choose **Print** in the share sheet for AirPrint.
- Over plain HTTP on your LAN, Web Share is unavailable by browser policy. The app then opens the system print dialog directly with the same A4 sheet — no PDF detour required.

![Mobile upload](screenshots/app-mobile-upload.png)

![Mobile print](screenshots/app-mobile-print.png)

![Background replacement controls](screenshots/app-background.png)

## What it does

- **Sidebar-first editing.** Upload, enhancement, background cleanup and crop all live in a scrollable settings sidebar. The front of the workspace is the A4 preview only.
- **A deliberate two-step flow.**
  1. **Photo setup** — adjust the portrait while the sheet updates live.
  2. **Print setup** — approve the photo, then choose quantity, spacing, vertical position, guides and output.
- **Adjustable quantity.** Choose **1–24 passport photos** with the `−` / `+` stepper or the 4/6/8/12 shortcuts. The default is six.
- **Adjustable gap.** Choose **0–8 mm** in 0.5 mm steps with the `−` / `+` stepper or 0/2/4/6 shortcuts. The gap applies horizontally and vertically.
- **Editable passport size.** Set width and height in millimetres (15–100 × 15–150 mm) or use the 35 × 45, 35 × 35, 33 × 48 and 2 × 2 in presets. The crop follows the chosen ratio, so photos are never stretched. The default remains 35 × 45 mm.
- **Quantity and gap never shrink the photo.** If the block no longer fits one row, it wraps into balanced, centred rows. The count is limited to what actually fits on one A4 sheet at the chosen size and gap.
- **True A4 portrait geometry**: 210 × 297 mm, always one page. Default six photos with no gap is the exact edge-to-edge six-up row.
- **Top-aligned by default**, with a `Centred` option for the whole photo block.
- **A4 preview at true proportions** with millimetre measurements, cut guides, and a live metric panel in the sidebar.
- **Optional cut marks / hairlines / printed size labels**; measurement overlays are preview-only.
- **Photo Enhancement** using Canvas: auto exposure and grey-world white balance, percentile contrast, warmth, vibrance, multi-scale clarity/sharpening, and a low-strength edge-aware skin-smoothing pass. Original is always preserved; Original/Enhanced comparison, adjustable auto strength, and reset.
- **Background removal / replacement**: a local MediaPipe selfie segmenter cuts the subject out of the photo and composites it over white, pale blue, light grey, or a custom colour. Edge softness is adjustable, and the original background can be restored instantly. Automatic cutouts are approximate — the UI says to check hair and ears.
- **Manual crop at the selected passport ratio** with drag, wheel/slider zoom, keyboard nudging and reset.
- **Take Photo on mobile** through the native camera, plus Choose Photo, drag/drop, replace and retake. HEIC/HEIF is accepted where the browser can decode it (Safari); other browsers get a clear explanation instead of a silent failure.
- **Optional face suggestion** using vendored MediaPipe Tasks Vision + BlazeFace. It fails gracefully to a centred crop; photo editing never depends on it.
- **PDF download** with jsPDF in millimetres, plus a direct print path that uses an A4, zero-margin print document.
- **Mobile printing**: Print / Share PDF sends the A4 PDF to the share sheet (AirPrint) on supported phones; without Web Share, the same button opens the browser print dialog with a dedicated exact-size print sheet. Save PDF stays available.
- **Mobile-friendly drawer**: on a phone the preview fills the screen and a floating **Adjust photo / Print settings** button opens the settings panel; all controls remain reachable with large touch targets and safe-area padding.
- **Installable PWA**: web app manifest with any/maskable icons, standalone display, a service worker for the offline app shell, and an in-app install flow with iPhone/Android instructions.
- **Accounts**: email/password registration and sign-in, with bcrypt-hashed passwords. The first print-ready export is free per account. There is no password-reset email flow yet; support handles resets.
- **Subscription and invoices**: ₹100/month via Razorpay Subscriptions, with payment history, downloadable invoice/receipt PDFs, and cancellation at the end of the current period.
- **Privacy**: photos are decoded and processed in memory with Canvas and are never uploaded. Account and billing requests go to the Sheetomatic API; Razorpay receives only the checkout details. The face-detection model and WASM are vendored locally.

## Accounts and billing

- Registration requires name, email, password (8+ characters with a letter and number), and acceptance of the Terms/Privacy Policy.
- Account sessions are bearer tokens; passwords are bcrypt-hashed and login is rate-limited.
- The first PDF/print export is free per account. Subsequent exports require an active subscription.
- The subscription is **₹100/month** through Razorpay. Payment receipts are stored as invoices and can be downloaded as PDF from the account panel.
- Cancellation is self-serve and takes effect at the end of the current billing period.
- The app uses the Sheetomatic Workspace API for accounts, subscriptions and invoices; photo processing remains local.
- Invoices are payment receipts. GST/tax invoicing requires the seller GST configuration; the current receipt says tax treatment is as applicable.
- This is a client-enforced export gate, not DRM: a user who modifies the static client can bypass it. Hard enforcement would require server-side PDF rendering.

## The physical geometry

Every photo is exactly the selected width × height. The default is 35 × 45 mm. Size, quantity and gap together determine how many photos fit per row and how the block is arranged. The crop frame switches to the same ratio.

For `N` photos of width `w` and height `h`, gap `g`, A4 width 210 mm and height 297 mm:

```
max columns = floor((210 + g) / (w + g))
max rows    = floor((297 + g) / (h + g))
capacity    = max columns × max rows
count       = min(N, capacity)          // the UI shows the reduced count
rows        = ceil(count / maxColumns)
columns     = ceil(count / rows)
block width = columns × w + (columns − 1) × g
block height= rows × h + (rows − 1) × g
block x     = (210 − block width) / 2
block y     = 0 (Top) or (297 − block height) / 2 (Centred)
```

Rows with fewer photos are centred inside the block. The count is clamped to the sheet capacity rather than overflowing the page, and the UI reports the reduced limit.

### Default: six photos, no gap

```
page        = 210 × 297 mm (portrait)
photos      = 6 × 35 × 45 mm  (default)
columns     = 6
rows        = 1
block       = 210 × 45 mm at x = 0, y = 0
gaps        = 0 mm
side margin = 0 mm
```

This is the exact edge-to-edge six-up row. It needs a borderless printer for the outer edges.

### Eight photos, 2 mm gap

```
columns     = 4
rows        = 2
block       = 146 × 92 mm
block x     = 32 mm
block y     = 0 mm (Top)
photo gap   = 2 mm horizontally and vertically
```

### Six photos, 2 mm gap

Six 35 mm photos plus five 2 mm gaps would need 220 mm, more than A4's 210 mm, so the app wraps them into a balanced 3 × 2 grid (109 × 92 mm). Photos remain exactly 35 × 45 mm.

### Twenty-four photos, 8 mm gap

```
columns     = 5
rows        = 5
block       = 207 × 257 mm
block x     = 1.5 mm
block y     = 0 mm (Top)
```

Still one A4 page.

### Pixel dimensions

Rendered pixels follow the selected physical width and height at the chosen dpi. The crop rectangle uses the same ratio, so the portrait is never stretched:

| Photo width | 600 dpi render | Effective dpi |
| --- | --- | --- |
| 35 × 45 mm at 600 dpi | 827 × 1063 px | ≈600 dpi |
| 35 × 45 mm at 300 dpi | 413 × 531 px | ≈300 dpi |
| 35 × 35 mm at 600 dpi | 827 × 827 px | ≈600 dpi |
| 33 × 48 mm at 600 dpi | 780 × 1134 px | ≈600 dpi |
| 50.8 × 50.8 mm (2 × 2 in) at 600 dpi | 1200 × 1200 px | ≈600 dpi |

The source crop and target canvas share the selected aspect (within a pixel of rounding), so images are never stretched.

## Workflow

1. **Photo setup (sidebar)** — take a photo with the phone camera, choose from the library, or drag/drop; JPG, PNG, WEBP (and HEIC where supported) up to 40 MB. Type and decode failures show a clear error without breaking the current session.
2. **Enhance** — Original/Enhanced toggle, auto strength, brightness, contrast, warmth, sharpness and skin smoothing. The original is untouched.
3. **Background** — switch removal on, pick White/Blue/Grey/Custom, adjust edge softness, or return to Original. The cutout runs locally with the bundled selfie segmenter.
4. **Crop** — a frame locked to the selected passport ratio; drag to pan, scroll/slider/± to zoom, arrow keys to nudge, Reset Crop. A face is suggested automatically when the local detector loads.
5. **Looks good → print setup** — approve the portrait and move to the print stage. The A4 preview remains the only thing on the front.
6. **Print setup (sidebar)** — edit passport **width and height** (or pick a preset), then adjust quantity, gap, vertical position, cut guides, print quality, printed labels and measurements. The crop frame and preview update live. If a size can only fit fewer photos, the quantity is reduced and the limit is shown.
7. **Export** — Download PDF (one page) or Print. On mobile, Print / Share PDF uses the share sheet when available and falls back to the system print dialog; desktop uses the browser's print dialog with the A4 sheet.
8. **Back to photo / Replace / Retake / Remove** — returning preserves the print layout; replacing re-renders every copy; removing resets the layout and returns to the empty preview.

## Print instructions

Desktop print dialog, or the print options behind the mobile share sheet:

- Paper: **A4**
- Orientation: **Portrait**
- Scale: **100% / Actual size**
- Turn off **Fit to page / Shrink to fit**

On a phone:

- **Share / AirPrint available** (HTTPS): tap **Print / Share PDF**, choose **Print** in the share sheet, then confirm A4 / Portrait / 100%.
- **Share unavailable** (plain HTTP): tap **Print / Share PDF** and the browser print dialog opens directly. The temporary print sheet is exactly A4 with the same millimetre layout; it is scoped so normal printing of the app is unaffected.
- **Save PDF** is always available in the mobile print dialog.

If the photo block reaches the paper edge (the default six-up row does), use borderless printing or trim the sheet. With a gap and/or fewer than six photos, the block has side margins and prints comfortably within a normal printer's printable area. The PDF and print document both carry the same millimetre coordinates; the preview uses the same `computeLayout()` result.

## Project structure

```
passport-photo-maker/
├─ index.html                  # sidebar + preview-only workspace shell
├─ styles.css                  # visual system, responsive drawer, A4 sheet
├─ js/
│  ├─ geometry.js              # A4 grid maths, guides, verification (source of truth)
│  ├─ image-processing.js      # decode, tone analysis, skin smoothing, background compositing, crop rendering
│  ├─ background.js            # lazy local selfie segmentation for cutouts
│  ├─ crop.js                  # selected-ratio crop model, clamping, face framing
│  ├─ face-detect.js           # lazy local MediaPipe loader
│  ├─ app.js                   # state, staged sidebar, preview, export
│  ├─ pdf.js                   # jsPDF page and millimetre placements
│  ├─ print.js                 # exact print document + iframe printing
│  └─ billing.js               # account, subscription, invoices and export gate
├─ vendor/
│  ├─ jspdf.umd.min.js         # pinned jsPDF 2.5.2
│  └─ mediapipe/               # Tasks Vision 0.10.14, BlazeFace, selfie segmenter model
├─ icons/                      # 192/512/maskable/apple-touch/favicon PNGs
├─ manifest.json               # PWA manifest (standalone, relative scope)
├─ sw.js                       # offline app-shell cache + runtime vendor cache
├─ js/pwa.js                   # service worker registration + install UI
├─ .nojekyll                   # GitHub Pages: serve files as-is
├─ tests/
│  ├─ unit/                    # geometry, crop, PDF, print, upload, PWA tests
│  ├─ e2e.mjs                  # real-browser acceptance run
│  └─ fixtures/                # generated synthetic test portraits
├─ screenshots/                # app and print-sheet captures from the test run
├─ server.mjs                  # zero-dependency static server
└─ package.json
```

## Verification

Run `npm test`:

- Default layout: six photos, 35 × 45 mm, one row, 210 mm wide, gap 0, top 0 mm.
- Editable sizes: 35 × 35 mm square, 33 × 48 mm, 50.8 × 50.8 mm (2 × 2 in) and custom 40 × 50 mm preserve their own aspect; the crop state follows the size.
- Quantity/gap layout: 8 photos at 2 mm → 4 × 2, 146 × 92 mm, block x 32 mm; 6 at 2 mm wraps to 3 × 2; 24 at 8 mm fits as 5 × 5 in 207 × 257 mm.
- Quantity clamps to 1–24, gap clamps to 0–8 mm; Top/Centred placement stays inside the page.
- Pixel outputs follow the selected size: 35 × 45 mm at 600 dpi gives 827 × 1063; 35 × 35 gives 827 × 827; 50.8 × 50.8 gives 1200 × 1200; 35 × 45 at 300 dpi gives 413 × 531.
- Cut marks trace every photo; hairlines cover every photo edge.
- PDF `MediaBox` = 595.2756 × 841.8898 pt = 210 × 297 mm; exactly one page; all selected photos at the selected width × height with the requested gaps; multi-row and custom-size positions checked.
- Print CSS uses `@page { size: 210mm 297mm; margin: 0 }`; all selected images at exact millimetre positions; no body titles.
- Printed labels are opt-in and render as one block caption, not one overlapping label per photo.
- Camera-style uploads without an extension, HEIC acceptance, format rejection, empty/oversized files.
- PWA manifest fields, icon dimensions/purposes, screenshots, service-worker precache and navigation fallback, and the install/theme metadata.
- Enhancement reset returns to the new defaults (auto strength, contrast, sharpness, smoothing, warmth).

Run `npm run test:e2e` (real Chrome, headless):

- Empty preview and disabled actions; desktop sidebar visible; corrupt, unsupported and unreadable HEIC files rejected.
- Upload → live preview with six identical images; default photo positions measured in the browser: 35 × 45 mm at 0, 35, 70 … 175 mm, top 0 mm.
- Approval gate moves the sidebar to Print setup; Back returns to Photo setup.
- Quantity/gap controls: eight photos at 2 mm → 4 × 2, 146 × 92 mm block; all eight on the sheet with exact 35 × 45 mm dimensions and 2 mm gaps.
- Editable size: 35 × 35 square and custom 40 × 50 change the crop aspect and sheet images; resetting to 35 × 45 restores the standard ratio and quantity.
- Top/Centred placement, measurements, guides (none / hairlines / cut marks) and single printed label.
- Zoom/drag/reset, Original/Enhanced, adjustment reset.
- Generate Preview → all geometry checks pass.
- PDF bytes and **actual downloaded file**: one A4 portrait page with eight photo draw operations.
- Print stylesheet measured in a browser and printed to PDF: one page, correct page size, all eight photos positioned exactly.
- Desktop print dialog and instructions.
- Replace photo updates all eight copies; remove returns to the empty state.
- **Mobile emulation** (iPhone UA, touch, 390 × 844): preview-only front, off-canvas drawer, Adjust/Upload button, Take Photo/Choose Photo in the drawer, `capture="user"` path loads the photo, Retake visible, no horizontal overflow.
- **Mobile share path**: stubbed Web Share receives a real `application/pdf` File of the print sheet.
- **Background removal**: white and pale-blue cutouts measured at the sheet corners, Original restored on toggle, and the full-resolution export canvas checked for a white background.
- **Mobile print fallback**: with sharing disabled, the direct print portal opens with the six default 35 × 45 mm photos, measured in print media, and produces exactly one A4 page.
- **Live GitHub Pages deploy**: installability errors empty, service worker controlling the page, passport photos and face detection working on the deployed HTTPS origin, and an offline reload rendering the app shell.
- Face detection blocked at the network layer → warning status, manual six-photo flow still works.
- **PWA installability** via Chrome's `Page.getInstallabilityErrors`: no errors; standalone manifest, three icons and a service worker.
- **Offline launch**: after service-worker activation, a reload with networking disabled still renders the app shell.
- **No external network requests** during the whole run.
- No page errors.

## Live deployment

The public site is hosted on **GitHub Pages** from the `main` branch at
https://sheetomatic.github.io/passport-photo-maker/. `.nojekyll` keeps the static
files untouched. HTTPS gives the service worker, install prompt, camera and Web
Share a secure context.

Redeploy after changes:

```bash
git add . && git commit -m "Update app" && git push
```

The shell is versioned twice for safe upgrades: `styles.css?v=7`, the module
import map and `sw.js` cache version. When changing shell assets, bump all three
(`v=7` in `index.html`, the import map and `CACHE_VERSION` in `sw.js`). The
service worker is network-first for HTML/CSS/JS and precaches with `cache:
'reload'`, so a deployment cannot mix new HTML with an old stylesheet.

If an already-installed copy is showing an older layout, close and reopen it,
or reload the page once; the versioned asset URLs bypass the old cache.

## Browser support

- Chrome / Edge 91+, Safari 16.4+, Firefox 108+ (the module import map requires a modern browser).
- PWA installation: Chrome/Edge/Android, Safari on iOS/iPadOS. Service workers require HTTPS or localhost.
- Camera capture uses the platform camera picker; this is a secure-context-independent native input.
- Web Share with files needs a secure context (HTTPS or localhost). The direct print fallback covers plain HTTP.
- Face detection needs WebAssembly SIMD (all current mainstream browsers). If it cannot load, the app says so and falls back to a centred crop at the selected ratio; every other feature works offline.
- HEIC/HEIF decoding depends on the browser; Safari on Apple platforms works, most desktop browsers do not. The app explains this if a HEIC file cannot be decoded.
- The face model and all libraries are loaded from `vendor/` — no CDN.

## Limitations

- This is a print-sheet tool, **not an official compliance guarantee**. Passport rules vary by country; check requirements (head size, background, expression, recency) before submitting.
- Automatic background cutouts are approximate around fine hair and thin straps. Inspect the preview at full size, or keep the original background, when edges matter.
- Passport size supports 15–100 × 15–150 mm. The sheet supports 1–24 photos and 0–8 mm gaps; larger sizes/quantities are intentionally out of scope. If a size cannot fit all requested photos, the quantity is reduced to the sheet capacity.
- A block that reaches the paper edge (notably the default six-up row) depends on borderless printer hardware. Use a gap or fewer photos to create printable margins.
- Very large images are downscaled to 3200 px on the long edge before processing, which is far above the 827 px print requirement at 600 dpi.
- The mobile direct-print path relies on the browser's print implementation; the PDF path is the exact, portable fallback.
- AirPrint/share availability depends on the browser and context, not the app.
- Face detection is a suggestion, not a guarantee; use the manual crop whenever framing matters.
- Account, subscription and invoice features require the Sheetomatic API and an internet connection. Photos themselves stay on-device.
- The ₹100 price is the Razorpay plan amount; GST/tax treatment must be configured separately if applicable.
- There is no self-serve password reset or email verification yet. Registration accepts an email address without proving ownership; support handles account recovery.

## Privacy

All photo decoding, enhancement, background segmentation, face detection and PDF generation happen in the browser. **Photos are held in memory only and are never uploaded or persisted.** The account feature sends name, email, password hash and billing identifiers to the Sheetomatic API; payments are processed by Razorpay. The app has no analytics. Object URLs are cleaned up after use.

## Third-party notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). jsPDF is MIT-licensed; MediaPipe Tasks Vision and BlazeFace are Apache-2.0.
