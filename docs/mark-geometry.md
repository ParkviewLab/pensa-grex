<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->

# PensaGrex mark geometry: a renderer-neutral drawing specification

This document specifies the geometry of every mark PensaGrex draws on the map, in a
form complete enough that another implementation, in any language and against any 2D
drawing API, can reproduce them without reading the renderer source. It is the
reproducible companion to [`node-visual-system.md`](node-visual-system.md), which
states the shape grammar, the kind-and-state assignment policy, and the meaning of
the two hues in prose; where that document says what a mark is and why, this one
says exactly how it is constructed, with the formulas, the constants, and a
worked instance for each. The immediate motive is the Rust port
([`rust_port_ideas.md`](rust_port_ideas.md)), whose Design B rebuilds the renderer on
`egui::Painter`; the final section translates every construction here into that
toolkit. The body before it is renderer-neutral and commits to no drawing API.

The specification is authoritative for geometry, not for policy. When a number here
and a number in the running code disagree, the code wins and this document is wrong;
each mark names the source function so the two can be checked against each other.

## Scope

This covers the mark vocabulary: the vector marks a card, a track, a junction, a
decorator, or a marker draws. It is the complete inventory of what appears on the
canvas, given positions.

It does not cover the layout engine, which decides where the marks go: the row
layering, the branch routing, the junction placement, the folding of collapsed
scopes, and the pan-and-zoom camera. Those live in `layout.js`, `geometry.js`, and
`gapZones.js`, and are a separate specification. A reader who implements everything
here can draw every mark faithfully but will still need the layout specification to
assemble them into a correct map. Where a mark's construction refers to a position
(a station anchor, a junction centre, a track's point list), treat that position as
an input supplied by the layout, not as something this document derives.

## How to read this document

Each mark is given in four registers, and they are redundant on purpose, because
they carry different things and fail differently.

The construction is the authoritative register: the sequence of path operations
written as functions of the card box `(w, h)` and a set of named constants. It is
the general rule, and it is the only register that is lossless; a formula fixes a
curve that a sentence or a picture cannot. The constants used are listed with each
mark and gathered again in the constants appendix. A golden-master instance follows,
the construction evaluated at a stated `(w, h)` down to concrete numbers and shown as
literal SVG path data; its role is verification, letting an implementer diff a render
against a known-correct instance without the repository. The prose around each is
connective, stating intent and the occasional caveat. The HTML sibling of this file
renders each mark from the same path data, so the picture a reader sees is the
specification executing, not an illustration of it.

## Foundations

### The coordinate frame and the card box

Coordinates are in CSS pixels. The origin is top-left; x grows rightward and y grows
downward, so a smaller y is higher on the screen. Angles, where they appear, are in
degrees measured clockwise from the positive x-axis, because that is the convention
the source uses and because y grows downward.

Every card silhouette is a function of its box, the pair `(w, h)`. The width is fixed:
a card is 188 pixels wide, and because the stylesheet sets `box-sizing: border-box`,
that 188 is the whole box including padding, so `w = 188` for every card without
exception. The height varies with the card's content (the label's line count, the
status tag, the HERE pill) and is measured, not computed here; a silhouette is drawn
to whatever `h` the card measured. The worked instances below state the `h` they use.

### The outline is a gap between two fills

A card has no stroked border. Its outline is the visible band between two filled
paths: an outer silhouette in the node's colour, and an inner silhouette in the panel
colour laid over it. The inner path is the same path as the outer, transformed by a
translate-and-scale that insets it by a different amount on each of the four edges.
Where the inset is small the colour band is thin; where it is large the band is
thick. That per-edge asymmetry, a thin top over a heavy bottom, one side steeper than
the other, is the Googie character; a uniform stroke would read as flat and modern
instead. Because the inner is a scaled copy of the outer, the outline follows any
silhouette, straight-edged or curved, without a second hand-drawn path. The inset
amounts are the `BORDERS` four-tuples, one per shape, and the transform that applies
them is derived in the silhouette section.

### Path notation

Constructions are written in SVG path grammar, which every 2D API can consume or
imitate: `M x,y` moves to a point, `L x,y` draws a line to a point, `Q cx,cy x,y`
draws a quadratic Bezier through control point `(cx, cy)` to `(x, y)`, and `Z` closes
the path back to the last `M`. Quadratics have a single control point; there are no
cubics in the mark vocabulary. A construction gives each coordinate as an expression
in `w`, `h`, and the named constants; the golden master gives the same path with the
expressions evaluated.

