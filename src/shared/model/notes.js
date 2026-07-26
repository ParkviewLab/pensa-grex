// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// What a node's note file is called. Shared, because three places mint the name:
// the note editor on a first save, the paste mutation, and the MCP set_note tool.
//
// The name is the node's id plus a short slug of its title, inside the domain's
// `notes/` directory: `n_mrtwgppt03_draft-jd.md`. The id is what resolves (the
// node's `note` field holds the whole filename), and the slug is decorative: it
// makes a directory listing readable and a git diff legible. It is not kept in
// step with a retitle, so a slug may be stale; nothing reads it.

const SLUG_CHARS = 12

// The slug rules match the domain directory's (see main/pathsafe.js): lowercase
// alphanumerics, single hyphens between runs, no trailing hyphen. Kept here
// rather than imported because the renderer must not reach into src/main.
export function noteSlug(title) {
  if (typeof title !== 'string') return ''
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_CHARS)
    .replace(/-+$/, '')
}

// A title that yields no slug (only punctuation, only emoji) gives a bare
// `<id>.md`, which is still unique and still resolves.
export function noteFileName(nodeId, title) {
  const slug = noteSlug(title)
  return slug ? `${nodeId}_${slug}.md` : `${nodeId}.md`
}
