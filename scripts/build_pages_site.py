#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build the GitHub Pages site from released content.

Usage:
    python3 scripts/build_pages_site.py --out DIR [--tag vX.Y.Z]

Assembles the site into DIR (a new or empty directory):

    index.html      generated: the introduction (site/intro.html), the Downloads
                    and source links, and a list of the documents in docs/
    downloads/      site/downloads/, with the release tag stamped into
                    downloads/index.html in place of __LATEST_TAG__
    assets/         site/assets/, shared by every page
    docs/           docs/, byte-identical to the repository, plus a generated
                    index.html in any subfolder that holds documents

The release tag is --tag if given, else the newest v* tag reachable from HEAD
(git describe --tags --abbrev=0 --match 'v*'); the build fails without one.

The document list groups, in order: the northstar (northstar.html if present,
else northstar.md); the other HTML documents; the Markdown specifications and
notes; the ideas under consideration (in-flight_ideas.md and *_ideas.md);
CONTRIBUTING.md. A Markdown file whose basename has an .html twin is listed
once, under the twin, with a "Markdown source" link. Within a group the order
is by title. Titles come from an HTML file's <title> or a Markdown file's first
"# " heading, descriptions from <meta name="description"> when present; a
document without a title fails the build. HTML documents are linked
relatively; Markdown documents, and the "Markdown source" links, go to
GitHub's rendered view pinned to the tag. Every other link is relative.

After writing, every relative href, src and CSS url() in the generated and
stamped pages is resolved against DIR; the build fails, listing the missing
targets, if any does not resolve. The documents copied from docs/ are checked
the same way but only reported: docs/ is published exactly as the repository
holds it, so a reference of its own that does not resolve is a defect to fix in
that document, not a reason to withhold the whole site.

Standard library only. Run by .github/workflows/pages.yml on main.

Exit codes:
  0  success
  1  build failure (no tag, an untitled document, the placeholder surviving
     the stamp, an unresolved reference, an unusable --out)
  2  bad arguments
