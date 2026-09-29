# Product specification

## Goal and language

Build an app for authoring and viewing 360° photo walkthroughs of apartments, houses, and similar spaces. A **tour** contains uploaded 360 photos. Every ready photo is a **scene** in the viewer, even if it has no position on a plan. A **page** represents a floor or another section of the tour. A **node** is a scene placed on one page. A **navigation link** is a directed clickable hotspot from one scene to another. A **plan connection** is an editor relationship between two placed nodes that creates navigation links in both directions by default.

These definitions keep the library, canvas, and viewer in sync without requiring every photo to be placed on a floor plan.

## Accounts and access

Creators register and sign in through Firebase Authentication, initially with email and password. They can sign out and request a password-reset email. Each tour belongs to the Firebase user who created it. Only that signed-in owner can list, edit, upload media to, or open the viewer for the tour in the first build. A public read-only sharing feature can be added later. See the [authentication contract](AUTH.md).

## Creator mode

1. Create a tour and add one or more pages. Each page may have its own floor-plan underlay image or remain a blank canvas. A text link at the top right of the page canvas uploads an underlay; when one exists, the link allows replacement and a small **×** beside it removes the underlay and deletes its stored image. Removal leaves that page's nodes and links in place. Give pages names such as Ground floor and First floor. The user can set the north direction on each page; top of page is north initially. A page can be deleted only when another page remains. Deleting it removes all its nodes, their plan connections (including cross-page connections), and the links owned by those connections. The uploaded panorama photos and independent viewer-created links remain.
2. Upload multiple equirectangular 360 photos through a file picker or drag-and-drop area. Show each upload in the side library immediately with uploading, processing, ready, or error state. Validation turns a ready photo into a scene that can be opened in the viewer before placement. A photo with the same visible name in the same tour replaces the old image, regardless of filename case or JPEG/PNG/WebP extension. Keep its scene ID, title, order, placement, and links. The old image remains active until the replacement is validated; a failed replacement leaves it intact.
3. In the canvas editor, click a ready photo in the library to make it active, then click the active page canvas to create its node at that position. Click the active photo again to clear the selection, or click a different available photo to switch it. After placement, clear the photo selection and make that photo unavailable for another canvas node; it remains visible in the library with a placed state. Ready photo cards show the extension-free original filename over the thumbnail and a numbered circle. The canvas node shows only that same number in a circle. Move an existing node by dragging or through position controls. A scene has at most one canvas node in the tour and remains viewable without one. The viewer's link editor uses the same photo library but allows the same destination photo to be chosen repeatedly for separate hotspots.
4. With no library photo active, click a canvas node to inspect its photo name, connected nodes, and separately created viewer links. Choose **Create Link**, then click a different node on the same page to make one canvas connection between them. A node may connect to many other nodes, but the same unordered pair can have only one canvas connection. A same-page connection creates two directed navigation links by default and draws one solid canvas line. Its two hotspots are independently editable; direction indicators remain if one side is later removed. Viewer-created links remain separate, even when they point between the same scenes.
5. For a same-page plan connection, each hotspot starts on the horizon. Its yaw is derived from the bearing between the source and destination nodes, relative to page north. Moving either node updates only links whose position still comes from the plan.
6. Open the viewer and turn on **Edit mode** for an owned tour. Select and drag a hotspot directly on its source sphere to set a custom azimuth (yaw) and elevation (pitch), including above or below the horizon. A click-to-reposition or numeric control is an alternative to dragging. The custom position is saved and stays fixed when plan nodes move. **Reset to plan direction** clears that override when both nodes share a page.
7. In viewer Edit mode, choose **Add link**, pick any ready uploaded photo as the destination, and place the hotspot in the sphere. The same destination can be selected repeatedly to create separate hotspots from a source scene. Each hotspot has its own ID and custom position. These links do not create a plan connection or solid canvas line. Show an outgoing-link badge on the source node if it is placed; otherwise show it in the library and canvas side panel. If the target has a node, a selected viewer link may show a dashed directional hint.
8. Allow navigation across pages/floors. A cross-page plan connection can be selected from a page/target picker, but both hotspot positions must be set on their source spheres in viewer Edit mode because the pages do not share a common coordinate plane. Cross-page connections appear as labeled portals on each page, not a line stretching between pages. Viewer-created cross-page links work the same way as other viewer-created links.
9. Selecting a node exposes its details and a delete action. Deleting its placement removes its plan connections and their links, but retains the uploaded photo and viewer-created links. Deleting a photo from the library is a separate explicit action that removes its node and all links to or from that scene.
10. Save edits to the backend and make the current save state visible. Refreshing the editor must restore each page's underlay, nodes, connections, manual positions, and scene order. Panning or zooming a page moves the underlay, nodes, and lines together on screen; their relative positions do not change.

