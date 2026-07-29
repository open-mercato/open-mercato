# DS Theme from Figma — Client Brand Import (`mercato theme from-figma`)

- **Status:** Draft — depends on the theming spec landing first
- **Scope:** OSS (CLI + shared extraction format consumed by the Figma workflow skill)
- **Origin:** Item 6 (execution order) of the DS DX roadmap — direct extension of [`2026-07-05-ds-theming-and-brand-customization.md`](2026-07-05-ds-theming-and-brand-customization.md) (item 3)
- **Risk:** `risk-low` (purely additive CLI subcommand; no runtime code paths) — **Priority:** `priority-medium`
- **Category:** `feature`

## TLDR

`mercato theme init` (theming spec) turns *one hex value the adopter already knows* into a validated `theme.css`. This spec covers the step before that: the adopter's brand does not live in their head, it lives in **their own Figma file** — a brand book, a marketing site design, an existing product mockup. `mercato theme from-figma <file-url-or-key>` reads that file through the Figma REST API (`FIGMA_TOKEN` env, never committed), inventories brand signals — color candidates with usage counts, font families from text styles, the corner-radius distribution — and **proposes** a mapping onto the theming token contract (`--primary` family, `--brand-*`, `--radius`, font tokens). A designer confirms or corrects the mapping (interactive prompt by default; `--map` flags for scripted runs; `--report-only` to audit without writing), and the confirmed values flow through the **same** generation pipeline as `theme init` — identical OKLCH palette derivation, identical WCAG 2.1 contrast validation, identical hard failure below 4.5:1 for explicit text-on-primary pairs. Output is `theme.css` plus a markdown import report covering what was mapped, what was left over, and what to check next. The extraction lands in a small versioned JSON format (`candidates[]`, `styles[]`, `fonts[]`, `radii[]`) that the `figma-design-with-ds` skill's MODE B audit flow consumes too, so CLI and agent workflows read the same inventory. Core principle, stated once and enforced by design: **the machine inventories, the designer interprets** — which color is the action color and which is an identity accent is a human decision the tool never auto-finalizes.

## Overview

The theming spec drew the boundary (identity tokens vs semantic contracts), created the adopter-owned `theme.css` slot, and shipped a generator that derives a safe palette from confirmed inputs. What it deliberately left out is *acquisition*: getting the brand values out of the client's design source and into the generator's flags. Today that step is a human squinting at a Figma file, copying hexes into a terminal, and hoping the one they picked is the brand primary and not a hover tint that happens to appear more often.

This spec automates the inventory half of that step and formalizes the judgment half:

1. **Extraction** — a read-only Figma REST client that pulls published Variables when the plan allows, and falls back to local styles plus a solid-fill frequency analysis of top-level frames on any plan.
2. **Designer-in-the-loop mapping** — the tool ranks and proposes; a human assigns candidates to tokens. Three modes: interactive prompt (default), `--map` flags (CI/scripted), `--report-only` (audit).
3. **Generation** — reuse of the `theme init` pipeline (`palette.ts`, `contrast.ts`, the `theme.css` writer and `layout.tsx` anchor logic) so there is exactly one code path that produces themes, one set of derivation rules, and one contrast gate.
4. **Shared extraction format** — the intermediate JSON is a stable, versioned schema also consumed by the `figma-design-with-ds` skill (MODE B), keeping the CLI import and agent-driven design audits consistent.

Directionality, stated explicitly because a sibling spec runs the opposite way: [`2026-07-05-ds-tokens-figma-sync-and-code-connect.md`](2026-07-05-ds-tokens-figma-sync-and-code-connect.md) syncs **code → our Figma DS file** (`globals.css` is truth, the `OM Tokens` collection in `qCq9z6q1if0mpoRstV5OEA` mirrors it, pushes overwrite Figma). This spec reads **the client's Figma → code** (their brand file is the *input*, a human is the arbiter, and nothing is ever written back to their file — every Figma call here is a GET). The two tools share vocabulary (token names, the theming contract) but neither writes where the other reads; there is no loop to close.

## Problem Statement

