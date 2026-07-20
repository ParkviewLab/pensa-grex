# Changelog

All notable changes to this project are recorded here.

## [Unreleased]

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

