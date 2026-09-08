# Execution plan — land the #5239 zone dialog work by fixing every code-review finding (adopted from PR #5334)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-17 because PR #5334 carried no execution plan.
**PR:** #5334 · **Branch:** `feat/issue-5239-wms-zone-dialog` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Make PR #5334 mergeable: deliver requirement 2 of #5239 (the zone dialog's custom fields actually persist and read back), remove the `ComboboxInput` label-corruption regression the review reproduced, and close every remaining review finding with the coverage the checklist demands.

## Scope

- `packages/core/src/modules/wms/` — zone commands, zones list route, the configuration page's zone dialog, command unit tests.
- `packages/ui/src/backend/inputs/ComboboxInput.tsx` and its unit tests.
- The `TC-WMS-028-zone-dialog` integration spec (comments/links only; its assertions already have the right shape).

## Non-goals

- Rewriting the zone commands onto `runCrudCommandWrite`. The review does not ask for it and it would widen the diff across a shared write path; the existing `emitCrudSideEffects` composition is the pattern the rest of this module already uses.
- Fixing the `CrudForm` accessibility gap (no `htmlFor`/`id` on dialog fields) that finding **n3** describes. That is a framework-level defect touching every form in the product — it gets its own issue, linked from the spec comment.
- Backfilling query-index coverage for zones created before this change. The index self-heals through the existing coverage refresh; no migration is in scope.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The goal is "fix everything the review found", not new feature work | The user's invocation, which pasted the full review verbatim and asked for the findings to be fixed | high |
| Requirement 2 genuinely does not persist | `TC-WMS-028-zone-dialog.spec.ts:248` failing deterministically (`Expected: "Pick face …", Received: null`), reported in the PR body and confirmed by the review | high |
| The write chain (client → route → command → `dataEngine.setCustomFields`) is correct | The reviewer executed both halves against the real schema/handler and observed the correct call | high |
| The break is on the **read** projection, not the write | `HybridQueryEngine` (the DI-registered engine) serves `cf:*` from `entity_indexes`, and the zone commands never emit `emitCrudSideEffects`, so no `query_index.upsert_one` ever runs for a zone | high |
| `ComboboxInput`'s new guard corrupts a picked label into the raw record id | The review reproduced it with a discriminating test: passes on `origin/develop`, fails on `1ac4915`, with only that file swapped | high |
| The server-side custom-field change has zero unit coverage | `git diff` shows the only new unit tests are the two `ComboboxInput` cases | high |

## Assumptions

- **The indexer is the whole of B1.** The reviewer proved the write reaches `setCustomFields`; the hybrid engine reading `cf:*` out of `entity_indexes` is then the only remaining link that can turn a written value into `null`. If a live run still shows `null` after this change, the next suspect is `upsertIndexRow`'s custom-field projection, not the command wiring.
- **Adding the indexer to zone commands is safe and additive.** Zones already declare `indexer: { entityType: E.wms.warehouse_zone }` on the CRUD route, so the entity type is already an indexed one; the commands were simply not emitting the side effect.
- **No new event ids.** `emitCrudSideEffects` is wired with `indexer` only, not `events`, so the existing `wms.zone.created` / `wms.zone.updated` emissions stay the single event source and no undeclared `wms.warehouse_zone.*` event appears.
- **Adoption mode is `auto`.** A user is in the loop, which normally means `ask`, but they supplied the goal outright (the pasted review plus "fix the findings"), so confirming a reconstructed plan would only cost a turn. Correct this by commenting on the PR.

## Risks

- `ComboboxInput` is a shared primitive; the M1 fix narrows when a focused field syncs, so it needs the M2 coverage cases to prove the other windows still behave.
- B1 cannot be proven end-to-end without a live environment. Mitigation: the unit tests of Phase 3 pin the command-side contract, and the fix's mechanism is traceable in code from `markOrmEntityChange` to `query_index.upsert_one` to `entity_indexes`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Preselect the sole warehouse, wire custom fields through route/commands/form, add the TC-WMS-028 integration spec and two ComboboxInput tests — 1ac4915

### Phase 2: B1 — make the zone custom fields readable

- [x] 2.1 Emit CRUD side effects with a warehouse-zone indexer from the zone create/update/delete commands and their undo handlers — 7fbae24

### Phase 3: B2 — unit coverage for the server-side custom-field change

- [x] 3.1 Add the zone custom-field command suite (create with/without values, update, both undo resets, snapshot loader) — 7fbae24

### Phase 4: M1 and M2 — ComboboxInput

- [x] 4.1 Never sync a focused field to a self-mapping placeholder label — e35ad73
- [x] 4.2 Add the discriminating pick-then-stale-reload test plus the three blast-radius cases — e35ad73

### Phase 5: Minor findings m1–m7

- [x] 5.1 Give the zone edit dialog optimistic locking (`id` + `updatedAt` in initialValues) — 656483e
- [x] 5.2 Restore custom fields on delete-undo and stop discarding the snapshot — 7fbae24
- [x] 5.3 Opt the new zones decorator into `stripPrefixedKeys` and type the `customFields` OpenAPI entry — 656483e
- [x] 5.4 Feed the warehouse combobox from the cached query instead of a second round trip — 656483e
- [x] 5.5 Narrow the `ZoneRow` / `ZoneFormValues` index signatures and short-circuit the custom-field snapshot load — 656483e

### Phase 6: Nits and follow-ups

- [x] 6.1 Annotate the non-discriminating test, de-couple the ComboboxInput comment from WMS, file the CrudForm accessibility issue (#5360) — e35ad73, 656483e

### Phase 7: Validation and delivery

- [x] 7.1 Run the full validation gate, push, update the PR body and labels, post the summary comment — 656483e

## Outcome notes

- **m7 was answered with a measurement, not a short-circuit.** The review estimated four extra queries per zone update; `loadCustomFieldValues` returns early on an empty `custom_field_values` result and never issues the `custom_field_defs` query, so a tenant with no zone custom fields pays one lookup per snapshot, not two. Documented at the call site instead of adding a redundant guard.
- **The row-action zone delete still has no optimistic locking.** m1 scoped the fix to the dialog, and half-wiring a row action — a header without the `surfaceRecordConflict` bar behind it — would be worse than the existing gap. Left for a follow-up that does both.
- **B1 remains unproven end to end** until `TC-WMS-028-zone-dialog.spec.ts` runs against a live environment. The mechanism is traceable in code and the command-side contract is now pinned by unit tests.
