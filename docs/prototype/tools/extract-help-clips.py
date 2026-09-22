#!/usr/bin/env python3
"""Split `Help_JURYbuddy.HTM` into its text content and its 41 video clips.

The client's JURYbuddy spec is ONE 8.2 MB file, and 7.81 MB of it is base64
`data:video/mp4` — 41 clips, 5.86 MB decoded. Only 38.5 KB is markup and widget
script. Reading the file whole wastes an enormous amount of context for almost
no content, and shipping it whole would put 5.86 MB of video into the JS bundle.

This tool separates the two:
  · `faqs.json`  — the 41 Q&A entries (already ported to
                   `src/client/routes/help/faqs.ts`; regenerate to diff a
                   re-shared spec against what shipped)
  · `clips.json` — clip titles and durations, no bytes
  · `*.mp4`      — one file per clip, named `<clip_id>.mp4`, ready to upload to
                   the `HELP_MEDIA` R2 bucket under `help/clips/`

Usage:
    python3 docs/prototype/tools/extract-help-clips.py <Help_JURYbuddy.HTM> [--out DIR]
    # then, once `wrangler r2 bucket create startup-jury-help-media` has run:
    for f in DIR/*.mp4; do
      npx wrangler r2 object put "startup-jury-help-media/help/clips/$(basename "$f")" \
        --file "$f" --content-type video/mp4 --remote
    done
"""
import argparse
import base64
import json
import os
import re
import sys


def grab(raw: str, name: str):
    """Read one `const <name> = <json>;` declaration out of the spec's script."""
    needle = "const %s = " % name
    try:
        i = raw.index(needle) + len(needle)
    except ValueError:
        raise SystemExit("error: %s not found — is this the JURYbuddy spec?" % name)
    j = raw.index(";\n", i)
    return json.loads(raw[i:j])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("spec", help="path to Help_JURYbuddy.HTM")
    ap.add_argument("--out", default="help-clips", help="output directory")
    args = ap.parse_args()

    raw = open(args.spec, encoding="utf-8").read()
    faqs = grab(raw, "EMBEDDED_FAQS")
    clips = grab(raw, "EMBEDDED_CLIPS")

    os.makedirs(args.out, exist_ok=True)

    # Text: drop `data_uri`, keep everything the widget renders.
    json.dump(faqs, open(os.path.join(args.out, "faqs.json"), "w"), indent=2, ensure_ascii=False)
    meta = {k: {"title": v["title"], "duration_sec": v["duration_sec"]} for k, v in clips.items()}
    json.dump(meta, open(os.path.join(args.out, "clips.json"), "w"), indent=2, ensure_ascii=False)

    # Integrity: every FAQ must name a clip that exists, and vice versa. A
    # re-shared spec that breaks this pairing is the thing worth knowing early.
    referenced = {f["clip_id"] for f in faqs}
    missing = sorted(referenced - set(clips))
    orphans = sorted(set(clips) - referenced)
    if missing:
        print("WARNING: %d FAQ(s) reference a clip that is not embedded: %s" % (len(missing), missing))
    if orphans:
        print("WARNING: %d embedded clip(s) no FAQ references: %s" % (len(orphans), orphans))

    total = 0
    for clip_id, clip in clips.items():
        if not re.fullmatch(r"[a-z0-9_]{1,64}", clip_id):
            # The server's `CLIP_ID` guard rejects anything else, so it could
            # never be served even if it uploaded cleanly.
            print("WARNING: clip id %r is not servable — skipped" % clip_id)
            continue
        data = base64.b64decode(clip["data_uri"].split(",", 1)[1])
        open(os.path.join(args.out, "%s.mp4" % clip_id), "wb").write(data)
        total += len(data)

    print(
        "%d FAQs · %d clips · %.2f MB of video -> %s"
        % (len(faqs), len(clips), total / 1048576, args.out)
    )
    print("spec is %.2f MB; the text half is %.1f KB" % (len(raw) / 1048576, (len(raw) - total * 4 / 3) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
