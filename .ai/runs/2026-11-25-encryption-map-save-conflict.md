# Execution plan — encryption-map-save-conflict

Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal

Stop the Encryption settings screen (`/backend/config/encryption`) from raising a false optimistic-lock conflict when the user double-clicks "Save encryption map", and stop it from toasting the raw `record_modified` code on any 409.

## Background (verified)

Found in browser QA of PR #10503 and reproduced on `main` 204f384ec3 (production build, Chromium):

- Two clicks that reach the handler before React re-renders → POST 200, then 409. Both carry the same stale `x-om-ext-optimistic-lock-expected-updated-at`. The user sees "Encryption map saved", then a raw `record_modified` toast plus the "Record changed" bar. The change is saved.
- A genuine stale write → correct 409, but the toast also shows the raw `record_modified`. The bar's Refresh reloads the page and resets the entity picker.

Root cause in `packages/core/src/modules/entities/components/EncryptionManager.tsx`:

- The save button is disabled only by `mutation.isPending` (`:488-489`). react-query applies that a tick later, so both clicks run `mutationFn` with `buildOptimisticLockHeader(map?.updatedAt)` (`:262`). `onSuccess` also does not await the map refetch, so a quick second save can still send the old version.
- `raiseCrudError` puts the 409 body's `error` code into `Error.message`. `useGuardedMutation` already shows the translated bar via `surfaceRecordConflict`, and `onError` (`:282-285`) then toasts `err.message`.

## Scope

- `EncryptionManager.tsx` only: single-flight save via the shared `useInFlightGuard`, await the refetch in `onSuccess`, and route 409s through `surfaceRecordConflict` with an in-place `onRefresh`. This is the established pattern: PriceKindSettings, currencies, customer-groups.
- Jest regression tests for the component.
- A Playwright integration test for the UI path (none exists; TC-ENTITIES-009 covers only seeders and migrations).

## Non-goals

- The 35 other screens that toast raw server text after a 409 (static survey). That needs a shared "show the bar, else toast" helper, which belongs in a separate follow-up PR.
- Any API, contract, i18n or styling change.

## Implementation Plan

### Phase 1: Component fix

- 1.1 Make the save single-flight with `useInFlightGuard` and await the post-save refetch.
- 1.2 Send 409s to `surfaceRecordConflict` with an in-place refresh, so no raw code is toasted.
- 1.3 Add jest regression tests: a double click sends one POST; a 409 shows the bar and no raw toast; other errors still toast.

### Phase 2: Integration coverage

- 2.1 Add Playwright `TC-ENTITIES-013`: same-tick double click → one POST 200 and no conflict bar; a stale write → bar shown, no `record_modified` alert, and Refresh keeps the selected entity.

## Risks

- Awaiting the refetch keeps the button in "Saving…" slightly longer (one GET). This is intended.
- `surfaceRecordConflict` is called twice on a 409 (once by `useGuardedMutation`, once by the component). The second call replaces the bar entry with the same message plus an `onRefresh`. With the enterprise merge-dialog handler registered, the handler is asked twice for the same conflict, which is idempotent for one record.

## Progress

PR: #10641

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Component fix

- [x] 1.1 Make the save single-flight with `useInFlightGuard` and await the post-save refetch — 8246325774
- [x] 1.2 Send 409s to `surfaceRecordConflict` with an in-place refresh — 6ff5a3143b
- [x] 1.3 Add jest regression tests — 2736eca31c

### Phase 2: Integration coverage

- [x] 2.1 Add Playwright TC-ENTITIES-013 for double click and stale write — 83fe2d6ca0
