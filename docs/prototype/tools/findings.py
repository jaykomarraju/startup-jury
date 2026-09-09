#!/usr/bin/env python3
"""
Query the parity findings. Use this instead of reading docs/PARITY-FINDINGS.md whole —
it is 1.4 MB and will bury your context.

    # your session's worklist, one line each
    python3 docs/prototype/tools/findings.py --area "Admin console" --screen "s-fw|s-wt"

    # the same, in full, when you are ready to work them
    python3 docs/prototype/tools/findings.py --area "Admin console" --screen "s-fw" --full

    # just the count, to check a claim
    python3 docs/prototype/tools/findings.py --sev P0 --count

    # a specific finding
    python3 docs/prototype/tools/findings.py --id F0042 --full

Filters combine with AND. --screen, --title and --grep are case-insensitive regexes;
--grep searches every text field.
"""
import argparse
import json
import os
import re
import sys

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "PARITY-FINDINGS.json")


def main():
    ap = argparse.ArgumentParser(description="Query the ai.STARTUPJURY parity findings.")
    ap.add_argument("--id", help="exact finding id, e.g. F0042 (comma-separated for several)")
    ap.add_argument("--area", help="area name, substring match")
    ap.add_argument("--sev", help="P0, P1, P2, P3 — comma-separated for several")
    ap.add_argument("--screen", help="regex over the screen field")
    ap.add_argument("--title", help="regex over the title")
    ap.add_argument("--grep", help="regex over every text field")
    ap.add_argument("--edition", help="incubator | vc | both")
    ap.add_argument("--cat", help="regex over the category")
    ap.add_argument("--full", action="store_true", help="print gap/prototype/repo/fix too")
    ap.add_argument("--count", action="store_true", help="print only the number of matches")
    ap.add_argument("--ids", action="store_true", help="print only the ids, space separated")
    ap.add_argument("--areas", action="store_true", help="list the areas and their counts, then exit")
    args = ap.parse_args()

    if not os.path.exists(DATA):
        sys.exit("Findings file not found at %s" % DATA)
    rows = json.load(open(DATA))["findings"]

    if args.areas:
        counts = {}
        for r in rows:
            counts.setdefault(r["area"], []).append(r["severity"])
        for area in sorted(counts):
            sevs = counts[area]
            print("%-32s %4d   P0 %-4d P1 %-4d P2 %-4d P3 %d" % (
                area, len(sevs),
                sevs.count("P0"), sevs.count("P1"), sevs.count("P2"), sevs.count("P3")))
        return

    def rx(pattern, value):
        return re.search(pattern, value or "", re.I) is not None

    if args.id:
        wanted = {x.strip().upper() for x in args.id.split(",")}
        rows = [r for r in rows if r["id"] in wanted]
    if args.area:
        rows = [r for r in rows if args.area.lower() in r["area"].lower()]
    if args.sev:
        wanted = {x.strip().upper() for x in args.sev.split(",")}
        rows = [r for r in rows if r["severity"] in wanted]
    if args.screen:
        rows = [r for r in rows if rx(args.screen, r["screen"])]
    if args.title:
        rows = [r for r in rows if rx(args.title, r["title"])]
    if args.cat:
        rows = [r for r in rows if rx(args.cat, r.get("category"))]
    if args.edition:
        e = args.edition.lower()
        rows = [r for r in rows if (r.get("edition") or "both") in (e, "both", "")]
    if args.grep:
        def hay(r):
            return " ".join(str(r.get(k) or "") for k in
                            ("title", "screen", "gap", "proto", "repo", "fix", "category"))
        rows = [r for r in rows if rx(args.grep, hay(r))]

    if args.count:
        print(len(rows))
        return
    if args.ids:
        print(" ".join(r["id"] for r in rows))
        return

    for r in rows:
        print("%s  %s  %s" % (r["id"], r["severity"], r["title"]))
        print("        %s · %s%s" % (
            r["screen"], r.get("category") or "-",
            (" · effort " + r["effort"]) if r.get("effort") else ""))
        if args.full:
            print("        GAP   %s" % r["gap"])
            print("        PROTO %s" % r["proto"])
            print("        REPO  %s" % r["repo"])
            if r.get("fix"):
                print("        FIX   %s" % r["fix"])
        print()
    print("— %d findings" % len(rows), file=sys.stderr)


if __name__ == "__main__":
    main()