1. **The brand source is a Figma file, not a hex value.** Real adopters onboarding onto Open Mercato arrive with a brand book or product design file, typically dozens of colors deep: one true primary, two or three accents, and fourteen grays that exist because five designers each added their own. `theme init --primary <hex>` assumes someone already did the archaeology. Nobody has tooling for the archaeology.
2. **Manual extraction is error-prone in a specific, recurring way.** Picking colors by eye from a Figma canvas conflates *frequency* with *role*: the most-used fill in a file is usually a background or divider gray, not the brand primary; the brand primary may appear on exactly one hero button. Any tool that auto-picks "the top color" would institutionalize this error — which is why mapping must stay human.
3. **The Variables API is not a universal answer.** The clean machine-readable source — published Figma Variables — sits behind the Variables REST API, which is **Enterprise-plan-gated** (same constraint the sync spec documents for the opposite direction). Most client files are on Professional or lower plans. A tool that only works with Variables would not work for the audience that needs it.
4. **Two workflows, one question, no shared answer.** The `figma-design-with-ds` skill's MODE B already audits client Figma files against the DS, and it re-derives "what colors/fonts/radii does this file actually use" from scratch every session, with no persistable artifact. The CLI import needs the same inventory. Without a shared format the two paths will disagree about the same file.

## Goals / Non-Goals

**Goals**
- One command that takes a client Figma file URL or key and ends with a validated `theme.css` plus an import report.
- Extraction that works on **any** Figma plan (Variables preferred, styles + fill-frequency fallback), read-only, `FIGMA_TOKEN` from the environment only.
- A mapping step that structurally cannot complete without explicit human input (prompt answers or `--map` values).
- Zero duplication of theme generation: `from-figma` feeds the `theme init` pipeline; the theming spec's palette derivation and WCAG 2.1 math (its "normative" section) apply verbatim and are referenced, not restated.
- A small versioned extraction JSON that both this command and the `figma-design-with-ds` skill (MODE B) consume.

