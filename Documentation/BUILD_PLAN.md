# Build plan

The steps below keep a usable vertical slice after each stage. The page underlay and shared canvas coordinates can be built before viewer integration; complete the viewer spike before depending on sphere hotspot position and orientation for plan links.

**Current slice:** page-scoped underlay upload/replacement/removal, shared page-space pan and zoom, and one numbered canvas node per photo are implemented. The next technical gate is the viewer spike in step 2; **Create Link** remains unavailable until hotspot direction and placement are verified.

## 1. Repository and domain foundation

- Fill the root [`.env.example`](../.env.example) using the [service setup guide](SERVICE_SETUP.md). Configure Vite `envDir` and Express environment loading to use the repository root.
- Create the TypeScript workspace and React/Express apps in the [proposed structure](ARCHITECTURE.md).
- Adopt the [code style and logging conventions](CODE_STYLE.md) from the first feature, including request IDs for API errors.
- Add the shared tour/scene/page/link types, validation contracts, angle normalization, and plan-bearing function.
- Add local design tokens copied from the reference frontend, with a small set of reusable buttons, tabs, panels, and status components.
- Add Firebase email/password registration, sign-in, sign-out, password reset, and an auth-state provider. Add Firebase Admin token verification to Express and `owner_uid` to the tour schema. Follow the [authentication contract](AUTH.md).
- Set up SQLite migrations, foreign keys, WAL mode, and a local S3-compatible development target or a configured test bucket.
- Connect both apps to the Firebase Authentication emulator for local access checks.

**Verify:** cardinal bearing examples, reverse bearings, rotated page north, the same schema loading on a clean database, and an unauthenticated API request receiving `401`.

## 2. Panorama integration spike

- Implement the PSV adapter and React mount/unmount lifecycle.
- Load two sample panoramas as scenes and navigate by a directed link and by a custom thumbnail tray.
- Confirm 2D links at the horizon and above/below it, then verify click placement and direct drag editing in viewer Edit mode with pointer and touch input.
- Validate shared north calibration against cardinal plan directions. Keep a click-to-reposition control even if drag works.

**Gate:** the [research spike checks](VIEWER_RESEARCH.md#first-implementation-spike) pass before depending on PSV-specific editor behavior.

## 3. Media and tour persistence

- Implement tours, pages, presigned uploads, completion verification, thumbnail generation, ready/error states, and the viewer manifest.
- In the photo library, support multi-select and drag-and-drop uploads. A repeated visible filename within a tour replaces the scene asset after validation while preserving its scene ID, placement, and links; invalid replacements retain the prior ready image.
- Scope tour listing, editor data, viewer manifests, and signed upload/read URLs to the verified Firebase owner UID.
- Persist and load every ready panorama as a scene, including unplaced photos.
- Implement page-scoped underlay upload, replacement, signed read, and removal using `plan` assets. Keep the old underlay visible until a replacement validates; removing it clears the page reference and deletes the stored image without moving nodes.
- Implement page and scene naming/order plus entry-scene selection. Keep at least one page per tour; deleting another page removes its placements and plan connections, retires its underlay, and retains scenes and independent viewer links.

**Verify:** upload several photos, reload as the same user, and see all ready scenes in the tray while an optional underlay remains attached only to its page. Sign in as another user and confirm that none of the tour data or media URLs are available.

## 4. Creator canvas and graph

- Render each page's underlay as an image inside a shared page-space world with nodes and connection paths. Build pan/zoom and invert the viewport transform for click placement; keep underlay controls in the fixed top-right canvas toolbar. Lock independent underlay resizing/movement in this slice.
- In canvas mode, select an unplaced library photo, click the page to place its one numbered node, and clear the selection. Clicking the active photo toggles it off; clicking another available photo switches it. A placed photo remains visible but cannot be selected for another canvas node.
- With no photo active, select a node and show its name, plan-connected nodes, and independent viewer links in the inspector. **Create Link** then accepts a different node on the same page. Reject a duplicate unordered pair; allow each node to connect to many distinct nodes.
- Add same-page plan connections that create two directed links, with automatic horizon positions derived from canvas bearings. Keep viewer-created links separate even when they share a source and target with a plan connection.
- Add cross-page connection flow with manual positions for both directions and page portal indicators.
- Add inspector actions for deleting a direction or entire connection. Make all graph changes transactional on the API.

**Verify:** an underlay belongs to one page, its remove control deletes the stored image but retains nodes, and pan/zoom keeps underlay, nodes, and lines aligned. A placed photo cannot create a second canvas node; a node can connect to several different nodes but not duplicate a pair. Moving a node updates auto links in the panorama, and deleting a node removes only its plan connections.

## 5. Panorama link editing and viewer mode

- Add an owner-only **Edit mode** toggle to the full-screen viewer. Keep navigation as the default state and authorize every link mutation on the API.
- Add viewer-origin links from the sphere to **any ready uploaded photo**, including an unplaced one. Allow repeated hotspots to the same destination photo, each with its own link ID and position. Migrate the existing directed source/target uniqueness constraint before this step. Show link badges and a canvas side-panel entry without a solid connection.
- Add custom azimuth/elevation (yaw/pitch) overrides for any link, direct drag handles with click/numeric alternatives, reset-to-plan where eligible, and save feedback.
- Finish the all-photo thumbnail tray, current scene labels, error/empty states, keyboard controls, and mobile layout.

**Verify:** only the owner can enter Edit mode and save link changes; a manual hotspot stays fixed after a node move or refresh; a viewer-created link to an unplaced photo is traversable; every ready photo is reachable through the tray.

## 6. Stabilize for deployment

- Review Firebase token/owner checks, upload limits, S3 CORS, backup/restore procedure, and log coverage/redaction.
- Run a complete creator-to-viewer browser flow with real sample panoramas on desktop and mobile viewports, including reduced motion and keyboard use.
- Keep the first deployment's viewer owner-only. If public sharing is added later, use a separate read-only access rule and test that editor mutations stay protected.

The initial release can omit video, multi-resolution tiling, collaborative editing, and public publishing controls if sharing is not yet needed. Their data boundaries are reserved in the architecture so those features do not force a rewrite of the editor graph.
