# Changelog

All notable changes to this project are recorded here.

## [Unreleased]

## [v3.2.0] - 2026-07-26

### Highlights

Folding a project node now hides only what lies between it and its own close, leaving the trunk above intact, and the remaining pair is drawn shut with the close overlapping the project's card by 22 pixels, tinted in project violet, with the shadow retired and "Add task above", "Add branch above" and the merge submenu withheld until the scope is expanded. The terminus hull is rotated a half turn rather than mirrored horizontally, so a scope's two ends read as one shape and its point reflection. Two layout defects are fixed: a folded pair could be pried open by the repair pass and now stays shut, and the repair no longer inflates the drawing over passes that clear no conflicts, keeping the best placement it has seen instead of the last.

### Bug fixes

- Keep a folded pair shut, and stop the repair inflating the drawing (#73) (798951d)

### Features

- Turn the terminus hull through half a turn (#71) (aa9b57f)
- Fold a scope to its own pair, drawn shut (#72) (16d3ab9)

## [v3.1.0] - 2026-07-26

### Highlights

Domain trees are now drawn by a pixel solve rather than a row grid: every lateral leaves its spine at exactly twelve degrees, each pair of cards packs by its own heights, and where one line crosses another the crossed line runs unbroken while the other breaks with a short cap on each side in place of the old hop. A rendering bug is also fixed where toggling "Show only flagged" could leave revealed cards with a label but no hull or background until the next repaint, and the changelog no longer carries a spurious "docs" entry for the previous release's own closing commit. The section 15 documentation is corrected to note that the v3 bookmark shape is only half shipped, so migrated bookmarks still report their location as gone.

### Bug fixes

- Keep a hidden card's silhouette instead of painting a zero box (d8f9d8e)

### Docs

- Say plainly that the v3 bookmark shape is only half shipped (baab775)

### Features

- The twelve-degree lateral, and node positions in pixels (#70) (d5484c4)

## [v3.0.0] - 2026-07-26

### Highlights

This release replaces the tree-of-forks model with a plan-of-projects model in which every branch rejoins the trunk it left, and every scope is closed by a terminus node drawn as an inverted project hull. The on-disk layout changes accordingly: each domain is now a directory of plain JSON under a domains/ root, with notes in their own subdirectory and ids that are chronologically sortable, and a one-shot startup migration moves an existing schema-2 library across, fabricating a merge point for each branch. The MCP tool surface is renamed to match (create_plan, paste_as_plan, detach_to_plan, reorder_plan) and gains open_branch, wrap_run, unwrap_project, and set_merge_point, while add_task loses its mode and now always names an edge; the menu's "New tree" and "Paste as new tree" become "New plan" and "Paste as new plan", and the drawing retires the 12-degree tilt and per-line lift in favour of row-aligned cards with lateral runs that hop verticals.

### Docs

- V2.1.0 [skip ci] (8da2835)
- Add rust_port_ideas notebook (off-Electron / 100% Rust study) (#60) (ad08485)
- Add Migration and repo strategy to rust_port_ideas (#61) (6aeecc9)
- Record the model v3 design (domains, termini, merging branches) (#62) (1784403)
- Amend the northstar to model v3 (single entry, every fork returns) (#63) (8b17e9b)

### Features

- The domain library on disk, and the id scheme (#65) (c6519e3)
- The schema-3 record, and the migration that brings a library across (#66) (ae438ff)
- Termini close every scope, and the verbs that open and shut them (#67) (4b3cb80)
- Every branch rejoins the trunk it left, and the drawing that shows it (#68) (d4bcdf5)
- The tool surface and the outline in the vocabulary of model v3 (#69) (af050b8)

### Refactor

- Name the record and the model, and drop the forest (#64) (0c7a856)

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

