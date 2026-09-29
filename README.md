# 360 Walkthrough Builder

The app lets a creator build 360° walkthroughs from panorama photos and floor pages. The current slice includes Firebase account screens, protected tour routes, SQLite-backed tours and pages, north calibration controls, page deletion, and multi-photo uploads to private S3 storage. A tour always keeps at least one page. Deleting another page removes its nodes and plan connections while keeping the photos. The panorama viewer and link editing follow the [build plan](Documentation/BUILD_PLAN.md).

## Run locally

Requires Node.js 20.19+ or 22.12+, a Firebase project with Email/Password enabled, and an Admin credential or the Firebase Auth emulator. Fill the root `.env` from `.env.example` using the [service setup guide](Documentation/SERVICE_SETUP.md).

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3001`; `GET /health` checks that it started. The API creates `data/pano-viewer.sqlite` and applies migrations on startup. Keep this file when restarting the app so tours remain available. Set up the [S3 bucket policy and CORS](Documentation/SERVICE_SETUP.md#3-private-s3-media-bucket) before uploading photos.

For local emulator use, set both `VITE_FIREBASE_AUTH_EMULATOR_URL` and `FIREBASE_AUTH_EMULATOR_HOST` as shown in `.env.example`. The browser and API must use the same Firebase project ID. With the Firebase CLI installed, start the configured Auth emulator before signing in:

```powershell
firebase emulators:start --only auth --project YOUR_FIREBASE_PROJECT_ID
```

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Documentation

- [Product specification](Documentation/PRODUCT.md) — workflows, behavior, and acceptance criteria.
- [Architecture](Documentation/ARCHITECTURE.md) — data model, geometry, API, uploads, and component boundaries.
- [Code style](Documentation/CODE_STYLE.md) — focused components, action logging, development changes, and working conventions.
- [Authentication](Documentation/AUTH.md) — Firebase sign-in, Express token verification, and private tour access.
- [Service setup](Documentation/SERVICE_SETUP.md) — `.env.example` values and Firebase, S3, and SQLite setup instructions.
- [360 viewer research](Documentation/VIEWER_RESEARCH.md) — library comparison and recommended integration.
- [Design direction](Documentation/DESIGN.md) — layout and visual language from `F:\Web Dev\jim-locations\frontend`.
- [Build plan](Documentation/BUILD_PLAN.md) — implementation sequence and verification gates.

The editor accepts multiple JPEG, PNG, or WebP panoramas through the file picker or drag-and-drop area. Images must be roughly 2:1 and at least 1024 × 512 pixels. Reusing a photo name in the same tour, regardless of case or extension, replaces its image while retaining its scene ID, placement, and links. The old image remains available until the new image passes validation. Upload progress and processing errors appear in the photo library. The viewer route currently reports uploaded scenes while interactive panorama rendering is being built. The owner will use an Edit mode toggle in the viewer to place and drag link handles; the creator workspace has no embedded panorama preview.
