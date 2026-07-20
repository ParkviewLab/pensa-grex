// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>

// Soft-hyphenation of node labels. A long single word (an id, a coined term like
// "Supercalifragilisticexpialidocious") has no space to wrap at, so in a
// fixed-width card it overflows. Inserting soft hyphens (U+00AD) at syllable
// boundaries gives the browser somewhere to break: the hyphens are invisible
// until a word actually wraps, at which point one shows as a real hyphen.
//
// The break points come from the Liang/TeX hyphenation algorithm (hypher, the
// engine) run over the standard American-English patterns (text/hyphen-en-us.js).
// This is a self-contained, offline computation, and it is deterministic across
// platforms, unlike the browser's own `hyphens: auto`, which Chromium supports
// unevenly by OS. Applied only to the drawn label, so the forest data keeps its
// clean titles; used by render/card.js for both measurement and render, so the
// two always agree. See docs/node-visual-system.md.

import Hypher from 'hypher'
import enUs from './hyphen-en-us.js'

const hyphenator = new Hypher(enUs)

// Return `text` with soft hyphens inserted at syllable boundaries. A word shorter
// than the pattern minimums is returned unchanged.
export function softHyphenate(text) {
  if (!text) return text
  return hyphenator.hyphenateText(String(text))
}
