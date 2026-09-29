# Design direction

The visual reference is `F:\Web Dev\jim-locations\frontend`. Specifically, `src/styles/tokens.css`, `src/styles/global.css`, `src/styles/designer.css`, and `src/components/SiteHeader.tsx` define the shared look. Copy the relevant tokens into this app's own theme package; do not import the other project's entire stylesheet or app components.

## Visual language to carry over

| Element | Reference value or treatment | Use here |
| --- | --- | --- |
| Typeface | Manrope with Helvetica/Arial fallback | Editor UI, labels, viewer controls |
| Main colors | Canvas `#ffffff`, ink `#101010`, text `#2b2a28` | White workspace, dark labels and primary actions |
| Muted colors | Surface `#f2f1ed`, text `#696762`, lines `#d6d4ce` | Panels, canvas surround, dividers |
| Accent | Orange `#d9682f` / hover `#bd5522` | Selected photo/node/link and active tools |
| Danger | `#9a351d` | Delete actions and destructive confirmation |
| Controls | Square corners, thin borders, compact bold labels | Toolbars, tabs, inspector actions |
| Page rhythm | `--page-gutter: clamp(1.25rem, 4.7vw, 5.5rem)` and 4/8/12/16/24/32/48 px spacing | Outer shell; tighter spacing inside dense editor panels |

Reference workspace pages use a restrained top rule, small uppercase eyebrow, generous headline spacing, hairline panel dividers, and an active tab underline. The new editor should retain those cues while giving the canvas most of the viewport.

## Editor layout

Sign-in, Create account, and Forgot password screens use the same Manrope type, thin rules, square buttons, and restrained spacing as the editor. The signed-in account control exposes Sign out. A protected tour route waits for Firebase to restore the session before showing the editor or redirecting to Sign in.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Brand   ← All tours   Tour title       Save   Open viewer   Account │
├───────────────┬─────────────────────────────────────┬────────────────┤
│ PHOTO LIBRARY │ Floor tabs      Upload underlay · × │ INSPECTOR      │
│ Upload photos │ ┌─────────────────────────────────┐ │ Node details   │
│ Search/list   │ │ Underlay image or blank grid    │ │ Create Link    │
│ Thumbnails    │ │ Nodes and canvas connections    │ │ Delete         │
│               │ └─────────────────────────────────┘ │                │
└──────────────────────────────────────────────────────────────────────┘
```

The tour title, **All tours** link, save state, and **Open viewer** action live in the top navigation. The editor has no embedded 360 preview; the page canvas uses the available viewport height. On smaller screens, Library, Plan, and Inspector stack or become tabs/drawers rather than three squeezed columns. Keep the selected node and current page visible when switching panels. The creator can select, connect, and delete by keyboard as well as pointer; dragging has a click-to-place alternative.

Canvas conventions:

- A plan is optional. A blank, lightly gridded page still supports node placement.
- Each page has a visible name, an optional raster underlay, and a north indicator. Put a text-only **Upload underlay** link at the top right of the canvas toolbar. Once uploaded, the link becomes **Replace underlay** and a small **×** immediately to its right removes and deletes that page's underlay image. Give the × an accessible label naming the page. Keep the control outside the panning/zooming world so it stays visible. The underlay itself is a locked image item inside that world alongside nodes and lines, so all three move together when the viewport pans or zooms.
- Ready photo cards use a taller, edge-to-edge panorama thumbnail. The extension-free original filename appears over the image with a left-side circular scene number. Canvas nodes use that same number alone inside a circle; the number comes from scene order and remains attached to the scene when its photo is replaced.
- A ready photo without a node can be selected for canvas placement. Clicking it again clears the selection; clicking another available photo switches the selection. Clicking the canvas places its numbered node at the clicked page-space location and clears the photo selection. Mark placed photos in the canvas library and disable them for additional placement; do not hide them. The viewer link editor uses the same photos but allows any destination to be selected repeatedly for separate hotspots.
- With no photo active, clicking a node selects it. The inspector shows the node's photo name, other nodes connected on the canvas, and custom viewer-created links as a separate list. **Create Link** arms the selected node; clicking another node on the same page draws one solid connection and creates its two sphere links. Distinct nodes may have many connections, but an already connected pair cannot get a second canvas line. Provide a cancel path for Create Link mode and clear visual feedback for an ineligible target.
- Selected library photo and selected node use the orange accent; canvas-origin connections use solid lines. A viewer-origin link gets an outgoing-link badge on its source node, when one exists, and an optional dashed directional hint while selected. An unplaced source photo shows the same badge in the library and a link entry in the canvas side panel, without becoming a normal solid plan connection.
- Link selection displays its destination, placement type (`From plan` or `Custom position`), reset-to-plan action, and delete action.
- Node selection shows the photo name, floor, connected nodes, outgoing/incoming viewer links, and delete. Deleting a node requires a confirmation that states its plan connections will be removed; the photo and its independent viewer-created links remain in the library and viewer.
- Page deletion lives in the inspector. Disable it for the last page. Otherwise show a confirmation with the number of nodes that will be removed and explain that photos and independent viewer links remain. After success, select a remaining page.
- Every editing action shows saving/saved/error state. Failed uploads and unsaved edits remain visible and retryable.
- The photo library has a visible drag-and-drop target and a **Choose photos** button that accepts multiple files. It lists transfer progress per file, then shows a thumbnail for each ready photo. Files with the same visible name are processed in selection order so the last valid upload becomes the scene image. Failed or interrupted uploads show **Check upload** and **Remove** actions; an unsuccessful replacement does not hide the ready scene.

## Viewer layout

The panorama fills the viewport. A compact top layer provides tour title, current scene/floor, exit/back control, and an **Edit mode** toggle for the signed-in owner. Viewing is the default. Edit mode reveals link handles, Add link, save feedback, and click/numeric alternatives to dragging; the handles can be moved directly across the sphere to adjust azimuth and elevation. A bottom thumbnail tray shows every scene in the walkthrough, highlights the current scene, and scrolls horizontally. Clicking a thumbnail changes scenes; the tray stays reachable on mobile. Controls should have visible focus states and descriptive labels.

The viewer should start on the tour's chosen entry scene, handle an isolated scene with no links, and present a clear fallback if an image fails to load. The tray is scene based: every ready uploaded 360 photo appears once, including photos with no canvas node. Unplaced photos have an `Unplaced` location label. Pending or failed uploads remain visible in the editor library but cannot be opened in the viewer until ready.

## Accessibility and motion

Use semantic buttons for tool actions, page tabs, node controls, tray thumbnails, and links. Give panorama links a target name and focus outline. Provide a non-drag path for placing nodes and adjusting link angles. Respect `prefers-reduced-motion` for tour transitions and UI movement. Keep text and controls legible over changing photo content with a subtle gradient or opaque control surface where needed.
