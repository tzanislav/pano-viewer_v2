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
│ Brand / Tour title                        Save state   Preview viewer │
├───────────────┬─────────────────────────────────────┬────────────────┤
│ PHOTO LIBRARY │ Floor/page tabs   Place · Connect   │ INSPECTOR      │
│ Upload photos │ ┌─────────────────────────────────┐ │ Node details   │
│ Search/list   │ │ Plan image or blank grid        │ │ Connections    │
│ Thumbnails    │ │ Nodes and canvas connections    │ │ Delete         │
│               │ └─────────────────────────────────┘ │                │
├───────────────┴─────────────────────────────────────┴────────────────┤
│ 360 preview for selected photo · link handles · Add link             │
└──────────────────────────────────────────────────────────────────────┘
```

The preview can be resized or expanded to a focused panel so dragging links has enough room. On smaller screens, Library, Plan, and Panorama become tabs/drawers rather than three squeezed columns. Keep selected node and current page visible when switching panels. The creator can select, connect, and delete by keyboard as well as pointer; dragging has a click-to-place alternative.

Canvas conventions:

- A plan is optional. A blank, lightly gridded page still supports node placement.
- Each page has a visible name, an optional plan image, and a north indicator. The plan image is a locked background during node editing.
- Selected library photo and selected node use the orange accent; canvas-origin connections use solid lines. A viewer-origin link gets an outgoing-link badge on its source node, when one exists, and an optional dashed directional hint while selected. An unplaced source photo shows the same badge in the library and a link entry in the canvas side panel, without becoming a normal solid plan connection.
- Link selection displays its destination, placement type (`From plan` or `Custom position`), reset-to-plan action, and delete action.
- Node selection shows the photo thumbnail/name, floor, outgoing/incoming links, and delete. Deleting a node requires a confirmation that states its plan connections will be removed; the photo and its independent viewer-created links remain in the library and viewer.
- Every editing action shows saving/saved/error state. Failed uploads and unsaved edits remain visible and retryable.

## Viewer layout

The panorama fills the viewport. A compact top layer provides tour title, current scene/floor, and exit/back control. Links appear inside the panorama. A bottom thumbnail tray shows every scene in the walkthrough, highlights the current scene, and scrolls horizontally. Clicking a thumbnail changes scenes; the tray stays reachable on mobile. Controls should have visible focus states and descriptive labels.

The viewer should start on the tour's chosen entry scene, handle an isolated scene with no links, and present a clear fallback if an image fails to load. The tray is scene based: every ready uploaded 360 photo appears once, including photos with no canvas node. Unplaced photos have an `Unplaced` location label. Pending or failed uploads remain visible in the editor library but cannot be opened in the viewer until ready.

## Accessibility and motion

Use semantic buttons for tool actions, page tabs, node controls, tray thumbnails, and links. Give panorama links a target name and focus outline. Provide a non-drag path for placing nodes and adjusting link angles. Respect `prefers-reduced-motion` for tour transitions and UI movement. Keep text and controls legible over changing photo content with a subtle gradient or opaque control surface where needed.
