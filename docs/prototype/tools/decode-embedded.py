#!/usr/bin/env python3
"""Decode the base64-embedded sub-documents inside a prototype HTML.

The incubator superuser prototypes carry whole screens as base64 in a JS var and
mount them with `atob(...)` into an iframe `srcdoc`. A plain grep of the outer
file therefore reports ZERO hits for anything inside them — the admin console,
its Scoring framework, Price configuration and Team & roles included. That false
negative has now bitten this project twice (see the `startup-jury-admin-console-gap`
note, and Wave-V3 scoping on 2026-09-19).

Usage:
    python3 docs/prototype/tools/decode-embedded.py <prototype.htm> <outdir>

Writes one file per embedded blob, named after its variable (e.g. ADMIN_B64 ->
admin_b64.html), and prints what it found.
"""
import base64, os, re, sys

def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, outdir = sys.argv[1], sys.argv[2]
    s = open(src, encoding="utf-8", errors="replace").read()
    os.makedirs(outdir, exist_ok=True)
    found = 0
    for m in re.finditer(r'var\s+([A-Z0-9_]*B64)\s*=\s*"([A-Za-z0-9+/=]{500,})"', s):
        name, blob = m.group(1), m.group(2)
        try:
            data = base64.b64decode(blob)
        except Exception as exc:                       # noqa: BLE001 - report, don't crash
            print(f"  {name}: could not decode ({exc})")
            continue
        dest = os.path.join(outdir, name.lower().replace("_b64", "") + ".html")
        open(dest, "wb").write(data)
        print(f"  {name}: {len(blob)} b64 chars -> {len(data)} bytes -> {dest}")
        found += 1
    if not found:
        print("  no base64 blobs found — the outer file is all there is")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
