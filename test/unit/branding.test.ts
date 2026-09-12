import { describe, it, expect } from "vitest";
import {
  ALL_BRAND_TOKENS,
  BRAND_TOKENS,
  STATUS_TOKENS,
  DEFAULT_BRANDING,
  brandingPatch,
  mergeBranding,
  normaliseHex,
  readBranding,
} from "../../src/shared/branding";

/**
 * W4-B — the branding vocabulary, on its own.
 *
 * The applier and the section both go through these functions, so the rules
 * that matter are pinned here once: which token names exist, what a hex is,
 * what a stored record means, and — the §1.5 defect — that a save is a merge
 * over the whole record rather than a partial overwrite.
 */

describe("brand token table", () => {
  it("is the prototype's 10 brand + 4 status tokens, by their index.css names", () => {
    expect(BRAND_TOKENS.map((t) => t.token)).toEqual([
      "--olive",
      "--olive-lt",
      "--gold",
      "--gold-dk",
      "--gold-lt",
      "--navy",
      "--text-3",
      "--bg",
      "--stone",
      "--stone-dk",
    ]);
    expect(STATUS_TOKENS.map((t) => t.token)).toEqual(["--green", "--red", "--blue", "--purple"]);
  });

  it("marks exactly the tokens index.css does NOT re-derive in dark as dark-safe", () => {
    // The dark block in src/client/index.css overrides every other token; a
    // branded value for one of those would paint a light surface onto the dark
    // theme. These five have one value in both themes.
    expect(ALL_BRAND_TOKENS.filter((t) => t.darkSafe).map((t) => t.token)).toEqual([
      "--gold",
      "--navy",
      "--red",
      "--blue",
      "--purple",
    ]);
  });

  it("gives every token a valid hex fallback", () => {
    for (const spec of ALL_BRAND_TOKENS) {
      expect(normaliseHex(spec.fallback), spec.token).toBe(spec.fallback.toUpperCase());
    }
  });
});

describe("normaliseHex — brNorm's rules", () => {
  it("accepts #RGB and #RRGGBB, with or without the hash, uppercased", () => {
    expect(normaliseHex("#4a6644")).toBe("#4A6644");
    expect(normaliseHex("4A6644")).toBe("#4A6644");
    expect(normaliseHex(" #e8a ")).toBe("#E8A");
  });

  it("rejects everything else, silently", () => {
    for (const bad of ["", "#12", "#12345", "olive", "rgb(1,2,3)", "#GGGGGG", null, 7, {}]) {
      expect(normaliseHex(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("readBranding", () => {
  it("falls back to the shipped literal for an empty record", () => {
    expect(readBranding({})).toEqual(DEFAULT_BRANDING);
    expect(readBranding(null)).toEqual(DEFAULT_BRANDING);
  });

  it("keeps `wordmark` meaning the SECOND half, so ConfigPage's records still read", () => {
    const b = readBranding({ wordmark: "T-HUB JURY", tagline: "Backed by data" });
    expect(b.wordmarkPrefix).toBe("ai");
    expect(b.wordmark).toBe("T-HUB JURY");
    expect(b.tagline).toBe("Backed by data");
  });

  it("seeds --gold from ConfigPage's single `accent`, and lets `tokens` win", () => {
    expect(readBranding({ accent: "#123456" }).tokens).toEqual({ "--gold": "#123456" });
    expect(readBranding({ accent: "#123456", tokens: { "--gold": "#abcdef" } }).tokens).toEqual({
      "--gold": "#ABCDEF",
    });
  });

  it("drops unknown token names and invalid hexes rather than writing them to the DOM", () => {
    const b = readBranding({
      tokens: { "--olive": "#4A6644", "--not-ours": "#000000", "--red": "chartreuse" },
    });
    expect(b.tokens).toEqual({ "--olive": "#4A6644" });
  });
});

describe("brandingPatch + mergeBranding — the §1.5 wipe defect", () => {
  it("mirrors --gold out to `accent` so the two branding screens agree", () => {
    const patch = brandingPatch({ ...DEFAULT_BRANDING, tokens: { "--gold": "#123456" } });
    expect(patch.accent).toBe("#123456");
  });

  it("omits `accent` when the accent is unbranded", () => {
    expect(brandingPatch(DEFAULT_BRANDING)).not.toHaveProperty("accent");
  });

  it("carries the wizard's orgName/orgType through a branding save untouched", () => {
    const current = { orgName: "T-Hub", orgType: "accelerator", wordmark: "STARTUPJURY" };
    const body = mergeBranding(current, brandingPatch({ ...DEFAULT_BRANDING, wordmark: "T-HUB" }));
    expect(body).toMatchObject({ orgName: "T-Hub", orgType: "accelerator", wordmark: "T-HUB" });
  });
});