### Colour

Every fill and stroke is a role token, not a literal colour, and the token resolves
to one of two values depending on the ground (azure, the light default, or navy, the
dark). Two hues carry meaning: teal marks the structure of a plan (a project node and
its close), and violet marks a task that is done. The complete token-to-hex table for
both grounds is the colour appendix; the marks below name tokens.

## The marks

### 1. The ground

The canvas is not blank. It carries a dot grid: one dot at every 40-pixel lattice
point, each dot a small filled circle in the `--grid` token, which is a low-alpha ink
(about 10 percent on azure, 13 percent on navy). In the source the grid is a CSS
`radial-gradient` tile 40 by 40 pixels, the dot reaching full `--grid` at radius 1px
and falling to transparent by 1.4px. Reproduced directly, it is either a repeating
texture of that tile or, in an immediate-mode renderer, a loop drawing a filled
circle of radius about 1.2px at every `(40i, 40j)` within the visible rectangle, in
`--grid`.

### 2. The station dot

Where a card attaches to its line, the line carries a station dot: a filled circle
of diameter 11 pixels (radius 5.5) in the `--line` token, centred on the station
anchor the layout supplies. It is the subway-map station mark, and it is the same
size as a status glyph so the two read as one family.

```
circle  centre = (anchor.x, anchor.y)  r = 5.5  fill = --line
```

### 3. The card silhouettes

Four silhouettes exist. Each is built by `buildShape(shape, w, h)`, which returns the
outer path and the `innerT` transform for the inner. The outer path per shape is
given first; the shared inner-path mechanism follows.

The margin `m = 1.5` is common to all four: every silhouette is inset 1.5 pixels
inside the card box. Define `x0 = m`, `x1 = w - m`, `y0 = m`, `y1 = h - m`, and the
centres `cx = (x0 + x1) / 2`, `cy = (y0 + y1) / 2`.

#### 3.1 screen (a plain task)

A rounded rectangle, the quiet default. The corner radius is
`R = min(14, (h - 2m)/2, (w - 2m)/2)`, so a short card rounds less than a tall one but
never more than 14.

```
R = min(14, (h-2m)/2, (w-2m)/2)
M x0+R,y0  L x1-R,y0  Q x1,y0 x1,y0+R  L x1,y1-R  Q x1,y1 x1-R,y1
L x0+R,y1  Q x0,y1 x0,y1-R  L x0,y0+R  Q x0,y0 x0+R,y0  Z
```

Golden master, `w = 188`, `h = 56` (so `R = 14`):

```svg
<path d="M15.5,1.5L172.5,1.5Q186.5,1.5 186.5,15.5L186.5,40.5Q186.5,54.5 172.5,54.5L15.5,54.5Q1.5,54.5 1.5,40.5L1.5,15.5Q1.5,1.5 15.5,1.5Z"/>
```

#### 3.2 marquee (a task carrying the "here" cursor)

A concave cushion: the four corners sit at the box corners, and each of the four edges
bows inward. The top and bottom bow by 0.14 of the height; the left and right bow by
0.05 of the width.

```
M x0,y0  Q cx,(y0+0.14h) x1,y0  Q (x1-0.05w),cy x1,y1
         Q cx,(y1-0.14h) x0,y1  Q (x0+0.05w),cy x0,y0  Z
```

Golden master, `w = 188`, `h = 72`:

```svg
<path d="M1.5,1.5 Q94,11.6 186.5,1.5 Q177.1,36 186.5,70.5 Q94,60.4 1.5,70.5 Q10.9,36 1.5,1.5 Z"/>
```

#### 3.3 hull (a project node, and its terminus)

A wide, slightly concave top over inward-tapering sides and a convex bottom; it reads
as a base something grows from, which is what a project root is. The sides taper
inward by `inset = 0.13w`. The top and bottom curves are scaled not by the full
height but by a capped height `ch = min(h, 58)`: past 58 pixels the curve stops
growing, so a tall multi-line project card does not let its top curve descend into its
own centred label.

```
inset = 0.13w
ch    = min(h, 58)
M x0,(y0+0.10*ch)  Q cx,(y0+0.22*ch) x1,y0
L (x1-inset),(y1-0.05*ch)
Q cx,y1 (x0+inset),(y1-0.05*ch)  Z
```

