# `om-figma-brand-extract@1` — shared extraction schema (MODE B attach step)

> Placement note: this reference belongs to the `om-figma-design-with-ds` skill defined by
> `2026-07-05-ds-tokens-figma-sync-and-code-connect.md` (workstream 3). The skill promotion has
> not merged yet, so this doc waits here in the from-figma branch, per that spec's migration
> notes, until the promoted skill exists to host it.

## What this is

`mercato theme from-figma` writes a versioned extraction JSON inventorying a client Figma
file's brand signals: color candidates with usage counts, local styles, font families, and the
corner-radius histogram. It is a stable interchange format, not a private cache — the CLI
import and this skill's MODE B audit flow both consume it, so the two paths agree about the
same file instead of re-deriving inventories independently.

Default location: `.ai/reports/figma-brand-extract-<file-key>.json` (dated working artifact,
regenerated on demand, never a source of truth). Produce one with:

```bash
FIGMA_TOKEN=... yarn mercato theme from-figma <file-url-or-key> --report-only
```

## MODE B attach step

When auditing an existing design (MODE B), accept an optional extraction JSON as input. With
it attached, ground every "colors/fonts/radii used in this file" claim in the counted
inventory instead of re-deriving values visually from screenshots — the audit's violation list
and the CLI import report's unmapped-candidates list must agree about the same file.

Before using an attached file:

1. Check `schema` — this reference accepts exactly `om-figma-brand-extract@1`. Reject other
   versions with a note to re-extract with a matching CLI build.
2. Check `file.key` against the file being audited; a mismatched key means a stale or wrong
   artifact.
3. Respect `source.frames.truncated` — a truncated inventory is still a ranked inventory, but
   coverage claims must say what was skipped.

## Schema (authoritative shape)

```jsonc
{
  "schema": "om-figma-brand-extract@1",
  "file": { "key": "AbCdEf123", "name": "Acme Brand Book", "lastModified": "…", "extractedAt": "…" },
  "source": {
    "variables": "ok" | "unavailable-plan-gated" | "error",   // Variables REST API is Enterprise-plan-gated
    "styles": "ok" | "error",
    "frames": { "pagesScanned": 3, "framesScanned": 41, "nodesVisited": 12480, "nodeBudget": 20000, "truncated": false },
    "excluded": { "image": 214, "gradient": 12, "alpha": 89 } // fills excluded from candidate ranking
  },
  "candidates": [                                             // ranked: variable > style > fill tier,
    {                                                         // chromatic above near-gray, then usage count
      "hex": "#0c71c6",                                       // lowercase #rrggbb
      "count": 148,                                           // solid fill/stroke occurrences in scanned frames
      "tier": "variable" | "style" | "fill",
      "sources": ["fill:frame", "fill:text", "style"],        // sorted; also "stroke:frame", "stroke:text", "variable"
      "styleNames": ["Brand/Primary"],                        // sorted
      "variableName": null                                    // set when backed by a published Variable
    }
  ],
  "styles": [
    { "type": "FILL", "name": "Brand/Primary", "hex": "#0c71c6" },
    { "type": "TEXT", "name": "Heading/H1", "fontFamily": "Inter", "fontWeight": 600, "fontSize": 32 }
  ],
  "fonts": [ { "family": "Inter", "weights": [400, 500, 600], "textStyles": 12, "usageCount": 3100 } ],
  "radii": [ { "px": 8, "count": 96 } ]                       // ascending px
}
```

Invariants: deterministic serialization (re-extracting an unchanged file yields identical
bytes apart from `extractedAt`), hex lowercased, keys in the order above, no credentials or
requester identity anywhere in the artifact.

## Compatibility rule

Additive fields only within `@1` — readers must tolerate unknown extra fields. Any breaking
change bumps to `@2`, and both consumers (the CLI and this skill) must state which versions
they accept. The CLI pins the `@1` shape with a byte-for-byte fixture test
(`packages/cli/src/lib/theme/__tests__/figma-extract.test.ts`), so accidental drift fails CI
before it desynchronizes this skill.

## Interpretation rule (normative)

The machine inventories, the designer interprets. Ranking is presentation, never decision:
frequency, chroma, and even a variable named `primary` are evidence, not verdicts. Never
auto-finalize a token assignment from this artifact — surface the evidence and let a human
choose, exactly as the CLI's mapping step does.
