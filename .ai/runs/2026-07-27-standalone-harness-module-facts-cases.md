# Standalone harness — module-facts coverage cases

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Status: complete

Stacked on #4529 (`305c68fce`). `packages/create-app/agentic/shared/ai/harness/cases.json` does not
exist on `develop`, so this work cannot be branched independently — the same stacking pattern #4528 uses.

## Goal

Close the largest measurable coverage gap in the standalone harness catalog: installed modules whose
generated facts ship with the scaffold but are referenced by no case at all.

## Scope

Two new routing cases that assert the agent consults an installed module's generated facts instead of
designing a new module for a capability the app already has:

- `OMH-188` — editable per-organization value lists (`dictionaries`)
- `OMH-189` — unattended, revocable partner API access (`api_keys`)

Both are `facts`-owner cases. They shipped with empty `requiredSkills` to keep the assertion on routing,
observed context and decisions rather than a guessed skill chain; the #4556 review (finding 6) showed
that reasoning did not apply here, because `AGENTS.md` routes a comparative installed-versus-new choice
through `om-help` explicitly. Both now require that skill and observe the architecture guide, matching
the OMH-002 precedent — see Phase 4.

## Non-goals

- No change to the evaluator, tool server, oracles, release matrix, or any existing case.
- No writable/implementation lane registration — both cases are read-only routing.
- No edits to guides or skills; the knowledge owners already exist and are unchanged.

## Evidence

Measured on a controller scaffolded from `create-mercato-app@0.6.7-canary.317.1.106b9d993b`
(macOS 26.5.2, arm64, Node 24.14.1, `claude` 2.1.220 on the `sonnet` selector):

- 47 module facts files ship with the scaffold; 19 are referenced by no case's `context`/`owner`.
- Cross-checking case titles, prompts and tags leaves **10 with no trace anywhere in the catalog**:
  `api_docs`, `api_keys`, `configs`, `dictionaries`, `gateway_stripe`, `inbox_ops`, `perspectives`,
  `planner`, `resources`, `sync_akeneo`.

The two modules picked here are the ones whose absence is most likely to produce real duplicated work:
an agent that does not know `dictionaries` exists will scaffold a bespoke value-list module, and one that
does not know `api_keys` exists will invent a bespoke token mechanism.

## Implementation Plan

### Phase 1: Catalog

- Append `OMH-188` and `OMH-189` to `cases.json` following `references/case-template.md`.
- Bump `validators.json` `catalog.expectedCaseCount` from 187 to 189.
- Budgets calibrated to the OMH-177 class (11 files / 57344 initial bytes / 147456 total), which is the
  established envelope for multi-surface design questions.

### Phase 2: Specification

- Extend the feature spec's numbered use-case list and coverage totals with both cases.

### Phase 3: Validation

- Deterministic catalog gate over the full catalog.
- Live routing for both new cases on an authenticated runner.
- Repository validation gate for the touched package.

## Risks

- **Budget calibration.** The first live run of `OMH-188` failed only on budgets copied from the simpler
  OMH-002 envelope (10/8 files, 56424/40960 bytes) while routing, decisions and observed context were all
  correct. Budgets were re-based on OMH-177 and both cases then passed. Any further budget tightening in
  the catalog should re-run these two.
- **Stacking.** Until #4529 merges, this branch carries that PR's commits; the reviewable diff is the two
  cases, the count bump, and the spec entry.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Catalog

- [x] 1.1 Append OMH-188 and OMH-189 to cases.json — 955b97945
- [x] 1.2 Bump validators.json expectedCaseCount to 189 — 955b97945

### Phase 2: Specification

- [x] 2.1 Align every stale catalog count with the 189-case catalog — 64dbdb0ea

### Phase 3: Validation

- [x] 3.1 Deterministic catalog gate over the full catalog — 189/189 on the committed bytes
- [x] 3.2 Live routing runs for both new cases — OMH-188 and OMH-189 pass on claude/sonnet
- [x] 3.3 Repository validation gate for the touched package — create-app 328 pass / 4 pre-existing fail / 5 skipped, typecheck clean

### Phase 4: Review response (#4556 review by pkarw, 2026-07-27)

Findings 1, 2, 4, 5 and 8 are not addressed here: they concern generator, framework-context,
wizard/installer and audit-gate code introduced by the stacked parent #4529, not by this branch's
four commits. They are raised on #4529 instead of being patched from a stacked branch.

- [x] 4.1 Finding 3 — correct the published schema so it accepts the catalog it pins: `id` and
      `relatedCases` patterns through OMH-189, `oracle.validatorIds` accepts the registered
      `writable.allowed-paths` — 28603a4e4
- [x] 4.2 Finding 3 — add a drift guard that validates the shipped catalog against the published
      schema's own pins, verified to fail when the pre-fix pattern is restored — 28603a4e4
- [x] 4.3 Finding 6 — OMH-188/189 require `om-help` and observe the architecture guide, matching the
      OMH-002 precedent for a comparative installed-versus-new choice — 28603a4e4
- [x] 4.4 Finding 6 — encode the prompt-mandated decisions: `acl-features` on OMH-188, `tenant-scope`
      on OMH-189, `smallest-validation` on both — 28603a4e4
- [x] 4.5 Finding 6 — semantic assertions for both cases in `agent-surface-coverage.test.ts` — 28603a4e4
- [x] 4.6 Finding 7 — align the remaining stale operational counts: RELEASE.md, the release CLI help,
      two om-evolve-harness references, the spec's normative claims and case list, and the spec
      changelog entry the count alignment owed — 47a120a4b, f2cbf0ed7
- [x] 4.7 Run the full configured `validation.commands` gate locally instead of relying on GitHub checks —
      8/8 green on f2cbf0ed7; create-app 333 pass / 0 fail / 5 skipped once dist/agentic is built
- [ ] 4.8 Re-run the live routing lane for OMH-188/189 against the tightened assertions — requires a
      scaffolded controller