Golden master, `w = 188`, `h = 58` (so `ch = 58`):

```svg
<path d="M1.5,7.3 Q94,14.3 186.5,1.5 L162.1,53.6 Q94,56.5 25.9,53.6 Z"/>
```

The top edge's lowest point, as a fraction of `ch`, is a fixed 0.1424 (`HULL_DIP`),
the extremum of a quadratic from 0.10 through control 0.22 to 0; it is computed from
those two fractions rather than written down, so it cannot drift from the path. The
capped curve makes the dip a constant 8.3 pixels on the outer path at any card height,
which is why a folded pair needs a constant overlap to shut its seam.

#### 3.4 keystone (unassigned)

A rounded, asymmetric quadrilateral, kept in the registry but currently unassigned to
any node state; it is held for a future use and drawn by nothing today. It is built by
rounding the corners of four points at
`(x0+0.05w, y0+0.12h)`, `(x1, y0)`, `(x1-0.12w, y1)`, `(x0+0.20w, y1-0.06h)` to a
radius `min(11, 0.22h)`.

```
P = [ (x0+0.05w, y0+0.12h), (x1, y0), (x1-0.12w, y1), (x0+0.20w, y1-0.06h) ]
roundPoly(P, min(11, 0.22h))
```

`roundPoly` walks the polygon and replaces each sharp corner with a quadratic: at
each vertex it steps back toward the previous vertex and forward toward the next, each
by the radius (clamped to half the shorter adjacent edge), and draws a `Q` through the
vertex between those two points. Golden master, `w = 188`, `h = 56`:

```svg
<path d="M16.94,17.41Q10.90,8.22 21.89,7.80L175.51,1.92Q186.50,1.50 182.19,11.62L168.25,44.38Q163.94,54.50 152.94,54.20L50.10,51.44Q39.10,51.14 33.06,41.95Z"/>
```

#### 3.5 the inner path and the variable-weight outline

The inner path is the outer path under an affine transform `innerT` that insets it by
the shape's four `BORDERS` values `(t, r, b, l)` (top, right, bottom, left). With each
value first clamped to at most `w/2 - 4` or `h/2 - 4` on its axis, the transform is:

```
sx = (w - l - r) / w
sy = (h - t - b) / h
innerT = translate(l, t) scale(sx, sy)
```

Applied to the outer `d`, this yields the inner silhouette; the outer is filled in the
node colour and the inner in the panel colour, and the uncovered band between them is
the outline. The `BORDERS` four-tuples are:

| shape | top | right | bottom | left |
| --- | --- | --- | --- | --- |
| screen | 3.5 | 8 | 3.5 | 7 |
| marquee | 6 | 8 | 4 | 5 |
| hull | 4 | 5 | 8 | 8 |
| keystone | 3 | 5 | 9 | 7 |

Worked `innerT` for each golden master above: screen `translate(7, 3.5) scale(0.9202, 0.8750)`;
marquee `translate(5, 6) scale(0.9309, 0.8611)`; hull `translate(8, 4) scale(0.9309, 0.7931)`;
keystone `translate(7, 3) scale(0.9362, 0.7857)`.

#### 3.6 the terminus (a scope's close)

A terminus, the node that closes a scope, wears the same hull, sized to an empty
project card, turned through a half turn: mirrored about both of the card's axes. The
half turn is the transform `translate(w, h) scale(-1, -1)`, prepended to both the
outer and the inner path (so the inner is `translate(w, h) scale(-1, -1)` then
`innerT`). Mirroring about both axes, rather than only top-to-bottom, is what makes
the pair read as one shape and its reflection: the hull's top edge rises from left to
right, and after a half turn the close's bottom edge rises from left to right too, so
the two edges bow oppositely and, when a folded pair is drawn touching, meet twice and
enclose a lens. Golden master flip for a `188 by 58` close:

```
transform = translate(188 58) scale(-1 -1)
```

### 4. The status glyphs

A task card carries a small round glyph beside its label, 11 pixels in diameter
(radius 5.5), showing its status; a project card carries the same-sized glyph in the
scope teal. All five are the same circle, differing only in fill and stroke:

