# Execution Plan — Standalone harness improvements from session share #5251

Source doc: analysis comment on issue #5251 (https://github.com/open-mercato/open-mercato/issues/5251#issuecomment-5280139353), derived from the shared Kimi Code CLI session `library-books-spec-session`.

## Goal

Land the low-risk, text-level improvements to the create-app standalone agent harness that the #5251 session analysis identified: kill the routed-but-uninstalled-skill search detour, warn agents that generated module fact-sheets can exceed one read-tool cap, bake the Reference Display Rule (names, never raw UUIDs) into the spec template and backend-ui guide, and remove the `surface-inventory.json` location guess in `om-module-scaffold`.

## Scope

- `packages/create-app/template/AGENTS.md` and `packages/create-app/agentic/shared/AGENTS.md.template` (kept byte-for-byte in sync apart from the title line, per create-app AGENTS.md rule 8; the scaffolded root has a 12 KiB budget enforced by `agent-instruction-budget.test.ts` — additions must stay compact).
- `packages/create-app/agentic/shared/ai/specs/SPEC-000-template.md` (UI and Interaction Contracts section).
- `packages/create-app/agentic/guides/backend-ui.md`.
- `packages/create-app/agentic/shared/ai/skills/om-module-scaffold/SKILL.md`.

The CLI `mercato agentic:init` bundles the same `packages/create-app/agentic/` tree (`packages/cli/src/lib/agentic-setup.ts` resolves `AGENTIC_DIR` into it), so no second copy needs syncing beyond the two AGENTS.md variants.

## Non-goals

- No sanitizer tuning or Kimi `wire.jsonl` adapter for `om-share-this-session` — redaction changes weaken a privacy guard and need their own carefully-tested PR (follow-up, tracked on #5251).
- No stub `SKILL.md` placeholders or doctor check for failed external-skill installs — code change with test surface; follow-up.
- No changes to the generated module fact-sheet pipeline or fact-sheet splitting. *(Amended by the Phase 5 resume: the split-vs-hint question is now analyzed and designed in `.ai/specs/2026-08-13-module-fact-sheet-sectioned-reading.md`; pipeline code changes remain out of scope for this PR.)*
- No monorepo-side (`.ai/specs/`, root `AGENTS.md`) changes; this run improves the standalone harness only.

## Implementation Plan

### Phase 1 — Standalone root routing guidance

Add two compact lines to both AGENTS.md variants:

- After the skill-read rule (line 95): a missing routed `om-*` skill means `yarn install-skills` has not completed (external tier, network) — run it; never conclude the skill does not exist. This collapses the observed 10-tool-call search to a single command.
- In Module-Specific Facts: fact-sheets can exceed a single read-tool output cap — read large ones in sections and never assume one read returned the whole file.

### Phase 2 — Reference Display Rule

- SPEC-000 template: require every cross-record reference surface to be specified as a selection control backed by an option source showing display names; raw IDs appear only in API payloads, never typed or rendered in UI.
- `backend-ui.md`: add the matching implementation rule alongside the DataTable/CrudForm contracts.

### Phase 3 — om-module-scaffold inventory pointer

- Note in `SKILL.md` that `surface-inventory.json` ships inside the emitted example module (`src/modules/example/references/`), not under the skill's own `references/` folder.

### Phase 4 — Validation

- Run the create-app package test suite (instruction-budget, context-guidance-contracts, agent-surface-coverage, source-link checks).
- Run the configured full validation gate.

### Phase 5 — Fact-sheet split analysis and spec (resume, 2026-08-13)

Requested by the PR author on resume: analyze whether splitting fact-sheets into separate files + index beats the Phase 1 "read in sections" hint, and make the outcome less error-prone. Measured the built sheets (13 over 50 KB, `customers.md` 218 KB, section skew, 48 % link boilerplate), inventoried the contract surface pinning the single-file layout (363 `cases.json` refs, ~30 test assertions, two build scripts, two setup mirrors), and landed the design as a Proposed spec: in-file Contents index + end-of-facts marker + link-label compression first (Phase 1, additive), directory split as a conditional Phase 2 with full migration inventory.

## Risks

- Host-limit note: this runner's `fs.inotify.*` sysctl values are below the dev-wrapper preflight, so 4 `template-dev-log-files` tests fail locally on any branch; CI validates them on compliant runners.

- The scaffolded Codex root (enforcement rules + module-guide injection on top of AGENTS.md) must stay ≤ 12288 bytes; additions are sized to fit and `agent-instruction-budget.test.ts` is the gate.
- Contract tests pin exact routing phrases; all edits are additive sentences, no rewording of pinned lines.
- Harness evaluation cases (`cases.json`) score routing behavior; additive guidance lines do not remove any routed context.

## Progress

PR: #5267

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Standalone root routing guidance

- [x] 1.1 Missing-skill install-skills line in both AGENTS.md variants — 8e8d16ff4
- [x] 1.2 Fact-sheet oversize read hint in both AGENTS.md variants — 8e8d16ff4

### Phase 2: Reference Display Rule

- [x] 2.1 SPEC-000 template UI-contract rule — 0c178c7e1
- [x] 2.2 backend-ui.md cross-record reference rule — 0c178c7e1

### Phase 3: om-module-scaffold inventory pointer

- [x] 3.1 SKILL.md location note for surface-inventory.json — 5f10d6d24

### Phase 4: Validation

- [x] 4.1 create-app package tests green (851 pass; only the 4 known host-limit inotify dev-wrapper tests fail — environmental, sysctl preflight, not branch-caused) — 2330b5443
- [x] 4.2 Full validation gate green (build:packages, generate no-drift, i18n:check-sync/usage, typecheck, build:app all ✓; yarn test fails only on the same 4 environmental tests) — 2330b5443

### Phase 5: Fact-sheet split analysis and spec (resume)

- [ ] 5.1 Measure built sheets + inventory the single-file contract surface
- [ ] 5.2 Land `.ai/specs/2026-08-13-module-fact-sheet-sectioned-reading.md` (Proposed) with the phased design
