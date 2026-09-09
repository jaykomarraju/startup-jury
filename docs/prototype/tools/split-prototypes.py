#!/usr/bin/env python3
"""
Split the ai.STARTUPJURY role prototypes into per-screen files an agent can read.

The prototypes are 760-1000 KB single-file HTML mocks. Never read one whole. Run this
once at the start of a session and read only the pieces you need.

    python3 docs/prototype/tools/split-prototypes.py
    # -> writes to $SJ_PROTO_SPLIT, default ${TMPDIR:-/tmp}/sj-prototype-split

Per prototype it emits:
    panel-<slug>.html      one screen (1-35 KB) — the `showPanel('<slug>')` targets
    _ADMIN-CONSOLE.html    the Admin console, decoded from `var ADMIN_B64`
    admin/s-<id>.html      one Admin console section each (16 for admin/superuser, 12 otherwise)
    admin/_scripts.js      the console's own JS — renderers and seed data; GREP, don't read
    admin/_style.css       the console's CSS
    _topnav.html           the top bar, incl. the profile menu
    _sidebar.html          the role's sidebar — the authoritative nav for that role
    _rest.html             overlays NOT inside a panel: #setup-overlay (openSetup),
                           #acct-overlay (openAccount), #fp-ov (founder), aet-* (add member)
    _style.css             all prototype CSS — grep for the class names you see
    _scripts.js            all prototype JS — panel renderers and seed data; GREP, don't read

WHY THIS EXISTS: three sidebar items — "Set up", "My account" and "Admin console" — do NOT
call showPanel(). They call openSetup() / openAccount() / openAdmin(), and the Admin console
is a separate ~170 KB document base64-encoded into `var ADMIN_B64`. Any audit that enumerates
`panel-*` ids misses it entirely. That is how the original build shipped with no admin console.
"""
import base64
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # docs/prototype
SRC = os.path.join(ROOT, "source")
OUT = os.environ.get("SJ_PROTO_SPLIT") or os.path.join(
    os.environ.get("TMPDIR", "/tmp").rstrip("/"), "sj-prototype-split"
)

TAG = re.compile(r"<(/?)(\w+)([^>]*?)(/?)>")
PANEL = re.compile(r'<div\b[^>]*\bid="panel-([\w-]+)"')
SECTION = re.compile(r'<div\b[^>]*\bid="s-(\w+)"')


def block(src, start):
    """End index of the balanced <div> starting at `start`."""
    depth = 0
    for m in TAG.finditer(src, start):
        closing, name, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if name != "div":
            continue
        if closing == "/":
            depth -= 1
            if depth == 0:
                return m.end()
        elif selfclose != "/":
            depth += 1
    return len(src)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def split_admin_console(doc, outdir):
    """Split the decoded Admin console into its sections."""
    admin = os.path.join(outdir, "admin")
    found = []
    for m in SECTION.finditer(doc):
        sid = m.group(1)
        body = doc[m.start(): block(doc, m.start())]
        write(os.path.join(admin, "s-%s.html" % sid), body)
        found.append(sid)
    write(os.path.join(admin, "_scripts.js"),
          "\n\n/* ---- */\n\n".join(x.group(1) for x in re.finditer(r"<script>(.*?)</script>", doc, re.S)))
    write(os.path.join(admin, "_style.css"),
          "\n".join(x.group(1) for x in re.finditer(r"<style>(.*?)</style>", doc, re.S)))
    # The Price configuration section lazy-loads a nested base64 document.
    for m in re.finditer(r"data:text/html;base64,([A-Za-z0-9+/=]{200,})", doc):
        try:
            write(os.path.join(admin, "_nested-priceconfig.html"),
                  base64.b64decode(m.group(1)).decode("utf-8", "replace"))
            found.append("(nested price config)")
        except Exception:
            pass
    return found


def split_one(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    name = os.path.basename(path).rsplit(".", 1)[0]
    outdir = os.path.join(OUT, name)
    panels, covered = [], []

    for m in PANEL.finditer(src):
        end = block(src, m.start())
        write(os.path.join(outdir, "panel-%s.html" % m.group(1)), src[m.start():end])
        panels.append(m.group(1))
        covered.append((m.start(), end))

    for key, marker in (("_topnav", '<div class="an">'), ("_sidebar", '<div class="sb">')):
        i = src.find(marker)
        if i >= 0:
            end = block(src, i)
            write(os.path.join(outdir, key + ".html"), src[i:end])
            covered.append((i, end))

    write(os.path.join(outdir, "_style.css"),
          "\n".join(x.group(1) for x in re.finditer(r"<style>(.*?)</style>", src, re.S)))
    write(os.path.join(outdir, "_scripts.js"),
          "\n\n/* ---- */\n\n".join(x.group(1) for x in re.finditer(r"<script>(.*?)</script>", src, re.S)))

    sections = []
    m = re.search(r'var ADMIN_B64="([A-Za-z0-9+/=]+)"', src)
    if m:
        doc = base64.b64decode(m.group(1)).decode("utf-8", "replace")
        write(os.path.join(outdir, "_ADMIN-CONSOLE.html"), doc)
        sections = split_admin_console(doc, outdir)

    # Everything not in a panel, the chrome, a <style> or a <script>: the overlays.
    marks = [(x.start(), x.end())
             for x in re.finditer(r"<style>.*?</style>|<script>.*?</script>", src, re.S)]
    rest, prev = [], 0
    for start, end in sorted(covered + marks):
        if start > prev:
            rest.append(src[prev:start])
        prev = max(prev, end)
    rest.append(src[prev:])
    write(os.path.join(outdir, "_rest.html"), "\n<!-- ==== GAP ==== -->\n".join(rest))

    return name, panels, sections


def main():
    files = sorted(glob.glob(os.path.join(SRC, "incubator", "AISJ*.*")) +
                   glob.glob(os.path.join(SRC, "vc", "AISJ*.*")))
    if not files:
        sys.exit("No prototypes found under %s" % SRC)
    print("Splitting %d prototypes into %s\n" % (len(files), OUT))
    for path in files:
        name, panels, sections = split_one(path)
        print("  %-24s %2d panels · admin console %s"
              % (name, len(panels), ("%d sections" % len(sections)) if sections else "MISSING"))
    print("\nDone. Set SJ_PROTO_SPLIT to change the output directory.")


if __name__ == "__main__":
    main()
