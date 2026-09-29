# Standalone harness — module-facts coverage cases

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Status: complete

This plan shipped on #4556, which #4602 superseded; the branch that carries it is now
`fix/4565-harness-module-fact-coverage`. The seven later fact-coverage cases have their own plan in
`.ai/runs/2026-07-28-harness-module-fact-coverage-and-budgets.md`.

Stacked on #4529 (merged head `abed8e02a`, re-aligned 2026-07-30 from the original `305c68fce`).
`packages/create-app/agentic/shared/ai/harness/cases.json` does not exist on `develop`, so this work
cannot be branched independently — the same stacking pattern #4528 uses.

## Goal

Close the largest measurable coverage gap in the standalone harness catalog: installed modules whose
generated facts ship with the scaffold but are referenced by no case at all.

## Scope

Two new routing cases that assert the agent consults an installed module's generated facts instead of
designing a new module for a capability the app already has:

- `OMH-194` — editable per-organization value lists (`dictionaries`)
- `OMH-195` — unattended, revocable partner API access (`api_keys`)

They shipped as `OMH-188`/`OMH-189`, were renumbered on 2026-07-30 because the stacked parent #4529
independently claimed those two IDs for writable cases of its own, and shifted once more when #4759
claimed `OMH-193` on `develop` — see Phases 5 and 6.

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

**This measurement is against the original stacked base `305c68fce` and no longer describes the catalog.**
Re-measured on the 2026-07-30 merge of #4529's `abed8e02a`, all ten of those module facts files now appear
somewhere: `OMH-087` requires `api_keys`, `configs`, `dictionaries`, `gateway_stripe`, `perspectives`,
`resources` and `sync_akeneo`, and `api_docs`, `inbox_ops` and `planner` are reachable through
`allowedExtra` on `OMH-011`, `OMH-098` and `OMH-100`. The gap these two cases close is therefore narrower
than originally stated, and it is a different one: `OMH-087` reads those facts while mapping a module brief
onto the discovery surface, whereas `OMH-194`/`OMH-195` are the only cases in the catalog that make a
module-facts file the *knowledge owner* (`owner.kind: "facts"`) and assert the installed-versus-new routing
decision. Nothing else in the 202-case catalog owns a facts surface.

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
- [x] 4.8 Re-run the live routing lane for OMH-188/189 against the tightened assertions — both pass on
      claude 2.1.220 / sonnet, controller scaffolded from `create-mercato-app@0.6.7-canary.317.1.106b9d993b`.
      OMH-188: `om-help` + `om-data-model-design` + `om-module-scaffold`, decisions `facts-first`,
      `tenant-scope`, `acl-features`, `smallest-validation`, 11 files, 0 violations, 0 corrections.
      OMH-189: `om-help`, the same four decisions, 11 files, 0 violations, 0 corrections. The
      deterministic gate over the committed bytes is 189/189 on the same controller. This is the run the
      earlier live evidence could not provide: it predated 28603a4e4, when both cases still declared an
      empty `requiredSkills` and asserted only one of the two scope/ACL decisions each.

### Phase 5: Re-alignment onto the current #4529 head (2026-07-30)

The stacked parent advanced past `305c68fce` and independently claimed `OMH-188`…`OMH-192` for five
writable cases of its own (room-booking overlap rejection, calendar provider transport, dotted-ID
enricher, durable workflow holds, CRM-linked library). Left alone, this work would have shipped
duplicate case IDs the moment #4529 merged, and eight of the nine cases on this branch pointed
`relatedCases` at `OMH-188`/`OMH-189` — so the duplication would have validated against the schema
while silently referencing the parent's different cases. The parent had also independently applied the
same `oracle.validatorIds` correction this work made for review finding 3, so only the drift guard
survives from that part.

- [x] 5.1 Merge #4529's `abed8e02a` — the parent's side wins for every conflicting harness, doc, spec
      and test file, and both sides' test additions are kept rather than one overwriting the other —
      3af9024e7
- [x] 5.2 Re-apply both cases as `OMH-193` (`dictionaries`) and `OMH-194` (`api_keys`), byte-identical
      to their reviewed form apart from the IDs and `OMH-194`'s relation to `OMH-193`; the seven cases
      from the #4565 plan follow as `OMH-195`…`OMH-201` — 3af9024e7
- [x] 5.3 Re-pin the catalog contract to 201: `validators.json` `expectedCaseCount`, the schema's
      `minItems`/`maxItems`, and its `id`/`relatedCases` patterns — 3af9024e7
- [x] 5.4 Re-align every documented count: harness `README`/`RELEASE`, `packages/create-app/README`,
      the spec's normative claims, gate table, acceptance criteria, case list and changelog. The
      writable/portability sample follows the parent at 45, so the three references this branch had
      left at 40 are corrected; the writable share becomes 45/201 = 22.4% — 3af9024e7
- [x] 5.5 Keep the schema drift guard and re-key the semantic assertions in
      `agent-surface-coverage.test.ts`; the parent still has no guard binding the shipped catalog to
      its published schema — 3af9024e7
- [x] 5.6 Restore the three measured budget widenings the byte-identical parent catalog reverted. The
      deterministic gate caught it as `FAIL OMH-146: declared context exceeds maxContextFiles: 5/4`;
      `OMH-111`/`OMH-146` take this branch's measurements (the larger of the two where the parent had
      also raised `OMH-111`), and `OMH-169` keeps the parent's, because the parent dropped a required
      path and re-measured afterwards — 98988a512
- [x] 5.7 Point the schema-enforcement canary at the real last shipped case, `OMH-201` — the parent's
      copy pinned `OMH-192` — 3af9024e7
- [x] 5.8 Re-measure the coverage claim against the merged catalog and record that it no longer holds
      as originally written — see Evidence
- [x] 5.9 Live routing evidence for the two cases: recorded on #4556 before it was superseded, on
      claude 2.1.220 / sonnet, controller scaffolded from
      `create-mercato-app@0.6.7-canary.317.1.106b9d993b`, when they were numbered `OMH-188`/`OMH-189`.
      Their bytes are unchanged apart from the IDs, so the evidence still describes exactly these two
      cases; it is quoted rather than re-run here, and step 4.8 holds the detail.
- [x] 5.10 Deterministic catalog gate over the merged catalog: 201/201 pass

### Phase 6: Re-alignment onto current `develop` (2026-08-01)

PR #4759 independently added `OMH-193` before this branch could merge. The final base merge preserves
that case and moves this branch's contiguous nine-case block forward by one.

- [x] 6.1 Merge current `develop`, preserve #4759's `OMH-193`, and re-key this branch's cases and
      `relatedCases` as `OMH-194`…`OMH-202`
- [x] 6.2 Re-pin the catalog, schema, validators, tests, and published documentation at 202 total cases
      and 46 writable cases
- [x] 6.3 Run the schema canary through `OMH-202` and the deterministic catalog gate over all 202 cases —
      evaluator 87/87, surface coverage 13/13, module-facts build 6/6
