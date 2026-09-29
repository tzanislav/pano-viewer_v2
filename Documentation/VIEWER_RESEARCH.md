# 360 viewer library research

Researched 2026-09-28 against the projects' own documentation and repositories. The editor and viewer will be React applications; each candidate below is a JavaScript viewer that can be mounted inside a React component. A framework change is not needed for panorama rendering.

## Recommendation: Photo Sphere Viewer v5

Use **Photo Sphere Viewer** (PSV) through a small local React adapter. Its [Virtual Tour plugin](https://photo-sphere-viewer.js.org/plugins/virtual-tour.html) already models panorama nodes and directed links with explicit `{ yaw, pitch }` positions. It supports `setNodes`, `updateNode`, and `setCurrentNode`, plus client-side and server-loaded node data. Its [viewer click event](https://photo-sphere-viewer.js.org/guide/events) supplies yaw and pitch, which is useful for adding a link from inside a panorama. The [core coordinate helpers](https://photo-sphere-viewer.js.org/api/interfaces/Core.DataHelper.html) convert between viewer pixels and spherical coordinates for an editing interaction. PSV uses npm packages and Three.js, has an [MIT license](https://github.com/mistic100/Photo-Sphere-Viewer/blob/main/LICENSE), and documents [viewer cleanup](https://photo-sphere-viewer.js.org/guide/methods) for unmounting.

Use `positionMode: 'manual'` so our plan geometry owns the direction calculation. Prefer `renderMode: '2d'` for the first implementation: its manual links accept pitch as well as yaw, while the plugin's 3D arrow placement has its own pitch behavior. Confirm the exact above/below-horizon appearance in the first rendering spike. These are *viewer configuration modes*; the product's manual link override is a separate data-model concept. PSV's [Compass plugin](https://photo-sphere-viewer.js.org/plugins/compass.html) defines north at yaw 0 and documents orientation correction, which supports our shared-direction assumption.

The [Gallery plugin](https://photo-sphere-viewer.js.org/plugins/gallery.html) has a bottom thumbnail panel and integrates with virtual tours. It forces the panel to hide after a thumbnail click below 500 px. Since the requested tray should remain available and follow the reference design, build a small React thumbnail tray that calls `setCurrentNode`; the Gallery plugin remains an option if its behavior matches the final design. The [Map plugin](https://photo-sphere-viewer.js.org/plugins/map.html) can display an image map, but our multipage editor, node placement, and custom canvas feedback need their own canvas layer.

PSV does **not** document a ready-made drag editor for Virtual Tour links. The app must implement that interaction in the full-screen viewer's owner-only Edit mode: select a link, drag its handle, convert the pointer position to yaw/pitch, and save a manual override. Edit mode can also offer click-to-reposition and numeric yaw/pitch controls. Treat direct dragging over the viewer as a technical spike before committing to the final interaction. The [Markers plugin](https://photo-sphere-viewer.js.org/plugins/markers.html) can provide editable marker visuals, but its documented events and methods do not themselves define link dragging.

## Alternatives

| Library | Supported features in primary docs | Fit and trade-off |
| --- | --- | --- |
| [Photo Sphere Viewer](https://photo-sphere-viewer.js.org/plugins/virtual-tour.html) | Virtual Tour nodes and positioned links, click coordinates, gallery, plugins, TypeScript API. | Best base for the requested behavior. Editor canvas and drag handling remain app code. |
| [Pannellum](https://pannellum.org/documentation/reference/) | Scene tours and hotspots with yaw/pitch; `northOffset` and `sameAzimuth` support orientation-aware transitions. [MIT licensed](https://github.com/mpetroff/pannellum). | Good fallback if PSV's editing integration proves difficult. Floor plans, thumbnails, and editor interactions would be custom. |
| [Marzipano](https://www.marzipano.net/docs.html) | Scenes and DOM hotspots at yaw/pitch, including multi-resolution panoramas. | Flexible lower-level option, but the [repository was archived in April 2026](https://github.com/google/marzipano), so it is a poor default for a new reusable codebase. |

## Integration boundary

`PanoramaAdapter` should be the only app module that imports PSV. It accepts our own `Scene` and `NavigationLink` types, translates them to PSV nodes/links, exposes `goToNode`, `showEditorHandle`, and `screenPointToDirection`, and destroys the viewer on unmount. The viewer toggles its own editing controls; the creator workspace does not embed a panorama preview.

Do not persist PSV plugin objects or use its coordinates as the project's only source of truth. Store plan positions, calibrated headings, and manual yaw/pitch in the app's schema; derive PSV config from them. This keeps a later viewer swap possible.

## First implementation spike

1. Mount a two-scene tour inside React; unmount/remount without leaked WebGL contexts.
2. Place links at north/east/south/west from four canvas positions and verify their on-screen bearings after orientation correction.
3. Render one link at +45° pitch and one at -45° pitch in 2D mode; confirm both are clickable.
4. In viewer Edit mode, drag a link handle while the panorama can otherwise be panned. Save yaw/pitch, reload, then move a canvas node and verify the manual position remains fixed. Check that leaving Edit mode restores normal link navigation.
5. Switch scenes with the custom tray, including a narrow mobile viewport.

If step 3 or 4 fails, keep PSV for panorama display and render app-owned HTML hotspots using its documented coordinate helpers. If that is still impractical, prototype the same spike with Pannellum before changing frameworks.

### Implementation and visual check status (2026-09-29)

The application now mounts PSV v5 behind `PanoramaAdapter`, uses the Virtual Tour plugin for normal navigation, and destroys the instance when the viewer unmounts. A private manifest signs originals and thumbnails for every ready scene. A custom tray navigates to placed or unplaced scenes. Owner Edit mode renders app-owned drag handles over the panorama; pointer position is converted through PSV's coordinate helper and saved as photo-local yaw/pitch. Clicking the sphere or entering numbers also repositions a selected link. The API accepts repeated viewer links to the same target and keeps each link ID independent.

Automated checks cover cardinal direction math, a rotated page north arrow, manual direction stability after a plan move, owner authorization, and two saved hotspots at +45° and -45°. Same-page canvas **Create Link** is enabled and stores two automatic directed hotspots; either position can be overridden and reset to plan. These checks do not establish visible hotspot alignment or touch behavior. For the browser pass, use two real panoramas with recognizable compass directions: navigate by tray and hotspot, inspect north/east/south/west after calibration, place links above and below the horizon, drag one with mouse and touch, reload to confirm its position, pan the sphere while Edit mode is on, then turn Edit mode off and confirm normal hotspot navigation. Open and leave the viewer repeatedly to check for lingering WebGL contexts. Repeat the tray and editing check at a narrow mobile viewport.
