# Official Modules Generated Registry — Location Decision

**Date:** 2026-05-19
**Status:** Decided — keep current placement; docs-only follow-up
**Scope:** OSS — `apps/mercato/src/official-modules.generated.ts`, the `official-modules.json` activation flow, related docs/AGENTS guidance
**Author:** Open Mercato Team
**Related:** PR [open-mercato/open-mercato#1908](https://github.com/open-mercato/open-mercato/pull/1908) (introduced the file), PR [open-mercato/open-mercato#1965](https://github.com/open-mercato/open-mercato/pull/1965) (carry-forward of #1945 that taught the `create-app` template to ship the same file), `apps/docs/docs/framework/modules/official-modules-development.mdx`, root `AGENTS.md` → *Generated Files: versioned vs ephemeral*

## TLDR

**Key Points:**
- `apps/mercato/src/official-modules.generated.ts` MUST stay where it is — in `apps/mercato/src/`, committed to git, not under any `generated/` folder.
- Moving it into `apps/mercato/.mercato/generated/` or `apps/mercato/src/generated/` would gitignore it AND make `yarn clean-generated` delete it, silently destroying the activation set.
- Inlining its contents into `apps/mercato/src/modules.ts` would force the `yarn official-modules` CLI to do AST surgery on a hand-curated file (env gates, enterprise toggles, comments) and is rejected.
- The convention is documented explicitly in root `AGENTS.md` and `official-modules-development.mdx`, and reinforced in the generated file's banner.

**Scope:**
- a single-decision record for one specific file
- documentation alignment so the question doesn't get re-raised every time someone first sees the file
- guard rails (links from AGENTS.md, docs callout, banner comment) so a future contributor can't accidentally "fix" it by moving it

**Out Of Scope:**
- changing `.gitignore` or `scripts/clean-generated.sh`
- introducing a third "committed-but-generated" folder convention
- redesigning `official-modules.json` / the activation CLI
- the external `open-mercato/official-modules` repo workflow ([2026-03-20-official-modules-platform-sync-playbook.md](./2026-03-20-official-modules-platform-sync-playbook.md) already owns that)

## Overview

PR #1908 introduced an opt-in git submodule at `external/official-modules/` and a generated TypeScript registry at `apps/mercato/src/official-modules.generated.ts` consumed by `apps/mercato/src/modules.ts`. PR #1965 carried forward PR #1945's fix to also ship that file in the `packages/create-app/template/` scaffold so freshly-scaffolded apps don't fail with an unresolved import.

Each time a contributor sees a `*.generated.ts` file sitting in `src/` they reasonably ask: *why isn't this in the `generated/` folder where the rest of the generated code lives?* The answer is non-obvious enough that it has now come up twice and needs a durable record.

This spec captures the analysis behind keeping the file in `src/`, the options that were considered and rejected, and the documentation updates that go with the decision.

> **Market Reference:** Modeled after the established split most JS monorepos already use — `.gitignore`'d build output (Next.js `.next/`, Turborepo `.turbo/`, `dist/`, generated TypeScript from OpenAPI schemas) vs. committed code-gen registries (Prisma's `schema.prisma`-derived client kept in `node_modules/.prisma/client` but with a typed shim committed; `Cargo.lock`; Bazel's checked-in `BUILD.bazel` files). Adopted: a clear `*.generated.ts`-next-to-source pattern for "machine-written but source-of-truth" data. Rejected: a single `generated/` folder for both ephemeral and committed output (collapses two very different lifecycles).

## Problem Statement

Without a documented decision and matching guard rails, this happens every few months:

1. A contributor opens `apps/mercato/src/official-modules.generated.ts`, sees the `// AUTO-GENERATED` banner, and assumes it's misplaced.
2. They propose moving it to `apps/mercato/.mercato/generated/` "to match the other generated files".
3. Reviewers either spend cycles re-deriving the analysis from scratch, or worse, the move lands and the next person to run `yarn clean-generated` (or a fresh clone) loses the team's `activated` set.

There are three concrete failure modes if the move happens:

1. **Activation state is wiped on clean.** `scripts/clean-generated.sh` runs `find . -type d -name 'generated' -exec rm -rf {} +` and `find . -type d -name '.mercato' -exec rm -rf {} +`. Any file inside either pattern is deleted unconditionally.
2. **Activation state never reaches new clones.** `.gitignore` lines 62–70 silently mark `/src/generated/`, `/generated/`, `packages/*/generated/`, and `.mercato` as untracked. A `git add` of a file in any of those paths is a no-op; nobody else gets the change.
3. **Single source of truth fragments.** `official-modules.json` is the committed config, but its consumer (`modules.ts`) imports the typed `ModuleEntry[]` from the generated file. If the generated file is unreliable, downstream code either silently runs with an empty official-module list (no error, just behavior gone) or developers start hand-editing `modules.ts` to compensate, defeating the CLI.

The current placement avoids all three failure modes, but it looks unusual at first glance — which is precisely why a documented decision is needed.

## Proposed Solution

Keep the file at `apps/mercato/src/official-modules.generated.ts`. Reinforce the decision in three places so the question stops getting re-raised:

1. **Root `AGENTS.md`** — a new *Generated Files: versioned vs ephemeral* subsection that distinguishes the two categories of generated files, names the canonical examples on each side, and explains why collapsing them into one folder is unsafe. The existing "Generated files: `apps/mercato/.mercato/generated/` — never edit manually" line and the "MUST NOT add code directly in `apps/mercato/src/`" rule both link to the new subsection so the carve-out is visible from both sides.
2. **`apps/docs/docs/framework/modules/official-modules-development.mdx`** — an `:::info Why does the generated file live in `src/` instead of `.mercato/generated/`?` callout right under the Config files table, with a link to this spec.
3. **`scripts/lib/official-modules.mjs#renderGenerated`** — extend the auto-generated banner inside `official-modules.generated.ts` itself to point at this spec, so any contributor who opens the file gets the explanation in-place.

### Design Decisions

| Decision | Rationale |
|---|---|
| Keep `apps/mercato/src/official-modules.generated.ts` exactly where it is | Matches the established `*.generated.ts`-in-`src` pattern; survives both `.gitignore` and `yarn clean-generated`; already wired into `modules.ts` and `scripts/template-sync.ts` `SYNC_ROOT_FILES`. |
| Document the two-bucket model rather than introduce a third | Adding a third "committed generated" folder would itself create the next round of confusion ("is this file in bucket 2 or bucket 3?") and require changes to `.gitignore`, `clean-generated.sh`, and every package's expectations. The two-bucket model already exists in code; it just isn't named. |
| Reinforce at the file-banner level | The most likely contributor to ask "should this move?" is the one who just opened the file. Putting the answer in the banner short-circuits the question. |
| Treat this as a single-file ADR rather than a sweeping convention spec | This decision is specifically about `official-modules.generated.ts` because that's the file the question keeps surfacing on. The general pattern is documented in `AGENTS.md`; the spec records the specific decision for the specific file. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Move to `apps/mercato/.mercato/generated/` | `.mercato` is gitignored (`.gitignore` line 70). `clean-generated.sh` runs `find -name .mercato -exec rm -rf`. The activation set would not survive either a clean or a fresh clone. Destroys the single source of truth. |
| Move to `apps/mercato/src/generated/official-modules.generated.ts` | `.gitignore` lines 62–63 (`/src/generated/`) make the file untracked. Same failure modes as above. |
| Carve out a new `apps/mercato/generated/` folder that is explicitly NOT gitignored and explicitly NOT wiped | Requires editing `.gitignore` (a negative exception line) AND editing `clean-generated.sh` (skip-this-path branch) AND coordinating a migration of all existing committed `*.generated.ts` files. Pure overhead for zero functional gain — `*.generated.ts` next-to-source already does the same job with fewer moving parts and less risk of someone re-introducing the wipe pattern. |
| Inline contents into `apps/mercato/src/modules.ts` | `modules.ts` is curated by humans — it has env gates (`OM_ENABLE_STORAGE_S3`, `OM_ENABLE_ENTERPRISE_MODULES`), conditional blocks, in-source comments, an `enabledModules` array authored by hand, and per-app overrides. `yarn official-modules add/remove` would have to AST-edit that file, which is fragile against user edits and weakens diff review by mixing machine-written and hand-written content. |
| Status quo with no documentation | Leaves the question to re-emerge every six months. The cost of one docs PR is far less than the cost of the recurring conversation, plus the catastrophic cost of the move actually landing. |

## User Stories / Use Cases

- **Module maintainer** opens `official-modules.generated.ts` to investigate a build error and immediately sees in the banner why the file is where it is.
- **New contributor** asks in a PR review "should this be under `.mercato/generated/`?" — the reviewer points at this spec instead of re-deriving the analysis.
- **Coding agent** asked to "tidy up generated files" reads `AGENTS.md` first, sees the two-bucket model, and does not propose the move.

## Architecture

No code architecture changes. The file layout is exactly as PR #1908 + PR #1965 left it:

```
open-mercato/
├── official-modules.json                              # committed; team default activation
├── official-modules.local.json                        # gitignored; per-developer override
├── apps/
│   └── mercato/
│       └── src/
│           ├── modules.ts                             # imports ./official-modules.generated
│           └── official-modules.generated.ts          # committed; rewritten by scripts/lib/official-modules.mjs
└── packages/
    └── create-app/
        └── template/
            └── src/
                ├── modules.ts                         # mirrored by scripts/template-sync.ts
                └── official-modules.generated.ts      # mirrored by scripts/template-sync.ts (PR #1965)
```

Reinforcement surfaces (no code change beyond the banner):

| Surface | Change |
|---|---|
| `AGENTS.md` (root, *Module Development Quick Reference*) | New subsection *Generated Files: versioned vs ephemeral* |
| `AGENTS.md` (root, *Where to Put Code*) | Existing "MUST NOT add code in `apps/mercato/src/`" gets a narrow exception note that links to the new subsection |
| `AGENTS.md` (root, *Key Rules*) | Existing "Generated files: `apps/mercato/.mercato/generated/`" line replaced by a two-bullet split with link to the new subsection |
| `apps/docs/docs/framework/modules/official-modules-development.mdx` | `:::info` callout under the Config files table |
| `scripts/lib/official-modules.mjs#renderGenerated` | Banner extended with a one-line pointer to this spec |
| `apps/mercato/src/official-modules.generated.ts` | Refreshed banner |

## Data Models

N/A. No persisted data; no ORM entities; no migration.

## API Contracts

N/A. No public-API or HTTP contract changes. The TypeScript export shape of `official-modules.generated.ts` (`export const officialModuleEntries: ModuleEntry[]`) is unchanged. The `scripts/__tests__/official-modules.test.mjs` regex assertion on `renderGenerated([])` still matches after the banner edit because the change is additive within the comment header, not in the export.

## Configuration

No configuration changes. `.gitignore`, `scripts/clean-generated.sh`, `official-modules.json`, `official-modules.local.json`, and the `yarn official-modules` CLI all behave exactly as before.

## Migration & Compatibility

No migration. No backward-compatibility concern. The file does not move. The export shape does not change. Downstream code keeps working.

If a future spec decides to *actually* move the file, the migration plan must:

1. Carve out a new gitignore exception (or a brand-new folder pattern) that is BOTH committed AND skipped by `clean-generated.sh`.
2. Update `scripts/lib/official-modules.mjs`'s `GENERATED_PATH` constant in lockstep with `apps/mercato/src/modules.ts`'s import path and `scripts/template-sync.ts`'s `SYNC_ROOT_FILES`.
3. Provide a backward-compatibility shim re-export (per the project's deprecation protocol) for at least one minor version so external apps using their own templated `modules.ts` don't break.
4. Coordinate the same move for *all* committed `*.generated.ts` files at once — partial migration leaves the convention split across files, which is worse than either state.

## Implementation Plan

### Phase 1 — Document the convention

1. Add *Generated Files: versioned vs ephemeral* subsection to root `AGENTS.md`. Cross-link from the existing *Where to Put Code* and *Key Rules* sections.
2. Add the `:::info` callout in `official-modules-development.mdx` under the Config files table.
3. Write this spec.

### Phase 2 — Reinforce at the point of confusion

1. Extend the banner in `scripts/lib/official-modules.mjs#renderGenerated` with a one-line pointer to this spec.
2. Re-run the writer (or invoke `writeGenerated([])` from the CLI's no-op path) so the committed `apps/mercato/src/official-modules.generated.ts` banner picks up the new wording. Commit the refreshed file.

### Phase 3 — Validation

1. Run the targeted test: `node --test scripts/__tests__/official-modules.test.mjs` — confirm the banner regex still matches.
2. Run the full validation gate per `auto-create-pr` step 7.

### Testing Strategy

- The existing `scripts/__tests__/official-modules.test.mjs` regression asserts the exact empty-array shape of `renderGenerated([])`. Re-run it after the banner change.
- Manual smoke: run `yarn official-modules sync` and verify the regenerated file's banner contains the new pointer.
- No new unit tests are added — this is a docs-and-banner change, not a behavior change.

## Risks & Impact Review

### Data Integrity Failures

No data writes are involved. No application or database state is touched.

### Cascading Failures & Side Effects

#### Banner change breaks the `renderGenerated([])` regex assertion
- **Scenario:** the test in `scripts/__tests__/official-modules.test.mjs` asserts `assert.match(renderGenerated([]), /export const officialModuleEntries: ModuleEntry\[\] = \[\n\]\n$/)`. If the banner edit accidentally appends content *after* the export, the regex anchor `$` stops matching.
- **Severity:** Low (caught immediately by the test)
- **Affected area:** CI gate; the official-modules unit-test job
- **Mitigation:** the proposed banner change is *prepended* in the comment header, not appended after the export, so the regex still matches. Re-run the test before merging.
- **Residual risk:** Low.

#### Docs link rot
- **Scenario:** the new MDX callout links to this spec by GitHub URL; if the spec moves directory (e.g. into `.ai/specs/implemented/`) the docs link 404s.
- **Severity:** Low
- **Affected area:** docs site
- **Mitigation:** `.ai/specs/AGENTS.md` says to use `git mv` to preserve history when promoting a spec to `implemented/`. The docs link should be updated in the same commit. A follow-up CI rule could detect missing `.ai/specs/*.md` referenced from docs.
- **Residual risk:** Low.

### Tenant & Data Isolation Risks

None. No multi-tenant runtime behavior is involved.

### Migration & Deployment Risks

None. No deployment, no migration, no schema change.

### Operational Risks

#### Future contributor still proposes the move
- **Scenario:** despite the documentation, a contributor opens a PR that moves the file.
- **Severity:** High if it lands (loses the activation set on `clean-generated`); Low if caught in review.
- **Affected area:** all development environments and CI
- **Mitigation:** the in-file banner in `official-modules.generated.ts` itself points at this spec. The `AGENTS.md` *Where to Put Code* rule explicitly carves out the `*.generated.ts` exception with a link. A coding agent invoked on a "tidy up generated files" task is required to read AGENTS.md first per the project's own conventions.
- **Residual risk:** Medium — human reviewers and agents can still ignore the docs. Acceptable; the cost of further hardening (e.g. a CI rule that fails the build if `official-modules.generated.ts` moves) exceeds the benefit.

## Final Compliance Report — 2026-05-19

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `apps/docs` (no AGENTS.md applicable to MDX content)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `.ai/specs/AGENTS.md` | New OSS specs use `{date}-{title}.md` in `.ai/specs/` | Compliant | Filename: `2026-05-19-official-modules-generated-location-decision.md` |
| `.ai/specs/AGENTS.md` | Non-trivial specs include required sections | Compliant | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models (N/A), API Contracts (N/A), Risks & Impact Review, Final Compliance Report, Changelog all present |
| `AGENTS.md` (root) | Check existing specs before significant architecture changes | Compliant | Reviewed `2026-03-20-official-modules-platform-sync-playbook.md`, `SPEC-062-2026-03-13-official-modules-development-monorepo.md`, `SPEC-061-2026-03-13-official-modules-lifecycle-management.md` |
| `AGENTS.md` (root) → Backward Compatibility | Generated files are a contract surface | Compliant | This spec changes neither the file's path nor its export shape; backward compatibility is preserved by construction |
| `AGENTS.md` (root) → Doc-only no-test exemption | Docs-only runs still run the relevant check | Compliant | The targeted `official-modules.test.mjs` regression covers the only piece of code (`renderGenerated`) that gets touched |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| All proposed surfaces actually exist on `develop` | Pass | `AGENTS.md`, `official-modules-development.mdx`, `scripts/lib/official-modules.mjs` all verified |
| Banner-edit + regex compatibility | Pass | Edit is in the comment header, not after the export — regex anchor preserved |
| Cross-links resolve | Pass | AGENTS.md anchor `#generated-files-versioned-vs-ephemeral` and MDX link to GitHub raw URL both verified post-write |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

### 2026-05-19
- Initial spec recording the decision to keep `apps/mercato/src/official-modules.generated.ts` in `src/` rather than moving it into a `generated/` folder or inlining it into `modules.ts`. Triggered by PR #1965's surfacing of the question.
