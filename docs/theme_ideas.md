<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# Theme direction (held for the theming stage)

Captured so the direction is written down, not to act on yet. The visual
theme is a **separate decision from the tree grammar** (see
[`tree-grammars.html`](tree-grammars.html)); this file records the intended
skin. It is a notebook, not a spec.

## The direction

**Googie / Atomic Age / Mid-Century Modern (Populuxe)** — the optimistic
retro-futurism of roughly 1955 to 1965: space-age, atomic, jet-age. Gary
supplied a set of reference images in the design conversation (starburst wall
art, a retro-futurist rocket-city illustration, "Atomic Style" and "Midcentury
Modern" shape packs, Jetsons-style architecture, boomerang-and-blob patterns).
The images themselves are not committed as files; if we want them in-repo, drop
them into `docs/images/` and this file can reference them.

## Palette (observed across the references)

Warm, saturated but slightly aged (print-era), on a light ground:

- Ground: cream / ivory / warm beige (roughly `#f4ede0`).
- Teal / turquoise (the recurring anchor colour).
- Burnt orange / coral.
- Mustard / goldenrod.
- Olive / avocado green.
- Linework and text: dark brown / near-charcoal, not pure black.
- Occasional sky-blue for atmosphere.

The northstar-style discipline of three colours per document does not bind an
app skin, but the palette above wants **one ground + one anchor (teal) + two or
three warm accents**, used consistently.

## Motifs

- Eight-point **starbursts** and **sputnik atoms** (spokes with ball tips).
- **Atomic orbits**: thin ellipses with electron dots.
- **Boomerang / parabola** shapes.
- **Amoeba / kidney / blob** shapes.
- Elongated **diamonds** and **parallelograms**, thin tapered "atomic" legs.
- Calligraphic swooshes; subtle paper-grain texture.

## Typography

- A period **display face** for the app title / About only (the bold retro
  lettering seen in the "Atomic Style" / "Midcentury Modern" samples).
- A clean, legible **sans for the UI body** — the interface stays readable;
  the retro character lives in ornament and colour, not in the working text.

## How it could map onto PensaGrex (sketch, not decided)

- The **fork point** as a starburst or atom hub.
- The **branch cursor** as a sputnik / atomic marker (it must read
  unmistakably; colour alone is not enough, per the B&W cursor lesson).
- **Status** encoded in period colour, within the palette above.
- **Connectors** as thin mid-century linework.

## Not yet

Do not implement the theme until the tree grammar is chosen and the data model
is settled. Skin comes last, over a structure that already works.
