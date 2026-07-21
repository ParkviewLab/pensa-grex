# Changelog

All notable changes to this project are recorded here.

## [Unreleased]

## [v2.1.0] - 2026-07-21

### Highlights

This release adds a themed GitHub Pages download page at parkviewlab.github.io/pensa-grex, with self-updating links to the latest release installers and a Light/Dark toggle, plus a Connect Claude Code walkthrough covering the `claude mcp add` registration step. On the MCP side, the server now instructs connected clients that the task store is live and reads may be stale, telling them to re-read before acting and especially before writes; `find_flagged`, `set_status`, `delete_task`, and `delete_domain` carry matching cautions, and a new `work_flagged` prompt bakes the re-read-first order into the flagged-task workflow.

### Docs

- V2.0.0 [skip ci] (7e385d6)
- Add a themed GitHub Pages download page (#57) (25d42cf)
- Add Connect Claude Code section to the download page (#59) (b3acc27)

### Features

- Tell MCP clients not to trust stale reads (#58) (b85c59a)

## [v2.0.0] - 2026-07-21

### Highlights

The app now hosts an MCP server on loopback (127.0.0.1:35899, enabled by default, toggleable from a header status indicator that shows the endpoint URL), letting a local agent read and write tasks through the same authority the GUI uses, across read-only, read-write, and destructive scope tiers. When an agent edits the open domain, the view re-renders in place while preserving pan, zoom, and collapse, and the note editor reconciles external changes by reloading when clean, warning when dirty, and closing with a notice if the underlying task is deleted. Under the hood, task writes are now owned by the main process on a single write path, and a single-instance lock ensures one process binds the port.

### Docs

- V1.3.2 [skip ci] (4eb9028)
- Capture the in-app MCP server design (mcp_ideas.md) (#53) (d6f8571)

### Features

- In-app MCP server (#55) (3feefab)
- Live view updates and note-editor reconciliation (#56) (1185e47)

### Refactor

- Invert task authority into the main process (#54) (12b382c)

## [v1.3.2] - 2026-07-20

### Highlights

Node title uniqueness is now enforced when tasks, forks, and trees are created, not just when they are renamed or pasted, so a duplicate name typed while adding a node will be de-duplicated automatically.

### Bug fixes

- Enforce unique node titles on creation, not only rename/paste (#52) (cbcd253)

### Docs

- V1.3.1 [skip ci] (c93aa86)

## [v1.3.1] - 2026-07-20

### Highlights

The note view gains A-/A+ buttons in its header that step the view pane's text size between 12 and 28px and persist the choice per editor, alongside the existing split-ratio and wrap preferences. The flagged-node orbit rings are now drawn with a thicker stroke so they read clearly behind the card, and the "here" sputnik mark reverts to ink colour and is 15% larger for better contrast against both azure and navy backgrounds.

### Bug fixes

- Revert the here mark to ink and enlarge it 15% (#49) (eafea05)
- Thicken the flagged orbit rings, keep them behind the node (#50) (58f4c59)

### Docs

- V1.3.0 [skip ci] (ff06b3b)

### Features

- A persisted font-size control for the note view (#51) (9227c56)

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