"""

from __future__ import annotations

import argparse
import html
import posixpath
import re
import shutil
import subprocess
import sys
import textwrap
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from string import Template
from urllib.parse import quote, unquote, urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = REPO_ROOT / "site"
DOCS_DIR = REPO_ROOT / "docs"
INTRO_FILE = SITE_DIR / "intro.html"

GITHUB_REPO_URL = "https://github.com/ParkviewLab/pensa-grex"
TAG_PLACEHOLDER = "__LATEST_TAG__"
TAG_RE = re.compile(r"v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?")
DOC_SUFFIXES = (".html", ".md")

# The five groups, in the order they are listed. The key is also the CSS class
# that picks the group's accent colour.
GROUPS = (
    ("northstar", "Northstar"),
    ("html", "HTML documents"),
    ("specs", "Specifications and notes"),
    ("ideas", "Ideas under consideration"),
    ("contributing", "Contributing"),
)


class BuildError(Exception):
    """A condition that must fail the build, with a message for the log."""


# --------------------------------------------------------------------------- #
# The documents
# --------------------------------------------------------------------------- #


@dataclass
class Document:
    rel: PurePosixPath  # path relative to docs/
    kind: str  # "html" or "md"
    title: str  # entities decoded; escaped again on output
    description: str | None = None
    twin: Document | None = None  # the Markdown twin of an HTML document

    @property
    def stem(self) -> str:
        return self.rel.stem

    @property
    def sort_key(self) -> tuple[str, str]:
        return (self.title.casefold(), str(self.rel))


@dataclass
class Folder:
    rel: PurePosixPath  # relative to docs/; "." for docs/ itself
    documents: list[Document] = field(default_factory=list)
    subfolders: list[Folder] = field(default_factory=list)
    has_own_index: bool = False  # the repository ships docs/<rel>/index.html

    @property
    def holds_documents(self) -> bool:
        return bool(self.documents) or any(f.holds_documents for f in self.subfolders)


class HeadScanner(HTMLParser):
    """Collects an HTML document's <title> text and description meta."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.description: str | None = None
        self._in_title = False
        self._done = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._done:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and self.description is None:
            a = dict(attrs)
            if (a.get("name") or "").strip().lower() == "description" and a.get("content"):
                self.description = normalise_ws(a["content"] or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self._done = True

    def handle_data(self, data: str) -> None:
        if self._in_title and not self._done:
            self.title_parts.append(data)

    @property
    def title(self) -> str:
        return normalise_ws("".join(self.title_parts))


def normalise_ws(text: str) -> str:
    return " ".join(text.split())


def html_head(path: Path) -> tuple[str, str | None]:
    scanner = HeadScanner()
    scanner.feed(path.read_text(encoding="utf-8"))
    scanner.close()
    return scanner.title, scanner.description


FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
H1_RE = re.compile(r"^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$")


def markdown_title(path: Path) -> str:
    """The text of the first "# " heading, skipping fenced code blocks."""
    fence: str | None = None
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = FENCE_RE.match(line)
            if m:
                marker = m.group(1)[0]
                if fence is None:
                    fence = marker
                elif marker == fence:
                    fence = None
                continue
            if fence:
                continue
            m = H1_RE.match(line)
            if m:
                return normalise_ws(m.group(1))
    return ""


def scan_folder(docs_dir: Path, rel: PurePosixPath, untitled: list[str]) -> Folder:
    """Read the documents directly in docs/<rel>, pair twins, and recurse."""
    folder = Folder(rel=rel)
    here = docs_dir / rel
    entries = sorted(here.iterdir(), key=lambda p: p.name)
    by_name: dict[str, Document] = {}
    for p in entries:
        if not p.is_file() or p.suffix.lower() not in DOC_SUFFIXES:
            continue
        doc_rel = rel / p.name if str(rel) != "." else PurePosixPath(p.name)
        if p.suffix.lower() == ".html":
            title, description = html_head(p)
            doc = Document(doc_rel, "html", title, description)
        else:
            doc = Document(doc_rel, "md", markdown_title(p))
        if not doc.title:
            untitled.append(str(doc_rel))
        by_name[p.name] = doc
    for doc in by_name.values():
        if doc.kind == "html":
            twin = by_name.get(doc.stem + ".md")
            if twin is not None:
                doc.twin = twin
    twins = {id(d.twin) for d in by_name.values() if d.twin is not None}
    folder.documents = [d for d in by_name.values() if id(d) not in twins]
    folder.has_own_index = "index.html" in by_name
    for p in entries:
        if p.is_dir():
            sub_rel = rel / p.name if str(rel) != "." else PurePosixPath(p.name)
            sub = scan_folder(docs_dir, sub_rel, untitled)
            if sub.holds_documents:
                folder.subfolders.append(sub)
    return folder


def group_of(doc: Document) -> str:
    if doc.kind == "html":
        return "northstar" if doc.stem == "northstar" else "html"
    # A Markdown document without an HTML twin.
    if doc.stem == "northstar":
        return "northstar"
    if doc.stem.lower() == "contributing":
        return "contributing"
    if doc.stem.endswith("_ideas"):  # in-flight_ideas.md and every *_ideas.md
        return "ideas"
    return "specs"


# --------------------------------------------------------------------------- #
# The pages
# --------------------------------------------------------------------------- #

# The page shell. Its fonts, palette, top bar, hero and footer are copied from
# site/downloads/index.html so the two pages share one design; keep them in
# step when the download page's styles change. $root is the relative path from
# the page's own folder to the site root ("" at the root, "../../" in docs/x/).
PAGE = Template(
    """<!DOCTYPE html>
<!--
SPDX-FileCopyrightText: 2026 Gary Frattarola <garyf@parkviewlab.ai>
SPDX-License-Identifier: CC-BY-4.0
-->
<!-- Generated by scripts/build_pages_site.py at deploy time; not in the repository. -->
<html lang="en" data-ground="azure">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title</title>
<meta name="description" content="$description">
<link rel="icon" href="${root}assets/icon.svg">
<style>
/* Bundled mid-century typefaces, self-hosted (no network). Both SIL OFL 1.1. */
@font-face{font-family:'League Spartan';font-style:normal;font-weight:100 900;font-display:swap;src:url('${root}assets/fonts/LeagueSpartan-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
@font-face{font-family:'League Spartan';font-style:normal;font-weight:100 900;font-display:swap;src:url('${root}assets/fonts/LeagueSpartan-latin-ext.woff2') format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}
@font-face{font-family:'Boogaloo';font-style:normal;font-weight:400;font-display:swap;src:url('${root}assets/fonts/Boogaloo-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}

/* Palette — the app's own tokens, both grounds, selected by data-ground. */
:root{
  --font-ui:'League Spartan',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-display:'Boogaloo','League Spartan',sans-serif;
}
:root[data-ground="azure"]{
  --ground:#d3e6ef; --panel:#f8f3e8; --ink:#173242; --line:#365b6c; --muted:#5f7d8b;
  --grid:rgba(23,50,66,.10);
  --accent-teal:#1f8f8a; --accent-orange:#d75f2e; --accent-amber:#d9a53a; --accent-violet:#7d54a6;
  --here-ink:var(--ink);
}
:root[data-ground="navy"]{
  --ground:#0f2334; --panel:#1a3a54; --ink:#e8f1f6; --line:#6fb6c9; --muted:#93b3c2;
  --grid:rgba(111,182,201,.13);
  --accent-teal:#37c2ba; --accent-orange:#f27a44; --accent-amber:#f0bd55; --accent-violet:#bd93e6;
  --here-ink:var(--ground);
}

*{box-sizing:border-box;}
html,body{margin:0;}
body{
  font-family:var(--font-ui); color:var(--ink); background:var(--ground);
  background-image:radial-gradient(circle, var(--grid) 1px, transparent 1.4px);
  background-size:40px 40px;
  min-height:100vh; line-height:1.55;
}
a{color:var(--accent-teal);}

/* Top bar echoing the app's chrome. */
.topbar{display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:11px 20px; border-bottom:1px solid var(--line); background:var(--ground);
  position:sticky; top:0; z-index:10;}
.brand{font-family:var(--font-display); font-size:16px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--ink); text-decoration:none;}
.tb-right{display:flex; align-items:center; gap:12px;}
.seglbl{font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);}
.seg{display:inline-flex; border:1px solid var(--line); border-radius:999px; overflow:hidden;}
.seg button{font:inherit; font-size:12px; border:0; background:transparent; color:var(--muted); padding:6px 14px; cursor:pointer;}
.seg button.on{background:var(--ink); color:var(--ground);}

.wrap{max-width:1040px; margin:0 auto; padding:0 20px;}

/* Hero. */
.hero{display:grid; grid-template-columns:1.15fr .85fr; gap:40px; align-items:center; padding:64px 0 40px;}
.hero-mark{position:relative; justify-self:center;}
.hero-mark img{width:min(300px,72vw); height:auto; display:block; filter:drop-shadow(0 12px 30px rgba(0,0,0,.18));}
.hero-mark .icon-night{display:none;}
:root[data-ground="navy"] .hero-mark .icon-day{display:none;}
:root[data-ground="navy"] .hero-mark .icon-night{display:block;}
.wordmark{font-family:var(--font-display); font-size:clamp(46px,8vw,84px); line-height:.98; letter-spacing:.01em; margin:0 0 6px; color:var(--ink);}
.tagline{font-family:var(--font-display); font-size:clamp(20px,3.2vw,30px); color:var(--accent-orange); margin:0 0 16px; letter-spacing:.01em;}

/* The introduction (site/intro.html), then the Downloads card and the source link. */
.intro p{font-size:16px; color:var(--ink); max-width:52ch; margin:0 0 14px;}
.links{display:flex; flex-wrap:wrap; align-items:center; gap:18px; margin:24px 0 0;}
.cta{display:inline-flex; align-items:center; gap:12px; text-decoration:none; color:var(--ink);
  background:var(--panel); border:3px solid var(--accent-teal); border-bottom-width:5px; border-radius:15px;
  padding:12px 18px; transition:transform .09s ease, box-shadow .09s ease;}
.cta:hover{transform:translateY(-2px); box-shadow:0 8px 20px rgba(0,0,0,.14);}
.cta .glyph{width:13px; height:13px; border-radius:50%; background:var(--accent-teal); flex:none;}
.cta .t-os{font-family:var(--font-display); font-size:22px; line-height:1.05;}
.verbadge{font-size:14px; letter-spacing:.1em; text-transform:uppercase; color:var(--here-ink);
  background:var(--accent-teal); padding:3px 9px; border-radius:5px; font-weight:800;}
.src{font-size:15px;}

/* The document list: a station card per document, the group's accent on its border. */
.docs{padding:8px 0 48px;}
.docs h2{font-family:var(--font-display); font-weight:400; font-size:26px; letter-spacing:.02em; margin:0 0 4px; color:var(--ink);}
.docs-lede{font-size:14px; color:var(--muted); max-width:72ch; margin:0 0 22px;}
.group{margin:0 0 28px;}
.group h3{font-family:var(--font-display); font-weight:400; font-size:20px; letter-spacing:.02em; margin:0 0 10px; color:var(--ink);}
.doclist{list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(2,1fr); gap:12px;}
.doc{background:var(--panel); border:3px solid var(--accent); border-bottom-width:5px; border-radius:15px; padding:12px 15px;}
.doc-title{font-family:var(--font-display); font-size:18px; line-height:1.15; color:var(--ink); text-decoration:none;}
.doc-title:hover{text-decoration:underline;}
.doc-desc{font-size:14px; color:var(--muted); margin:6px 0 0;}
.doc-meta{font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:8px 0 0;}
.doc-meta a{color:var(--muted);}
.group.northstar{--accent:var(--accent-teal);}
.group.html{--accent:var(--accent-orange);}
.group.specs{--accent:var(--accent-amber);}
.group.ideas{--accent:var(--accent-violet);}
.group.contributing,.group.folders{--accent:var(--line);}

/* A folder index: a crumb back to the root and the folder's name. */
.folder-head{padding:48px 0 8px;}
.crumb{font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:0 0 8px;}
.crumb a{color:var(--muted);}
.folder-title{font-family:var(--font-display); font-size:clamp(32px,5vw,48px); line-height:1; margin:0 0 6px; color:var(--ink);}

footer{border-top:1px solid var(--line); padding:26px 0 40px; font-size:12.5px; color:var(--muted);}
footer .wrap{display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px;}
footer a{color:var(--muted); text-decoration:underline;}

@media (max-width:760px){
  .hero{grid-template-columns:1fr; gap:20px; padding:36px 0 24px; text-align:center;}
  .hero-mark{order:-1;}
  .intro p{margin-inline:auto;}
  .links{justify-content:center;}
  .doclist{grid-template-columns:1fr;}
}
</style>
</head>
<body>

<header class="topbar">
  $brand
  <div class="tb-right">
    <span class="seglbl">Mode</span>
    <div class="seg" id="mode">
      <button data-g="azure" class="on">Light</button>
      <button data-g="navy">Dark</button>
    </div>
  </div>
</header>

<main class="wrap">
$body
</main>

<footer>
  <div class="wrap">
    <span>© 2026 Gary Frattarola · AGPL-3.0-or-later, or commercial.</span>
    <span><a href="$github">Source on GitHub</a></span>
  </div>
</footer>

<script>
// Light / Dark ground toggle, mirroring the app (persisted to the same key).
(function(){
  var root=document.documentElement;
  function setGround(g){
    root.dataset.ground=g;
    document.querySelectorAll('#mode button').forEach(function(b){ b.classList.toggle('on', b.dataset.g===g); });
    try{ localStorage.setItem('pensagrex.ground', g); }catch(e){}
  }
  document.querySelectorAll('#mode button').forEach(function(b){ b.addEventListener('click', function(){ setGround(b.dataset.g); }); });
  try{ var s=localStorage.getItem('pensagrex.ground'); if(s==='navy'||s==='azure') setGround(s); }catch(e){}
})();
</script>
</body>
</html>
"""
)

ROOT_BODY = Template(
    """
  <section class="hero">
    <div class="hero-copy">
      <h1 class="wordmark">PensaGrex</h1>
      <p class="tagline">Keep track of what you &amp; your AI are doing</p>
      <div class="intro">
$intro
      </div>
      <div class="links">
        <a class="cta" href="downloads/">
          <span class="glyph"></span><span class="t-os">Downloads</span><span class="verbadge">$tag</span>
        </a>
        <a class="src" href="$github">Source on GitHub</a>
      </div>
    </div>

    <div class="hero-mark">
      <img class="icon-day" src="assets/icon.svg" alt="PensaGrex" width="300" height="300">
      <img class="icon-night" src="assets/icon-night.svg" alt="PensaGrex" width="300" height="300">
    </div>
  </section>

  <section class="docs">
    <h2>Documents</h2>
    <p class="docs-lede">Every document in the repository's <code>docs/</code> folder, as published in $tag.
      HTML documents open here; Markdown documents open in GitHub's rendered view at that release.</p>
$groups
  </section>
"""
)

FOLDER_BODY = Template(
    """
  <section class="folder-head">
    <p class="crumb"><a href="$root">PensaGrex</a> / documents</p>
    <h1 class="folder-title">docs/$folder</h1>
  </section>

  <section class="docs">
    <p class="docs-lede">The documents in <code>docs/$folder</code>, as published in $tag.
      HTML documents open here; Markdown documents open in GitHub's rendered view at that release.</p>
$groups
  </section>
"""
)


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def github_blob(tag: str, rel: PurePosixPath) -> str:
    return f"{GITHUB_REPO_URL}/blob/{tag}/docs/{quote(str(rel), safe='/')}"


def render_document(doc: Document, tag: str, page_dir: str) -> str:
    """One station card. page_dir is the page's folder relative to the site root."""
    if doc.kind == "html":
        href = posixpath.relpath(f"docs/{doc.rel}", page_dir)
    else:
        href = github_blob(tag, doc.rel)
    lines = [f'      <li class="doc"><a class="doc-title" href="{esc(href)}">{esc(doc.title)}</a>']
    if doc.description:
        lines.append(f'        <p class="doc-desc">{esc(doc.description)}</p>')
    if doc.kind == "md":
        lines.append('        <p class="doc-meta">Markdown · rendered on GitHub</p>')
    elif doc.twin is not None:
        src = github_blob(tag, doc.twin.rel)
        lines.append(f'        <p class="doc-meta"><a href="{esc(src)}">Markdown source</a></p>')
    lines.append("      </li>")
    return "\n".join(lines)


def render_groups(folder: Folder, tag: str, page_dir: str) -> tuple[str, dict[str, int]]:
    """The group sections for one folder, and a count of documents per group."""
    grouped: dict[str, list[Document]] = {key: [] for key, _ in GROUPS}
    for doc in folder.documents:
        grouped[group_of(doc)].append(doc)
    counts = {key: len(docs) for key, docs in grouped.items()}
    sections: list[str] = []
    for key, heading in GROUPS:
        docs = sorted(grouped[key], key=lambda d: d.sort_key)
        if not docs:
            continue
        cards = "\n".join(render_document(d, tag, page_dir) for d in docs)
        sections.append(
            f'    <div class="group {key}">\n      <h3>{esc(heading)}</h3>\n'
            f'      <ul class="doclist">\n{cards}\n      </ul>\n    </div>'
        )
    if folder.subfolders:
        cards = []
        for sub in sorted(folder.subfolders, key=lambda f: str(f.rel).casefold()):
            href = posixpath.relpath(f"docs/{sub.rel}", page_dir) + "/"
            cards.append(
                f'      <li class="doc"><a class="doc-title" href="{esc(href)}">{esc(sub.rel.name)}/</a></li>'
            )
        sections.append(
            '    <div class="group folders">\n      <h3>Folders</h3>\n'
            '      <ul class="doclist">\n' + "\n".join(cards) + "\n      </ul>\n    </div>"
        )
    return "\n".join(sections), counts


LEADING_COMMENTS_RE = re.compile(r"\A(?:\s*<!--.*?-->)*\s*", re.DOTALL)


def read_intro() -> str:
    if not INTRO_FILE.is_file():
        raise BuildError(f"missing {INTRO_FILE.relative_to(REPO_ROOT)}")
    text = LEADING_COMMENTS_RE.sub("", INTRO_FILE.read_text(encoding="utf-8")).rstrip()
    if not text:
        raise BuildError(f"{INTRO_FILE.relative_to(REPO_ROOT)} holds no introduction")
    return textwrap.indent(text, " " * 8)


def render_root_page(folder: Folder, tag: str, intro: str) -> tuple[str, dict[str, int]]:
    groups, counts = render_groups(folder, tag, ".")
    body = ROOT_BODY.substitute(intro=intro, tag=esc(tag), github=GITHUB_REPO_URL, groups=groups)
    page = PAGE.substitute(
        root="",
        title="PensaGrex",
        description="PensaGrex: a live set of project plans, drawn as a subway map. Downloads and documentation.",
        brand='<span class="brand">PensaGrex</span>',
        body=body,
        github=GITHUB_REPO_URL,
    )
    return page, counts


def render_folder_page(folder: Folder, tag: str) -> tuple[str, dict[str, int]]:
    page_dir = f"docs/{folder.rel}"
    root = "../" * (len(folder.rel.parts) + 1)
    groups, counts = render_groups(folder, tag, page_dir)
    body = FOLDER_BODY.substitute(root=root, folder=esc(str(folder.rel)), tag=esc(tag), groups=groups)
    page = PAGE.substitute(
        root=root,
        title=f"PensaGrex — docs/{esc(str(folder.rel))}",
        description=f"The PensaGrex documents in docs/{esc(str(folder.rel))}, as published in {esc(tag)}.",
        brand=f'<a class="brand" href="{root}">PensaGrex</a>',
        body=body,
        github=GITHUB_REPO_URL,
    )
    return page, counts


# --------------------------------------------------------------------------- #
# The link check
# --------------------------------------------------------------------------- #

SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
CSS_URL_RE = re.compile(r"""url\(\s*(['"]?)([^'")\s]+)\1\s*\)""")


class RefCollector(HTMLParser):
    """Collects every href and src attribute, and every url() inside <style>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[tuple[str, int]] = []
        self._in_style = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        line = self.getpos()[0]
        for name, value in attrs:
            if name in ("href", "src") and value is not None:
                self.refs.append((value.strip(), line))
        if tag == "style":
            self._in_style = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "style":
            self._in_style = False

    def handle_data(self, data: str) -> None:
        if self._in_style:
            line = self.getpos()[0]
            for m in CSS_URL_RE.finditer(data):
                self.refs.append((m.group(2), line + data[: m.start()].count("\n")))


def is_local(ref: str) -> bool:
    """Whether a reference addresses a file of ours, rather than somewhere else."""
    if not ref or ref.startswith(("#", "//")) or SCHEME_RE.match(ref):
        return False  # a fragment, a protocol-relative or an absolute URL: not ours
    return bool(unquote(urlsplit(ref).path))  # false for a bare query or fragment


def unresolved(ref: str, page: Path, out: Path) -> str | None:
    """Why a reference does not resolve to a file in out, or None if it does."""
    if not is_local(ref):
        return None
    path = unquote(urlsplit(ref).path)
    if path.startswith("/"):
        return "root-relative; the site lives under /pensa-grex/, so every reference must be relative"
    target = (page.parent / path).resolve()
    try:
        target.relative_to(out)
    except ValueError:
        return "resolves outside the site"
    if path.endswith("/") or target.is_dir():
        return None if (target / "index.html").is_file() else "no index.html in that folder"
    return None if target.is_file() else "no such file"


def check_links(pages: list[Path], out: Path) -> tuple[int, list[str]]:
    """Resolve every local reference in the pages; returns (checked, problems)."""
    checked = 0
    problems: list[str] = []
    for page in pages:
        collector = RefCollector()
        collector.feed(page.read_text(encoding="utf-8"))
        collector.close()
        for ref, line in collector.refs:
            if not is_local(ref):
                continue
            checked += 1
            why = unresolved(ref, page, out)
            if why is not None:
                problems.append(f"{page.relative_to(out)}:{line}: {ref!r}: {why}")
    return checked, problems


def copied_documents(out: Path, generated: list[Path]) -> list[Path]:
    """The HTML documents copied from docs/, excluding the pages written here."""
    written = {p.resolve() for p in generated}
    return sorted(p for p in (out / "docs").rglob("*.html") if p.resolve() not in written)


# --------------------------------------------------------------------------- #
# The build
# --------------------------------------------------------------------------- #


def release_tag(explicit: str | None) -> str:
    if explicit is not None:
        if not TAG_RE.fullmatch(explicit):
            raise BuildError(f"--tag {explicit!r} is not a vX.Y.Z tag")
        return explicit
    result = subprocess.run(
        ["git", "describe", "--tags", "--abbrev=0", "--match", "v*"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,  # a repository with no tag at all is reported below, not raised
    )
    tag = result.stdout.strip()
    if result.returncode != 0 or not tag:
        raise BuildError(
            "no v* tag reachable from HEAD (git describe --tags --abbrev=0 --match 'v*'); "
            "refusing to publish a site with no release to pin to"
        )
    return tag


def prepare_out(out_arg: str) -> Path:
    out = Path(out_arg).resolve()
    for guarded in (SITE_DIR, DOCS_DIR):
        if out == guarded or guarded in out.parents:
            raise BuildError(f"--out must not be inside {guarded.relative_to(REPO_ROOT)}/")
    if out.exists():
        if not out.is_dir():
            raise BuildError(f"--out {out} is not a directory")
        if any(out.iterdir()):
            raise BuildError(f"--out {out} is not empty; pass a new or empty directory")
    else:
        out.mkdir(parents=True)
    return out


def ignore_site_entries(directory: str, names: list[str]) -> set[str]:
    ignored = {n for n in names if n == ".DS_Store"}
    if Path(directory).resolve() == SITE_DIR:
        ignored.add(INTRO_FILE.name)
    return ignored


def ignore_docs_entries(directory: str, names: list[str]) -> set[str]:
    return {n for n in names if n == ".DS_Store"}


def stamp_downloads_page(out: Path, tag: str) -> Path:
    page = out / "downloads" / "index.html"
    if not page.is_file():
        raise BuildError("site/downloads/index.html is missing")
    text = page.read_text(encoding="utf-8").replace(TAG_PLACEHOLDER, tag)
    if TAG_PLACEHOLDER in text:
        raise BuildError(f"placeholder {TAG_PLACEHOLDER} survived the stamp")
    page.write_text(text, encoding="utf-8")
    return page


def count_files(root: Path) -> int:
    return sum(1 for p in root.rglob("*") if p.is_file())


def plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def build(out: Path, tag: str) -> None:
    print(f"build_pages_site: release tag {tag}")
    shutil.copytree(SITE_DIR, out, ignore=ignore_site_entries, dirs_exist_ok=True)
    shutil.copytree(DOCS_DIR, out / "docs", ignore=ignore_docs_entries)
    print(f"  copied site/ (without {INTRO_FILE.name}) and docs/ ({plural(count_files(out / 'docs'), 'file')})")

    pages = [stamp_downloads_page(out, tag)]
    print(f"  stamped {tag} into downloads/index.html")

    untitled: list[str] = []
    root_folder = scan_folder(out / "docs", PurePosixPath("."), untitled)
    if untitled:
        raise BuildError("documents without a title:\n    " + "\n    ".join(untitled))

    page, counts = render_root_page(root_folder, tag, read_intro())
    (out / "index.html").write_text(page, encoding="utf-8")
    pages.append(out / "index.html")
    summary = ", ".join(f"{key} {counts[key]}" for key, _ in GROUPS)
    print(f"  wrote index.html: {plural(len(root_folder.documents), 'document')} ({summary})")

    pending = list(root_folder.subfolders)
    while pending:
        folder = pending.pop(0)
        pending.extend(folder.subfolders)
        if folder.has_own_index:
            print(f"  docs/{folder.rel}/index.html ships in the repository; not generated")
            continue
        page, counts = render_folder_page(folder, tag)
        target = out / "docs" / folder.rel / "index.html"
        target.write_text(page, encoding="utf-8")
        pages.append(target)
        print(f"  wrote docs/{folder.rel}/index.html: {plural(len(folder.documents), 'document')}")

    checked, problems = check_links(pages, out)
    if problems:
        raise BuildError("unresolved references:\n    " + "\n    ".join(problems))
    print(
        f"  link check: {plural(checked, 'local reference')} "
        f"in {plural(len(pages), 'generated page')}, all resolve"
    )

    copied = copied_documents(out, pages)
    if copied:
        _, reported = check_links(copied, out)
        for problem in reported:
            print(f"  warning: {problem}")
        verdict = "all resolve" if not reported else f"{len(reported)} unresolved, published as they are"
        print(f"  docs/ link check: {plural(len(copied), 'copied HTML document')}, {verdict}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the GitHub Pages site into a directory.")
    parser.add_argument("--out", required=True, metavar="DIR", help="a new or empty directory to build into")
    parser.add_argument("--tag", metavar="vX.Y.Z", help="the release tag to pin to (default: newest v* tag reachable from HEAD)")
    args = parser.parse_args(argv)
    try:
        out = prepare_out(args.out)
        build(out, release_tag(args.tag))
    except BuildError as e:
        print(f"build_pages_site: error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