| glyph | status | fill | stroke |
| --- | --- | --- | --- |
| done | completed | `--c-done` (violet) | none |
| prog | in-progress | `--c-prog` | none |
| todo | to do | none | 2px solid `--c-todo` |
| cancel | cancelled | none | 1.5px dashed `--c-cancel` |
| project | (a project node) | `--c-project` (teal) | none |

```
circle  r = 5.5   (filled variants: fill token, no stroke)
                  (ring variants: no fill, stroke token at the stated width)
```

The cancel ring is dashed; the todo ring is solid and heavier (2px against the
dashed ring's 1.5). A cancelled task additionally strikes its label through and greys
it, which is a text property, not a mark.

### 5. The orbits decorator

Any flagged node wears the orbits: three heavy, off-axis elliptical rings centred on
the card, each carrying one solid electron ball set back from apogee, all in the
node's own colour (its status colour for a task, the scope teal for a project).
The rings are off-axis and irregular on purpose; rings at 0, 90, and 180 degrees would
read as a tidy modern diagram rather than atomic-age. Each ring is an ellipse of
semi-axes `(rx, ry)` rotated by `ang` degrees about the card centre, stroked at width
2.4 with 0.7 opacity; its ball is a filled circle of radius 4 at parameter `t` degrees
along the unrotated ellipse, then carried through the same rotation. A core ball of
radius 4 sits at the centre.

```
for each (rx, ry, ang, t) in O:
    ellipse  centre=(cx,cy)  semi-axes=(rx,ry)  rotate ang about (cx,cy)
             stroke=colour  stroke-width=2.4  stroke-opacity=0.7  fill=none
    lx = rx*cos(t°);  ly = ry*sin(t°)
    ball at (cx + lx*cos(ang°) - ly*sin(ang°),  cy + lx*sin(ang°) + ly*cos(ang°))
             r=4  fill=colour
core ball at (cx, cy)  r=4  fill=colour
O = [ (72,12,-30,-38), (66,13,40,215), (68,11,103,-38) ]
```

The three ball offsets from the card centre, evaluated: `(45.4, -34.8)`,
`(-36.6, -40.5)`, `(-5.5, 53.7)`. The decorator is drawn behind the card so its rings
overflow the card box.

### 6. The cursor mark (the Atomic Starburst)

The branch cursor is marked, beside the marquee card, by a sputnik: solid rays of
irregular length at irregular angles, each tipped with a ball, around a solid centre.
Its colour is `--ink` (near-black on azure, near-white on navy). The symbol is defined
at a base ray length of 15; the cursor draws it at 1.15 times that. Ten rays are drawn,
each a line from the centre to a tip, with a ball of radius 2.2 at the tip; a core ball
of radius 2.8 sits at the centre.

```
base = 15
for each (deg, f) in rays:
    tip = (base*f*cos(deg°), base*f*sin(deg°))
    line from (0,0) to tip   stroke-width=1.4  round cap
    ball at tip   r=2.2   fill=--ink   (no stroke)
core ball at (0,0)  r=2.8  fill=--ink
rays = [ (-6,1.0),(30,0.66),(63,1.12),(99,0.58),(138,0.9),
         (177,1.2),(210,0.68),(246,1.02),(285,0.82),(318,1.08) ]
cursor draws the whole symbol scaled by 1.15 about its centre
```

The ten tips, evaluated at base scale: `(14.9,-1.6)`, `(8.6,4.9)`, `(7.6,15)`,
`(-1.4,8.6)`, `(-10,9)`, `(-18,0.9)`, `(-8.8,-5.1)`, `(-6.2,-14)`, `(3.2,-11.9)`,
`(12,-10.8)`. A second symbol, the four-plus-spoke starburst (the "burst" atmosphere
mark), is defined in the source but is not currently mounted in the scene; it is noted
here for completeness and specified in the constants appendix.

### 7. The tracks

A track is a polyline through a point list the layout supplies, drawn as an
`M x,y L x,y ...` path with no fill, a round cap, and a round join, in the `--line`
token. Three kinds differ only in stroke width:

| kind | role | stroke width |
| --- | --- | --- |
| riser | the vertical spine between stacked nodes on a line | 3 |
| branch | a fork connector leaving a node | 2.3 |
| return | a branch rejoining its trunk | 2.3 |

(The base `.track` width is 2.5; riser overrides to 3 and the two lateral kinds to
2.3, so the spine reads slightly heavier than the branches.)

```
path = "M" + points[0] + " L" + points[1] + " L" + ...   (no Z)
fill = none   stroke = --line   linecap = round   linejoin = round
```

### 8. The underpass

Where one lateral track crosses another, the crossed line runs on unbroken and the
crossing lateral yields: it is cut so a gap opens where it passes behind, and each cut
end carries a short cap lying parallel to the line it passes under, so the cap reads as
a slice of what runs on rather than as a line that simply stops. The whole
construction is renderer-neutral geometry; its one implementation subtlety (that the
cut must be parallel to the crossed line, not square to the lateral) is discussed in
the egui translation section, because a naive stroke cannot express it.

The gap is specified by the air wanted across the crossed line, `perpClear = 3` plus
the crossed line's half-width (`CROSSED_HALF`: riser 1.5, return 1.15). For a crossing
whose angle between the two lines has sine `s`, the cut ends sit back along the
lateral by `half = min(breakMax, across / s)`, where `across = perpClear + crossedHalf`
and `breakMax = 12` caps a nearly parallel crossing (there the air is given up rather
than the line). The strip that removes the ink is a rectangle centred on the crossed
line, `stripLength = 30` long along that line and `2*half*s` wide across it. Each cut
end carries a cap of length `capLength = 9.2`, centred at the cut and oriented along
the crossed line, stroked at width 1.6 in `--line`.

```
across = perpClear + crossedHalf(over)          # over ∈ {riser, return}
s      = |sin(angle between lateral and crossed line)|
half   = (s < ε) ? breakMax : min(breakMax, across / s)
# cut strip: rectangle centred on the crossing point,
#   stripLength/2 either way ALONG the crossed line's unit vector,
#   half*s either way ACROSS it
# two caps: at ±half along the lateral from the crossing point,
#   each a segment of length capLength parallel to the crossed line
TUNE = { perpClear:3, breakMax:12, capLength:9.2, stripLength:30 }
CROSSED_HALF = { riser:1.5, return:1.15 }
```

### 9. The junction diamond

A fork or merge junction is marked by a small diamond centred on the junction point:
an 8-pixel square rotated 45 degrees, filled in `--line`, turning to `--ink` on hover.
A single-branch junction is also a drag handle, so it carries a transparent circular
hit halo of radius 13 centred on the same point (8 pixels of ink is no target for a
pointer); a junction shared by several branches carries no halo and is driven by its
menu instead.

```
diamond: square  centre=(cx,cy)  side=8  rotate 45° about (cx,cy)  fill=--line
halo (single-branch only): circle  centre=(cx,cy)  r=13  fill=transparent
```

### 10. The note glyph

A card with a note shows a small memo-pad glyph in its bottom-right corner, on a 16 by
16 viewbox, stroked in `--muted` (turning to `--ink` on hover): a rounded body
rectangle, two spiral-ring ticks over the top edge, and three ruled lines, the last
shorter.

```
viewBox 0 0 16 16
body:  rect  x=3 y=3 w=10 h=11 rx=1.5   (no fill, stroke 1.2)
rings: line (6,1.5)->(6,4.5);  line (10,1.5)->(10,4.5)   (stroke 1.2, round cap)
rules: line (5.5,7.5)->(10.5,7.5);  line (5.5,10)->(10.5,10);  line (5.5,12.5)->(8.5,12.5)   (stroke 1.0, round cap)
```

## Constants (the parts list)

Every number the marks use, gathered so an implementer need not read the source.

```
Card box:        width 188 (fixed, border-box);  height measured
Card metrics:    task padding 11 (top/bottom) / 16 (left/right);
                 project padding 16 all round, min-height 58; collapsed project padding-top 24;
                 terminus min-height 58; inter-element gap 3; glyph-to-label gap 7;
                 cursor card padding-left/right 24
Silhouette:      margin m = 1.5
  screen:        corner radius R = min(14, (h-2m)/2, (w-2m)/2)
  marquee:       top/bottom bow 0.14h; left/right bow 0.05w
  hull:          side inset 0.13w; top start 0.10*ch, control 0.22*ch; bottom 0.05*ch;
                 ch = min(h, 58); HULL_DIP = 0.1424 (derived)
  keystone:      points at (0.05w,0.12h),(1,0),(1-0.12w,1),(0.20w,1-0.06h) of the inset box;
                 corner radius min(11, 0.22h)
BORDERS (t,r,b,l):  screen (3.5,8,3.5,7)  marquee (6,8,4,5)  hull (4,5,8,8)  keystone (3,5,9,7)
                    (each clamped to w/2-4 or h/2-4 on its axis)
Glyph:           diameter 11 (r 5.5);  todo ring 2px solid;  cancel ring 1.5px dashed
Station dot:     diameter 11 (r 5.5), fill --line
Orbits:          O = [(72,12,-30,-38),(66,13,40,215),(68,11,103,-38)];
                 ring stroke 2.4, opacity 0.7; ball r 4; core r 4
Sputnik:         base 15; rays (deg,factor) =
                   (-6,1.0)(30,0.66)(63,1.12)(99,0.58)(138,0.9)(177,1.2)(210,0.68)(246,1.02)(285,0.82)(318,1.08);
                 ray stroke 1.4 round cap; ball r 2.2; core r 2.8; cursor scale 1.15
Burst (defined, unmounted):  spokes at 0/90/±45 full length 26/18, plus half spokes at 22.5/67.5/112.5/157.5;
                 stroke 1.4; opacity 0.13; colours --burst-a (default) / --burst-b (variant .b)
Tracks:          base 2.5; riser 3; branch 2.3; return 2.3; round cap and join; colour --line
Underpass:       TUNE perpClear 3, breakMax 12, capLength 9.2, stripLength 30;
                 CROSSED_HALF riser 1.5, return 1.15; cap stroke 1.6
Junction:        diamond side 8, rotate 45; halo r 13
Note glyph:      viewBox 16; body rect (3,3,10,11) rx 1.5 stroke 1.2; rings stroke 1.2; rules stroke 1.0
Ground:          dot lattice pitch 40; dot radius ~1.2 (full --grid at 1px, transparent by 1.4px)
```

## Colours (two grounds)

Each token by role, and where relevant by hue, for both grounds. Values from
`style.css`.

| token | role | azure | navy |
| --- | --- | --- | --- |
| `--ground` | canvas | `#d3e6ef` | `#0f2334` |
| `--panel` | card panel (task) | `#f8f3e8` | `#1a3a54` |
| `--ink` | text, cursor mark | `#173242` | `#e8f1f6` |
| `--line` | tracks, dots, diamonds | `#365b6c` | `#6fb6c9` |
| `--muted` | tags, note glyph | `#5f7d8b` | `#93b3c2` |
| `--grid` | ground dots | `rgba(23,50,66,.10)` | `rgba(111,182,201,.13)` |
| `--c-todo` | to-do glyph and screen | `#d9a53a` | `#f0bd55` |
| `--c-prog` | in-progress | `#d75f2e` | `#f27a44` |
| `--c-done` | done (= `--accent-violet`) | `#7d54a6` | `#bd93e6` |
| `--c-cancel` | cancelled | `#8aa0ab` | `#7590a0` |
| `--c-project` | project hull (= `--accent-teal`) | `#1f8f8a` | `#37c2ba` |
| `--c-project-tint` | project/close panel | `#cbe6e4` | `#356e69` |
| `--cursor` | HERE pill, drop hints | `#d75f2e` | `#f27a44` |
| `--burst-a` | atmosphere burst | `#1f8f8a` | `#37c2ba` |
| `--burst-b` | atmosphere burst (variant) | `#d9a53a` | `#f0bd55` |

The hue tokens `--accent-teal` and `--accent-violet` hold the same two values and are
used, outside the map, by surfaces that want a particular colour rather than a
particular meaning (a note link, the MCP status dot, the editor's syntax colours);
those do not move if the role-to-hue assignment is ever exchanged.

## Assignment: kind and state to shape and colour

Which mark is drawn for which node, transcribed from `renderCard` and
`node-visual-system.md`. Policy, not geometry; changeable independently of the shapes.

| node | shape | fill (outer) | panel (inner) | extras |
| --- | --- | --- | --- | --- |
| task | screen | its status colour | `--panel` | status glyph; status tag |
| task, marked "here" | marquee | its status colour | `--panel` | sputnik beside it; HERE pill |
| project node | hull | `--c-project` (teal) | `--c-project-tint` | project glyph; centred label |
| terminus (scope close) | hull, half-turned | `--c-project` (teal) | `--c-project-tint` | no label, glyph, or tag |
| any flagged node | (its shape) | (unchanged) | (unchanged) | orbits behind, in the node's colour |
| collapsed project | hull | `--c-project` | `--c-project-tint` | close drawn shut on its card; extra top padding |

A project node shows no status glyph and no tag and can never be the cursor, so the
teal and the hull read unambiguously as a project rather than a task. The orbits mark
the flagged state alone and compose with any shape.

## egui translation contract

This is the only renderer-specific section. It states how each construction above maps
onto `egui::Painter`, `epaint`, and `lyon`; the argument for choosing egui, and the
alternatives, are in [`rust_port_ideas.md`](rust_port_ideas.md) and not repeated here.

Quadratic Beziers have no native primitive in epaint, so each `Q` is flattened to a
short polyline by sampling the curve at a handful of `t` values (16 subdivisions is
ample at card scale) and emitting line segments; the sampled points join the straight
segments to form one point list per silhouette. Do the flattening in world
coordinates before any camera transform, so the subdivision density is chosen once at
model scale.

The variable-weight outline is two fills, never a stroke. Build the outer point list,
fill it in the node colour; apply the `innerT` affine to the same point list, fill the
result in the panel colour over the first. Do not attempt to stroke the silhouette;
the whole point of the two-fill construction is a per-edge-variable band that a
constant-width stroke cannot produce.

Concave fills need tessellation. epaint fills only convex polygons, and two
silhouettes are concave by design: the hull (its top edge bows inward) and the marquee
(all four edges bow inward). Filling their point lists with `PathShape::convex_polygon`
will produce artifacts. Instead tessellate the flattened point list with `lyon` and
hand the resulting triangles to `Shape::Mesh`. The screen (convex) and the glyphs and
dots (circles) do not need this; a single "fill this closed point list" helper that
routes concave shapes through lyon and convex ones through the fast path keeps the call
sites uniform.

Transforms are applied to points, not to a canvas state. SVG `rotate` and `scale` (the
terminus half turn, the junction diamond's 45-degree turn, the sputnik's 1.15 scale,
the orbit ring rotations) become affine operations composed and applied to the point
list before flattening and tessellation; there is no retained transform stack to push
and pop.

Strokes map to an `epaint::Stroke` with the tabulated width and colour, and round caps
and joins are epaint defaults for a path stroke; the tracks, the glyph rings, the orbit
ellipses (themselves flattened to polylines), the sputnik rays, and the note glyph are
all strokes.

The underpass is the one construction with no direct analogue, because egui clips only
to an axis-aligned rectangle (`with_clip_rect`) and the source cuts its gap with an
even-odd path clip. Do not clip and do not overdraw the gap in the ground colour (that
would erase the dot grid). Instead stop stroking the lateral at the gap and emit the
crossing segment as an explicit ribbon: a quadrilateral of the lateral's own width
whose two end edges are mitred parallel to the crossed line, the mitre angle and the
setback coming from the `breakSize` computation unchanged. Since laterals are straight
runs of constant width, each crossing is one quad, and the caps fall out of the same
geometry.

Text is drawn from a glyph atlas, so it is sampled rather than re-tessellated per
frame; drive zoom through world coordinates and font size rather than through a layer
transform, or labels blur at high zoom while the vector marks stay crisp. Card
measurement, which the layout needs, is `Fonts::layout_job` returning a galley with
exact dimensions, replacing the off-screen DOM measurement; note that epaint's line
breaker does not honour the U+00AD soft hyphen the labels carry, so soft-hyphen
wrapping is custom work.

## Sources

Each fact traces to one of: `src/renderer/src/render/shapes.js` (the silhouettes, the
two-fill outline, the orbits, the assignment in `renderCard`);
`src/renderer/src/render/tracks.js` (the sputnik and burst symbols, the tracks, the
underpass, the junction diamond and halo, the cursor mark);
`src/renderer/src/render/card.js` (the note glyph, the card assembly);
`src/renderer/src/render/scene.js` (the full set of mounted marks);
`src/renderer/src/style.css` (the glyph shapes, the station dot, the stroke widths,
the grid, the card metrics, the two-ground colour tokens); and
[`node-visual-system.md`](node-visual-system.md) (the grammar, the assignment policy,
and the hue meanings this geometry serves).
