# Build plan

The steps below keep a usable vertical slice after each stage. Do the viewer spike before building the full editor canvas, since hotspot position and orientation are the largest technical unknowns.

## 1. Repository and domain foundation

- Fill the root [`.env.example`](../.env.example) using the [service setup guide](SERVICE_SETUP.md). Configure Vite `envDir` and Express environment loading to use the repository root.
- Create the TypeScript workspace and React/Express apps in the [proposed structure](ARCHITECTURE.md).
- Add the shared tour/scene/page/link types, validation contracts, angle normalization, and plan-bearing function.
- Add local design tokens copied from the reference frontend, with a small set of reusable buttons, tabs, panels, and status components.
- Add Firebase email/password registration, sign-in, sign-out, password reset, and an auth-state provider. Add Firebase Admin token verification to Express and `owner_uid` to the tour schema. Follow the [authentication contract](AUTH.md).
- Set up SQLite migrations, foreign keys, WAL mode, and a local S3-compatible development target or a configured test bucket.
- Connect both apps to the Firebase Authentication emulator for local access checks.

**Verify:** cardinal bearing examples, reverse bearings, rotated page north, the same schema loading on a clean database, and an unauthenticated API request receiving `401`.

## 2. Panorama integration spike

- Implement the PSV adapter and React mount/unmount lifecycle.
- Load two sample panoramas as scenes and navigate by a directed link and by a custom thumbnail tray.
- Confirm 2D links at the horizon and above/below it, then verify click placement and direct drag editing with pointer and touch input.
- Validate shared north calibration against cardinal plan directions. Keep a click-to-reposition control even if drag works.

**Gate:** the [research spike checks](VIEWER_RESEARCH.md#first-implementation-spike) pass before depending on PSV-specific editor behavior.

## 3. Media and tour persistence

- Implement tours, pages, presigned uploads, completion verification, thumbnail generation, ready/error states, and the viewer manifest.
- Scope tour listing, editor data, viewer manifests, and signed upload/read URLs to the verified Firebase owner UID.
- Persist and load every ready panorama as a scene, including unplaced photos.
- Implement page and scene naming/order plus entry-scene selection.

**Verify:** upload several photos, reload as the same user, and see all ready scenes in the tray while an optional plan image remains attached to its page. Sign in as another user and confirm that none of the tour data or media URLs are available.

## 4. Creator canvas and graph

- Build the library, multipage canvas, plan image background, pan/zoom, node placement/movement, north control, selection, and node deletion.
- Add same-page plan connections that create two directed links, with automatic horizon positions derived from canvas bearings.
- Add cross-page connection flow with manual positions for both directions and page portal indicators.
- Add inspector actions for deleting a direction or entire connection. Make all graph changes transactional on the API.

**Verify:** moving a node updates auto links in the panorama, changing pages preserves positions, and deleting a node removes only its plan connections.

## 5. Panorama link editing and viewer mode

- Add viewer-origin links from the panorama preview to **any ready uploaded photo**, including an unplaced one. Show link badges and a canvas side-panel entry without a solid connection.
- Add custom yaw/pitch overrides for any link, drag/click controls, reset-to-plan where eligible, and save feedback.
- Finish full-screen viewer mode, all-photo thumbnail tray, current scene labels, error/empty states, keyboard controls, and mobile layout.

**Verify:** a manual hotspot stays fixed after a node move or refresh; a viewer-created link to an unplaced photo is traversable; every ready photo is reachable through the tray.

## 6. Stabilize for deployment

- Review Firebase token/owner checks, upload limits, S3 CORS, backup/restore procedure, and structured error logging.
- Run a complete creator-to-viewer browser flow with real sample panoramas on desktop and mobile viewports, including reduced motion and keyboard use.
- Keep the first deployment's viewer owner-only. If public sharing is added later, use a separate read-only access rule and test that editor mutations stay protected.

The initial release can omit video, multi-resolution tiling, collaborative editing, and public publishing controls if sharing is not yet needed. Their data boundaries are reserved in the architecture so those features do not force a rewrite of the editor graph.