## Viewer mode

- Open as a separate, full-screen mode. Start at the chosen entry scene, or the first ready scene if one has not been chosen. Viewing is the default state.
- For a signed-in owner viewing their own tour, show an **Edit mode** toggle. Edit mode reveals link handles and authoring controls. Turning it off returns to navigation. A viewer without owner permission never sees or gains these controls; every mutation still requires server-side owner authorization.
- Pan, zoom, and click hotspots to traverse links. A link always identifies its destination scene. A scene with no outgoing links is still reachable from the thumbnail tray.
- Keep a bottom, horizontally scrollable tray containing **all ready uploaded 360 photos**, including unplaced ones. Highlight the active scene and switch to a scene when its thumbnail is chosen.
- Show a scene name and its page/floor when placed, or `Unplaced` when not. Provide a clear way back to the editor for an authorized creator.
- Preserve orientation across scene changes where practical, but a link's custom position controls where that link appears in its source panorama. Camera transition behavior can be refined after the first viewer prototype.

## Direction assumptions and limits

The initial capture assumption is that the photos have a common facing direction, such as north. The app still needs a one-time tour calibration for where north appears in the panorama image, because the image seam and camera metadata may differ. A later per-scene override can handle exceptions. Each page's north arrow handles a rotated floor-plan image. [PSV's orientation options](https://photo-sphere-viewer.js.org/guide/config) and [compass convention](https://photo-sphere-viewer.js.org/plugins/compass.html) provide the viewer-side correction.

Automatic bearings are meaningful only between nodes on the **same page**. Cross-page links and links involving an unplaced scene use manually chosen yaw/pitch. Pitch 0 means the horizon. Neither dragging a hotspot nor changing its numeric angle moves a node or a canvas connection.

## Acceptance examples

| Scenario | Expected result |
| --- | --- |
| Upload three photos; place only two | All three appear in the viewer tray; two nodes appear on the page. |
| Upload an underlay on Ground floor, then switch to First floor | The underlay appears only on Ground floor. Replacing or removing it does not move nodes. Removing it deletes the stored underlay image. |
| Pan or zoom a page with an underlay and nodes | Underlay, nodes, and connection lines transform together and stay aligned. |
| Select a photo, place a node, then click that photo again | The placed photo cannot be selected for another canvas node. Selecting and clicking an unplaced photo again toggles it off. |
| Select a node and use Create Link on another node | One canvas line and two directed sphere links are created. Repeating the same pair does not create a duplicate canvas connection. |
| Add two viewer hotspots to the same destination photo | Both remain separate and can have different positions. |
| Drop several photos, then upload `Kitchen.jpeg` after `kitchen.JPG` in the same tour | The library shows upload progress; the validated second image replaces the first while its scene and links stay in place. Another tour's `Kitchen` is unaffected. |
| A replacement fails image validation | The old ready scene remains available. The failed upload can be removed or retried. |
| Connect two nodes east/west on a north-up page | Two clickable links appear: east from the western node and west from the eastern node, both at pitch 0. |
| Move one connected node | The automatic bearings change; the plan line follows the nodes. |
| Drag one hotspot above the horizon, then move either node | That hotspot keeps its saved yaw/pitch; the reverse automatic link may still change. |
| Create a panorama link to an unplaced photo | The hotspot navigates to that photo; the canvas shows a badge/list entry, not a solid node connection. |
| Connect nodes on different floors | The creator sets each direction in its source panorama; both floor pages show a portal indicator. |
| Delete a node | Its scene remains in the tray; its plan connections disappear; unrelated viewer-created links survive. |
| Delete a page when two remain | Its nodes and their plan connections disappear; photos and independent viewer links remain; the remaining page becomes active. |
| Try to delete the last page | The action is unavailable in the editor and the API rejects it. |
| Open an owned scene in viewer Edit mode | Dragging a link changes its saved azimuth/elevation; turning Edit mode off restores normal navigation. |
| Refresh after editing | The signed-in owner sees the saved scenes, pages, images, nodes, links, and overrides. |
| Open another user's tour ID | No editor data, viewer manifest, or media URL is returned. |

## Scope and decisions

The first build targets still equirectangular 360 photos and raster floor plans. Video, 3D models, multi-resolution image tiling, collaborative editing, and public publishing controls can follow later. A separate, owner-only viewer route is part of the first build. All uploaded photos should be viewable, so initial implementations must not equate “scene” with “placed node.”
