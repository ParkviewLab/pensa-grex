# Changelog

All notable changes to this project are recorded here.

## [Unreleased]

## [v1.3.0] - 2026-07-20

### Highlights

This release adds a Flagged toolbar toggle that filters the canvas to flagged nodes in a read-only review view, with flags themselves set by double-clicking a card and rendered as atomic orbits in the node's own colour, persisted in the forest file. Notes are now opened via a new memo-pad icon in the card's corner, and a task's status glyph can be cycled by single-clicking it. Node titles are centre-justified and enforced unique within a domain, project cards reserve height for two lines, and the sputnik "here" mark now takes the current node's status colour.

### Bug fixes

- Project nodes reserve height for a two-line title (#43) (fd9ef06)

### Docs

- V1.2.0 [skip ci] (9393784)

### Features

- Unique node titles within a domain (#41) (2f10b45)
- Centre-justify node titles (#42) (b8bc36d)
- The sputnik "here" mark takes the node's status colour (#44) (b98ab82)
- Click a task's status glyph to cycle it (#45) (4506a51)
- Clickable notepad note icon (#46) (123e31c)
- Flag nodes (double-click; atomic orbits in the node's colour) (#47) (99d0848)
- Show-only-flagged read-only view (#48) (6dd050d)

## [v1.2.0] - 2026-07-20

### Highlights

The per-task note editor is now a full-window split-pane panel instead of an 840px right-docked drawer, with a draggable splitter whose ratio persists across sessions and resets on double-click. A markdown formatting toolbar sits above the CodeMirror source pane, offering bold, italic, strikethrough, inline code, headings, links, lists, blockquotes, and code blocks with Mod-key shortcuts, alongside a persisted line-wrap toggle. Source tokens now follow the app's azure/navy palette, and preview headings are set in Boogaloo.

### Docs

- V1.1.0 [skip ci] (e5b88c0)

### Features

- Full-window note editor with split pane, formatting toolbar, and themed CodeMirror (#40) (2ce3377)

## [v1.1.0] - 2026-07-20

### Highlights

This release replaces the black-and-white placeholder brand mark with the actual PensaGrex app icon, a three-orbit atom over a tilted Googie task screen in the app's own palette, which is used to generate the platform icons at packaging time.

### Docs

- V1.0.2 [skip ci] (c0a7a51)

### Features

- Atomic-age app icon (#39) (69c3a43)

## [v1.0.2] - 2026-07-20

### Highlights

This is a maintenance release with no user-visible changes, removing an inert yauzl dependency override left over from the Electron 34 era that no longer applies under Electron 43's extraction path.

### Docs

- V1.0.1 [skip ci] (942e8da)

## [v1.0.1] - 2026-07-20

### Highlights

The macOS build is now signed with a Developer ID certificate and notarized, so the .dmg no longer trips Gatekeeper's "damaged" warning on download. Windows and Linux builds are unchanged and remain unsigned.

### Bug fixes

- Sign and notarize the macOS release (Gatekeeper "damaged") (#37) (a65734b)

### Docs

- V1.0.0 [skip ci] (20c9f61)

## [v1.0.0] - 2026-07-20

### Highlights

This initial release ships the PensaGrex desktop app: an Electron-based canvas that renders a forest of task trees in a subway-map layout, with per-node right-click editing (status, cursors, add, delete, rename), drag-and-drop to move, graft, nest, detach, and reorder nodes, collapsible project sub-trees, and reordering within a line. Notes are edited per task in a two-pane Markdown editor with live preview and KaTeX, project subtrees can be copied across domains or exported to a Markdown outline, and named bookmarks save a view (collapse set, zoom, and node-anchored camera) alongside the forest data. Forests are stored as JSON5 in a user-chosen library of domains with atomic writes, a domain switcher with create and trash-delete, an Open Source Licenses window, and mid-century Googie styling in light and dark grounds.