**Non-Goals**
- Writing anything to the client's Figma file — no variable creation, no style edits, no comments. Strictly read-only.
- Importing a full multi-token theme (charts, sidebar, neutrals). The output surface is exactly the theming spec's safe-token table; everything else lands in the report as "unmapped".
- Syncing our DS tokens anywhere — that is the sync spec's job, in the opposite direction.
- Runtime/tenant-level theming, image/logo asset import, or typography *loading* (the theming spec already documents that font loading stays the adopter's responsibility).
- Watching the client file for changes. This is an on-demand import, re-runnable at will, not a pipeline.

## Dependencies

| Depends on | What is consumed | Coupling |
|---|---|---|
| [`2026-07-05-ds-theming-and-brand-customization.md`](2026-07-05-ds-theming-and-brand-customization.md) | The `theme.css` convention and adopter-owned file contract; the `theme` built-in CLI module registration; `palette.ts` (OKLCH derivation), `contrast.ts` (WCAG 2.1 normative math and thresholds), and the writer/`layout.tsx` anchor logic from `theme init` | Hard — this spec cannot ship first and adds no generation logic of its own |
| [`2026-07-05-ds-tokens-figma-sync-and-code-connect.md`](2026-07-05-ds-tokens-figma-sync-and-code-connect.md) | The token vocabulary/JSON modeling conventions, the `.ai/reports/` dated-artifact convention, the `FIGMA_TOKEN` env-only posture and plan-gating documentation pattern, and (workstream 3) the promoted `om-figma-design-with-ds` skill that hosts the MODE B schema reference | Soft — vocabulary and conventions reused; the skill reference doc waits for the promotion if orderings flip |

Nothing else in the repo depends on this spec; it is a leaf on the roadmap graph.

## Proposed Solution

### 1. Command surface

New subcommand of the `theme` CLI module introduced by the theming spec (same built-in registration in `packages/cli/src/mercato.ts`; the `theme` id is already in `BUILTIN_CLI_MODULE_IDS` once that spec ships):

```
mercato theme from-figma <file-url-or-key> [options]

  <file-url-or-key>            Figma URL (figma.com/design/<key>/… or /file/<key>/…) or bare file key
  --map <pairs>                non-interactive mapping, e.g. --map "primary=#0C71C6,radius=8px,font=Inter"
                               accepted keys: primary, primary-foreground, radius, font, font-mono
  --report-only                extract + write report and extraction JSON; never write theme.css
  --extract-json <path>        where to write the extraction JSON (default .ai/reports/figma-brand-extract-<key>.json)
  --report <path>              where to write the markdown report (default .ai/reports/figma-brand-import-<key>.md)
  --pages <names>              limit frame scanning to named pages (comma-separated; default: all)
  --out / --force / --dry-run  passed through to the theme init writer (same semantics, same defaults)
```

Exit codes: `0` success (warnings allowed), `1` validation failure — unreachable file, missing/invalid token, unparseable `--map` value, or a WCAG hard failure on an explicitly supplied pair (identical rule to `theme init`: explicit pairs fail below 4.5:1, auto-picked foregrounds warn). `--report-only` exits `0` even when candidates look unusable — an audit is not a failure.

Interactive mode is the default when stdin is a TTY and `--map` is absent. When stdin is not a TTY and `--map` is absent, the command degrades to `--report-only` behavior with a notice — it never guesses a mapping to avoid blocking, and never auto-finalizes one to avoid being wrong.

### 2. Extraction

Implementation in `packages/cli/src/lib/theme/figma-extract.ts`, dependency-free (Node ≥ 18 global `fetch`). Auth is `X-Figma-Token: $FIGMA_TOKEN`, read from the environment only — never a flag that would land in shell history files committed by dotfile-sync tools, never persisted into the extraction JSON or report (both artifacts are committed-adjacent; see Risks). Missing token fails fast with a message pointing at figma.com token settings and the required read scopes.

**Primary source — published Variables (plan-gated, attempted first):** `GET /v1/files/{key}/variables/local`. **Honest constraint, same as the sync spec documents:** the Variables REST API requires an Enterprise plan on the *file's* side and a token with `file_variables:read`. When the call returns 403/404 the extractor logs one informational line ("Variables API unavailable on this file's plan — falling back to styles + fill analysis") and continues; this is the expected path for most client files, not an error. When it succeeds, color/float variables become high-confidence candidates carrying their variable names (`variableName`), which the mapping prompt surfaces prominently — a variable literally named `brand/primary` is the strongest signal the file can give.

**Fallback source — works on any plan:**

- **Local styles:** `GET /v1/files/{key}/styles` for the style index, then `GET /v1/files/{key}/nodes?ids=<style-node-ids>` (batched) to resolve values. Fill styles yield named color candidates (`styleNames`); text styles yield font families, weights, and sizes.
- **Fill frequency analysis:** `GET /v1/files/{key}?depth=2` to enumerate pages and their top-level frames, then `GET /v1/files/{key}/nodes?ids=…` for those frames (batched, bounded — see budget below) and a recursive walk counting **solid** fills and strokes on FRAME/RECTANGLE/ELLIPSE/VECTOR/TEXT/COMPONENT/INSTANCE nodes. Image fills, gradient fills, and fills with opacity < 1 are excluded from candidate ranking (recorded in the JSON with `excluded: "image" | "gradient" | "alpha"` counts so the report can say what was skipped) — a photo-heavy marketing page must not out-vote the brand palette. Corner radii (`cornerRadius` / `rectangleCornerRadii`) are histogrammed the same way.

**Traversal budget:** node fetches are batched (≤ 50 ids per `nodes` call), the walk stops at a configurable node budget (default 20,000 nodes) and records `truncated: true` with per-page counts when hit. 429 responses honor `Retry-After` with a maximum of three retries per request. The goal is a representative inventory of a design file in seconds, not a census of a ten-year-old archive.

**Candidate ranking** (for prompt ordering only — ranking is presentation, never decision): variable-backed candidates first, then style-backed, then raw fills by descending usage count; within each tier, higher chroma sorts above near-grays so the fourteen grays sink to the bottom where they belong. Every candidate keeps its evidence (`count`, `sources`, `styleNames`, `variableName`) so the human sees *why* it ranked where it did.

### 3. Mapping — designer-in-the-loop by design

The mapping step assigns extracted candidates to the theming spec's safe-token surface: `--primary` (plus derived `--primary-hover`/`--primary-foreground`), optional `--radius`, optional font tokens. `--brand-lime` stays theme-invariant per the theming contract; `--brand-violet` remains out of v1 mapping scope (report-only mention when the file has a plausible secondary accent). The generator, unchanged from `theme init`, structurally cannot emit protected tokens.

**Interactive prompt (default):** prints the ranked candidate table (hex, usage count, names, tier), then asks, in order: (1) "Which color is your **action** color — the one primary buttons and links use?" with numbered selection or free-hex entry; (2) optional explicit `primary-foreground` (default: auto-pick per the theming spec); (3) radius, defaulting to the histogram's dominant bucket *displayed as a suggestion the user must still confirm*; (4) font family from the extracted list or free entry, with the theming spec's reminder that loading the font file is on them. Every question allows "skip" (keep framework default). Nothing proceeds to generation until the primary is explicitly chosen. Shape of the interaction:

```
Brand color candidates from "Acme Brand Book" (41 frames scanned):

  #  Hex       Uses  Evidence
  1  #0c71c6    148  style "Brand/Primary", fills on frames + text
  2  #f2653a     61  style "Brand/Coral", fills on frames
  3  #1a1a2e    412  fills on frames (near-black; likely text/background)
  4  #e5e5e5    903  strokes on frames (near-gray; likely borders)
  … 14 more (near-grays collapsed — show with "all")

Which color is your ACTION color — the one primary buttons and links use?
(number, hex, or "skip"): 1
```

The tool never preselects an answer; an empty response re-asks rather than assuming.

**`--map` flags (CI/scripted):** the human decision, made earlier, encoded as flags. Values are validated against the extraction (a `--map primary=` hex that never appears in the file produces a *warning*, not a failure — brand books sometimes intentionally differ from design files) and then passed to the pipeline exactly as if typed at the prompt.

**`--report-only`:** the inventory without the interview. Writes the extraction JSON and the markdown report, touches nothing else. This is the mode the onboarding checklist and the skill's audit flow use first.

The principle worth restating as a hard design rule, because every future "improvement" will be tempted to violate it: **the machine inventories, the designer interprets.** Frequency, chroma, and even a variable named `primary` are evidence, not verdicts — files lie, naming conventions vary, and the cost of a wrong auto-pick (a whole product tinted with a divider gray) vastly exceeds the cost of one prompt question. The tool must never ship a code path that finalizes a token assignment without explicit human input carried via prompt answer or `--map` value.

### 4. Generation and the import report

Confirmed values enter the **same pipeline** as `mercato theme init`: `palette.ts` derives `--primary-hover`, auto-picks `--primary-foreground` where not explicit, and emits the `.dark` block per the theming spec's OKLCH rules; `contrast.ts` applies that spec's normative WCAG 2.1 math and thresholds (4.5:1 hard fail on explicit text pairs, 3:1 warning on non-text UI pairs) — this spec adds **no** derivation or contrast logic of its own, and any future change to those rules automatically applies to both commands. The writer and the `layout.tsx` import-anchor handling are likewise reused, including `--force`/`--dry-run` semantics and the existing-app adoption behavior.

Alongside `theme.css`, the command always writes a markdown import report (`.ai/reports/` — dated working artifact per the sync spec's convention, regenerated on demand, not a source of truth):

1. **Source summary** — file key/name, extraction date, which sources were available (Variables vs fallback), scan coverage (pages, frames, truncation).
2. **Mapped values** — token, chosen value, evidence (candidate rank, usage count, style/variable name), and the derived values the pipeline computed from it.
3. **Contrast results** — every checked pair with its ratio and verdict, verbatim from the shared contrast reporter.
4. **Unmapped candidates** — the leftovers, ranked, with counts: the fourteen grays, secondary accents, illustration palettes. Explicitly framed as "not imported, by design" with a pointer to the theming docs page for manual advanced overrides.
5. **Suggested next steps** — load the font, review the generated `.dark` block against the client's dark-mode designs if any exist, re-run with `--report-only` after the client updates their file, run MODE B of the design skill for a full screen-level audit.

### 5. Shared extraction format — integration with `figma-design-with-ds` (MODE B)

The extraction JSON is a stable, versioned interchange format, not a private cache. Schema (authoritative shape in Data Models): a `schema` identifier (`om-figma-brand-extract@1`), file metadata, source availability flags, and four arrays — `candidates[]`, `styles[]`, `fonts[]`, `radii[]`.

Consumers:

- **This command** writes it on every run and can re-read it via `from-figma --extract-json <path>` pointed at an existing file with a matching key (skip re-fetching; useful for iterating on mapping without hammering the API).
- **The `figma-design-with-ds` skill, MODE B** (audit existing designs — `references/audit-existing-design-prompt.md`): the audit prompt gains an optional "attach the extraction JSON" input. With it, the auditing agent grounds its "colors used in this file" claims in the same counted inventory the CLI saw, instead of re-deriving them visually from screenshots — so the audit's violation list and the import report's unmapped-candidates list agree about the same file. The skill update itself (one reference-file addition documenting the schema and the attach step) rides along with the skill's promotion to `om-figma-design-with-ds` defined in the sync spec, workstream 3.

Compatibility rule: additive fields only within `@1`; any breaking change bumps to `@2` and both consumers must state which versions they accept. A fixture-based test in the CLI package pins the schema so accidental shape drift fails CI before it desynchronizes the skill.

## Architecture

New and touched files (all additive):

| File | Change |
|---|---|
| `packages/cli/src/lib/theme/from-figma.ts` | New — command entry: URL/key parsing, mode selection (interactive / `--map` / `--report-only`), prompt flow, orchestration |
| `packages/cli/src/lib/theme/figma-extract.ts` | New — REST client (Variables attempt, styles, bounded frame walk), candidate ranking, extraction JSON writer/reader |
| `packages/cli/src/lib/theme/brand-report.ts` | New — markdown import report renderer |
| `packages/cli/src/lib/theme/{palette,contrast,init}.ts` | **Reused, unchanged** — from the theming spec; `init.ts`'s writer/anchor logic is factored for call-site reuse if not already |
| `packages/cli/src/lib/theme/__tests__/` | New fixtures/tests: recorded (sanitized) Figma API payloads, ranking, exclusion rules, `--map` parsing, schema pin, report snapshot |
| `packages/cli/src/mercato.ts` | `from-figma` registered under the existing `theme` built-in module — no new module id |
| `apps/docs/docs/customization/brand-your-app.mdx` | New section "Importing your brand from Figma" (command reference, plan-gating note, report walkthrough) |
| `.ai/skills/om-figma-design-with-ds/references/` | New reference doc for the extraction schema + MODE B attach step (lands with/after the sync spec's skill promotion) |

Flow:

```
<file-url-or-key> ── parse key
        │
        ▼ GET (FIGMA_TOKEN env, read-only)
  variables/local ──403/404──▶ styles + nodes (batched, budgeted frame walk)
        │                            │
        └──────────┬─────────────────┘
                   ▼
  extraction JSON  (om-figma-brand-extract@1) ──▶ .ai/reports/… ──▶ figma-design-with-ds MODE B
                   │
                   ▼ human decision (prompt | --map)     [--report-only stops here]
  confirmed mapping
                   ▼
  theme init pipeline (palette.ts → contrast.ts → theme.css writer)   ← unchanged, shared
                   │
                   ├──▶ src/app/theme.css (+ layout.tsx anchor, per theming spec)
                   └──▶ markdown import report (.ai/reports/…)
```

The command needs no database, DI container, or env bootstrap beyond `FIGMA_TOKEN`; like `theme init` it must remain runnable in a freshly scaffolded standalone app (compiled `dist/` path per `packages/cli/AGENTS.md` standalone considerations).

## Data Models

No database entities, migrations, or persisted server state. One versioned file artifact:

```jsonc
// om-figma-brand-extract@1 (excerpt)
{
  "schema": "om-figma-brand-extract@1",
  "file": { "key": "AbCdEf123", "name": "Acme Brand Book", "lastModified": "2026-07-01T09:30:00Z", "extractedAt": "2026-07-07T14:12:03Z" },
  "source": {
    "variables": "unavailable-plan-gated",        // "ok" | "unavailable-plan-gated" | "error"
    "styles": "ok",
    "frames": { "pagesScanned": 3, "framesScanned": 41, "nodesVisited": 12480, "nodeBudget": 20000, "truncated": false },
    "excluded": { "image": 214, "gradient": 12, "alpha": 89 }
  },
  "candidates": [
    { "hex": "#0c71c6", "count": 148, "tier": "style", "sources": ["fill:frame", "fill:text", "style"], "styleNames": ["Brand/Primary"], "variableName": null },
    { "hex": "#e5e5e5", "count": 903, "tier": "fill", "sources": ["stroke:frame"], "styleNames": [], "variableName": null }
  ],
  "styles": [ { "type": "FILL", "name": "Brand/Primary", "hex": "#0c71c6" }, { "type": "TEXT", "name": "Heading/H1", "fontFamily": "Inter", "fontWeight": 600, "fontSize": 32 } ],
  "fonts": [ { "family": "Inter", "weights": [400, 500, 600], "textStyles": 12, "usageCount": 3100 } ],
  "radii": [ { "px": 8, "count": 96 }, { "px": 999, "count": 14 } ]
}
```

Invariants: keys sorted, deterministic serialization (re-extracting an unchanged file yields identical bytes apart from `extractedAt`), hex lowercased, no credentials or requester identity anywhere in the artifact, `schema` checked by every reader before use.

## API Contracts

No HTTP API, event, DI, ACL, or module contract surfaces change. Per `BACKWARD_COMPATIBILITY.md` §13 (CLI Commands): `theme from-figma` and its flags are additive and become STABLE once shipped, joining the `theme init` surface from the theming spec. External APIs *consumed* (all read-only GETs): Figma REST `files/{key}`, `files/{key}/nodes`, `files/{key}/styles`, `files/{key}/variables/local`. The extraction JSON schema `om-figma-brand-extract@1` is a new versioned interchange contract between the CLI and the design skill — additive-only within a major version, as stated above.

## Migration & Backward Compatibility

- **Purely additive CLI subcommand.** No existing command, flag, type, import path, route, or schema changes. `theme init` behavior is byte-identical; `from-figma` is a second front door into the same pipeline.
- **Dependency:** requires the theming spec's deliverables (`theme.css` convention, `theme init` pipeline — `palette.ts`, `contrast.ts`, writer/anchor logic — and the WCAG library). This spec must not land first; if the theming spec's internals shift during its implementation, this spec's reuse points adjust in review, not via bridges.
- **Reuse, not duplication, of the sync spec:** the token vocabulary and the `.ai/reports/` artifact convention come from [`2026-07-05-ds-tokens-figma-sync-and-code-connect.md`](2026-07-05-ds-tokens-figma-sync-and-code-connect.md); no snapshot format is shared because the two tools model different things (our token contract vs a client file inventory). The skill-facing reference doc lands against the promoted `om-figma-design-with-ds` skill from that spec's workstream 3; if this ships first, the doc waits in this branch until the promotion merges.
- **No deprecations, no data migrations, no behavior change** for any app that never runs the command.

## Risks & Impact Review

| Risk | Concrete failure scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|
| Frequency analysis crowns the wrong color | The most-used solid fill is a divider gray or illustration accent; a hurried user picks candidate #1 at the prompt and ships a gray-tinted product | Medium | Ranking de-prioritizes near-grays and image/gradient/alpha fills; the prompt asks for the *action* color in plain words, never preselects; evidence columns show why each candidate ranked; the contrast gate catches the worst outcomes (light grays fail text checks) | Low — a human confirming a wrong answer is a judgment error the report makes visible and re-running fixes |
| Variables API plan gating misread as breakage | User has a Variables-rich file on a Professional plan, sees the fallback notice, files a bug or assumes the tool is broken | Medium | The 403/404 path is a single calm informational line naming the plan constraint (mirroring the sync spec's honest-constraint posture); docs section states it up front; extraction quality on the fallback path is the *designed* primary path, not a degraded one | Low |
| `FIGMA_TOKEN` leakage | Token pasted into `--map`-style flags, or echoed into the report/extraction JSON which then gets committed | High | Token is env-only by contract — no flag accepts it; serializers structurally never see the token (it lives only in the request-header closure); a unit test asserts neither artifact ever contains the env value; docs repeat the never-commit rule | Low |
| Huge or hostile files | A 500k-node archive file causes multi-minute runs, memory spikes, or 429 storms against the Figma API | Medium | Depth-limited page listing, batched node fetches, hard node budget with `truncated: true` reporting, `--pages` narrowing, Retry-After-honoring backoff with bounded retries | Low — a truncated inventory is still a ranked inventory; the report says what was skipped |
| Extraction schema drift desynchronizes the skill | A field rename in the CLI silently breaks MODE B audits that attach the JSON, producing confidently wrong audit claims | Medium | `schema` version string checked by all readers; fixture test pins `@1` shape in CI; additive-only rule within a major; the skill reference doc lists accepted versions | Low |
| Mapping automation creep | A future PR adds "smart" auto-selection (top candidate, or trusting a variable named `primary`) to skip the prompt, reintroducing the exact error class this spec exists to prevent | Medium | The design rule is stated normatively in this spec and in the command's header comment; non-TTY without `--map` degrades to report-only rather than guessing — reviewers have a written contract to point at | Medium — process guard only; tooling cannot forbid future code |
| Hard contrast failure blocks a legitimate brand | Client's mandated primary is mid-luminance; explicit `--map primary-foreground` fails 4.5:1 and CI-scripted imports exit 1 | Low | Identical semantics to `theme init` (inherited, not new): auto-pick warns instead of failing, the failure message suggests the passing foreground, `--report-only` lets teams see ratios before committing to a mapping | Low — this is the gate working as specified |
| Blended/effective colors misread | Fills under opacity, blend modes, or overlapping layers render differently than their raw hex; the imported primary doesn't match what the designer *sees* | Low | Non-opaque fills are excluded from ranking and counted in `excluded.alpha`; the report notes the exclusion; the designer confirms against their own file knowledge — the human in the loop is also the rendering oracle | Low |

Impact on existing behavior: none. All risk is confined to explicit invocations of the new command; no runtime path, template file, or existing CLI behavior is touched.

## Validation Plan

1. **Unit — URL/key parsing** (`from-figma` entry): `figma.com/design/<key>/name`, `/file/<key>`, bare keys, query-string noise, rejection of non-Figma URLs with an actionable message.
2. **Unit — extraction** (`figma-extract`): recorded, sanitized fixture payloads for `variables/local` (success + 403), `styles`, `files?depth=2`, and `nodes` batches; assertions on candidate counting, tier assignment, near-gray demotion, image/gradient/alpha exclusion tallies, radius histogram, node-budget truncation flag, and 429/Retry-After backoff (fake timers).
3. **Unit — schema pin**: serialized extraction matches the committed `om-figma-brand-extract@1` fixture byte-for-byte (minus `extractedAt`); determinism across repeated serialization.
4. **Unit — mapping**: `--map` parsing (valid pairs, unknown keys rejected, malformed hex exits 1), not-in-file warning path, non-TTY degradation to report-only.
5. **Unit — no-leak**: with `FIGMA_TOKEN` set to a sentinel, assert the sentinel appears in no written artifact.
6. **CLI e2e (tmp dir, mocked fetch)**: full run from fixture file to `theme.css` + report; verify the generated `theme.css` is byte-identical to `theme init` invoked with the same confirmed values (the single-pipeline guarantee); `--report-only` writes exactly two artifacts; `--dry-run`/`--force` inherited semantics.
7. **Report snapshot**: markdown report for the fixture file, including unmapped-candidates and truncation sections.
8. **Manual QA (needs-qa)**: run against a real client-style Figma file on a non-Enterprise plan (fallback path) and, where available, an Enterprise file (Variables path); confirm prompt flow, report readability, and that the resulting app renders correctly in light and dark mode with status colors and selection controls unchanged.
9. **Docs**: `apps/docs` builds; the new section's commands copy-paste clean against a fresh scaffold with a real token.
10. **Monorepo checks**: `yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn workspace @open-mercato/cli test`.

Integration coverage note: no API or UI runtime paths change; the mocked-fetch e2e plus unit fixtures are the executable coverage, and the real-file manual QA is evidenced with the generated report attached to the implementation PR.

## Final Compliance Report

- Contract surfaces: untouched; one additive CLI subcommand under the existing `theme` module (BC §13 compliant). PASS
- Secrets policy: `FIGMA_TOKEN` environment-only, never in flags, artifacts, or fixtures; plan gating documented rather than worked around; all Figma access read-only. PASS
- Design System rules: output confined to the theming spec's safe-token surface via the shared generator; protected semantic tokens structurally unreachable; no hardcoded colors introduced into any component. PASS
- Tenancy/security: no runtime code paths, no tenant data, no new API routes or DB access. PASS
- i18n: CLI output and reports are developer tooling (English, consistent with existing CLI messages); docs in English per docs convention. PASS
- Single-pipeline guarantee: no palette or contrast math added or duplicated — the theming spec's normative rules govern both commands. PASS

## Changelog

- **2026-07-07** — Initial spec: `mercato theme from-figma` client-brand import — plan-aware Figma REST extraction (Variables with styles + fill-frequency fallback), designer-in-the-loop mapping (interactive / `--map` / `--report-only`), generation through the shared `theme init` pipeline with inherited WCAG gates, markdown import report, and the versioned `om-figma-brand-extract@1` JSON shared with the `figma-design-with-ds` MODE B audit flow. Item 6 of the DS DX roadmap, extending the theming spec (item 3).
