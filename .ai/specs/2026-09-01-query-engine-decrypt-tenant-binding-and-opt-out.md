# Query-engine decryption: bind the DEK to the caller's tenant, and let a query decline plaintext

**Status:** implemented on PR #5822 (pending review)
**Issue:** #5430 · **Spec PR:** #5820 · **Implementation PR:** #5822
**Scope:** OSS (`packages/shared`, `packages/core`)

## 📝 TLDR

Field decryption in both query engines is a property of *the engine*, not of *the caller's entitlement*. The tenant whose DEK is used is read from the row rather than from the authenticated principal, and `QueryOptions` carries no switch to decline plaintext. This spec makes the decrypt step **fail closed**: a row whose `tenant_id` contradicts the tenant the caller asserted comes back as ciphertext instead of another tenant's plaintext, and an additive `QueryOptions.decryptEncryptedFields` lets a query decline decryption it never asked for. Nothing here fixes a known live leak — it removes the amplification that turns a scoping mistake anywhere else in the stack into a cross-tenant plaintext disclosure.

## 📝 Problem Statement

Issue #5430 is a defence-in-depth report, not a live vulnerability: no currently reachable path is known to disclose plaintext across a tenant boundary on `develop`. The defect is in the *shape* of the decrypt step, and it has two halves.

### 1. Decryption trusts the row's own `tenant_id`

`packages/shared/src/lib/query/engine.ts:1293` (`BasicQueryEngine`) and `packages/core/src/modules/query_index/lib/engine.ts:1202` (`HybridQueryEngine`) both resolve the decrypt scope as:

```ts
(item?.tenant_id ?? item?.tenantId ?? opts.tenantId ?? null) as string | null
```

The row's tenant takes precedence over the tenant the caller asserted. `TenantDataEncryptionService.getDek()` (`packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:186`) resolves a DEK for **any** tenant id it is handed, with no comparison against the authenticated principal. So if a row belonging to tenant B ever reaches a tenant-A caller's result set, the engine fetches tenant B's DEK and hands back tenant B's plaintext. The encryption layer amplifies the scoping bug instead of containing it, and does so silently — nothing in the logs marks that a foreign-tenant key was used.

This is not purely theoretical, because the framework ships a supported way to turn automatic scoping off. `QueryOptions.omitAutomaticTenantOrgScope` (`packages/shared/src/lib/query/types.ts:116`) documents its own hazard — *"Callers MUST encode full visibility in `filters` … otherwise queries return cross-tenant rows"* — and is reachable from any module through `makeCrudRoute` (`packages/shared/src/lib/crud/factory.ts:270`, `:1843`). Two core routes already use it (`feature_toggles/api/global/route.ts:118`, `scheduler/api/jobs/route.ts:72`). Today, rows returned by a mis-built `$or` on such a query come back decrypted.

The same row-first precedence exists on the MikroORM read path: `EncryptionSubscriber.decrypt` resolves `tenantId ?? fallbackScope?.tenantId` (`packages/shared/src/lib/encryption/subscriber.ts:318`), where the fallback is the scope the caller passed to `findWithDecryption`. A guard that exists in the query engines but not here would give a false sense of coverage.

### 2. `QueryOptions` has no way to say "do not decrypt"

There is no decrypt switch on `QueryOptions`. Decryption happens because a `TenantDataEncryptionService` is resolvable, not because a caller asked for plaintext. Generic, entity-agnostic surfaces therefore materialise plaintext they never requested — `packages/core/src/modules/entities/api/records.ts` passes no `fields` projection and sets `includeCustomFields: true`, so every base column and every custom field is selected and then decrypted, including `cf:` / `cf_` values via `decryptIndexDocCustomFields`. The `format=csv` branch pages through the whole result set, materialising an entire register in the clear in one request.

That route is properly gated (`entities.records.view`, `classifyRecordsEntity`'s system-entity block, `assertEntityAclForRequest`), so a caller reaching it is authorised to list the entity. The narrower gap is that the framework offers **no lever at all**: a caller that does not need plaintext cannot decline it, and a module author cannot express "this field is encrypted *and* reading it costs feature X". `encrypted: true` reads to an admin configuring it in the Encryption Manager UI as an access-control action; it is purely an at-rest property.

## 📝 Proposed Solution

Three changes, in increasing order of surface area, plus a documentation correction.

1. **Bind the decrypt scope to the caller.** One shared helper decides whether a row may be decrypted and with which scope. When the caller asserted a tenant and the row contradicts it, the row is returned untouched — ciphertext, not another tenant's plaintext — and the skip is logged once per query so the underlying scoping bug surfaces instead of hiding. Applied to both query engines (Phase 1), then to the ORM subscriber (Phase 2).
2. **Add an additive `QueryOptions.decryptEncryptedFields` opt-out** (Phase 3). It defaults to today's behaviour everywhere, so nothing breaks — a pure opt-in for callers that do not need plaintext.
3. **State the contract in the docs** (Phase 4): encryption maps are at-rest protection, not a read-side access control.

### Alternatives considered

- **Throw on a tenant mismatch instead of returning ciphertext.** Rejected for Phase 1: a mismatch means a scoping bug exists *somewhere else*, and converting that latent bug into a 500 across an unknown number of call sites is a larger, less reversible blast radius than degrading to ciphertext. #5430 asks for *fail closed*, not *fail loud*. Escalating to a throw later is a one-line change behind the same helper.
- **Compare `organization_id` as well as `tenant_id`.** Rejected. Organisations inside a tenant share the tenant DEK, so an org mismatch does not change which key is used; adding an org comparison would break legitimate multi-org reads (`opts.organizationIds`) for no key-scope benefit.
- **Make `records.ts` default to a non-encrypted-column projection** (issue suggestion 2). Deferred — see *Deferred / follow-up work*.
- **`ModuleEncryptionMap.requiredFeatures`** (issue suggestion 3). Deferred — it is a new public contract plus an ACL semantics change and deserves its own spec.

## 📝 Architecture

### The shared decision helper

New file `packages/shared/src/lib/encryption/decryptScope.ts` — the one place the rule lives, so the engines and the subscriber cannot drift:

```ts
export type DecryptScopeDecision =
  | { decrypt: true; tenantId: string | null; organizationId: string | null }
  | { decrypt: false; reason: 'tenant-mismatch'; rowTenantId: string; callerTenantId: string }

export function resolveDecryptScope(input: {
  rowTenantId: string | null
  rowOrganizationId: string | null
  callerTenantId: string | null
  callerOrganizationId: string | null
}): DecryptScopeDecision
```

Rule, in full:

- `callerTenantId` set **and** `rowTenantId` set **and** they differ → `{ decrypt: false, reason: 'tenant-mismatch' }`.
- Otherwise → `{ decrypt: true, tenantId: rowTenantId ?? callerTenantId, organizationId: rowOrganizationId ?? callerOrganizationId }`, which is today's precedence, byte for byte.

The guard therefore fires **only** in a state that is already a bug: the caller asserted tenant A and the engine is holding a tenant-B row. Every legitimate case is untouched — a row with no tenant of its own falls back to the caller's scope exactly as it does today, and a caller that asserts no tenant (the ORM path, where `findWithDecryption`'s scope argument is optional) keeps the row's own tenant as the only available key id. In the query engines `opts.tenantId` is mandatory, so there the guard is always armed.

A second exported function keeps the flag's default rule in one place too:

```ts
export function resolveDecryptEnabled(opts: { decryptEncryptedFields?: boolean }): boolean
// opts.decryptEncryptedFields !== false
```

It is **not** defaulted off for `omitAutomaticTenantOrgScope` queries. Both engines require
`opts.tenantId` on every query (`packages/shared/src/lib/query/engine.ts:410`,
`packages/core/src/modules/query_index/lib/engine.ts:470`), so `resolveDecryptScope` always has a
caller tenant to bind against and already refuses any foreign-tenant row on those reads. Flipping
the default would only strip plaintext from legitimately global rows (`tenant_id IS NULL`), which
the guard correctly allows.

### Call sites

| Path | File | Change |
|---|---|---|
| `BasicQueryEngine` | `packages/shared/src/lib/query/engine.ts` (`decryptRow`, ~:1293) | Route the scope through `resolveDecryptScope`; skip and count on `decrypt: false`. Gate `decryptPayload` construction on `resolveDecryptEnabled`. |
| `HybridQueryEngine` | `packages/core/src/modules/query_index/lib/engine.ts` (`decryptRow`, ~:1202) | Same, covering **both** the `decryptEntityPayload` call and the `decryptIndexDocCustomFields` call — custom-field values use the same row-derived scope and must obey the same decision. |
| ORM subscriber | `packages/shared/src/lib/encryption/subscriber.ts:318` | Replace `tenantId ?? fallbackScope?.tenantId` with the helper; on `decrypt: false` return without mutating the target, and do not propagate a `nextFallback` derived from the refused row. |
| CRUD factory | `packages/shared/src/lib/crud/factory.ts` (~:270, ~:1843) | Add `decryptEncryptedFields?: boolean` to the list options and pass it into `queryOpts`, so `makeCrudRoute` consumers can set it declaratively. |

### Logging

A mis-scoped query can return a full page of foreign rows; one warning per row would be a log flood. Each engine run aggregates: count the refusals during the run and emit **one** `logger.warn` per query execution with the entity id, the refusal count, the caller's tenant id and up to three distinct row tenant ids. No field values, no ciphertext, no key material — the message names ids that already appear in existing `debug('🔎 dek.miss', { tenantId })` lines. The subscriber, which decrypts one graph at a time, logs per refused entity at `warn`.

### Precedent: the search read path already does this

`packages/search/src/lib/presenter-enricher.ts:319-321` builds its decrypt scope as `{ tenantId, organizationId: docOrgId }` — the **caller's** tenant, with only the organisation taken from the document. That is exactly the binding this spec generalises, and it is why the design is low-risk rather than novel: one read path already refuses to key off the row's tenant, and the change here brings the other three into line with it. The search path needs no change and is out of scope. The index-*write* callers of `decryptIndexDocForSearch` — `query_index/lib/indexer.ts:395`, `lib/reindexer.ts:449`, `cli.ts:216` — are also out of scope: they re-encrypt a document for storage, where the row's own tenant is the authoritative scope and there is no caller entitlement to bind to.

### What is reused, not invented

`resolveDecryptScope` is a pure function over ids; it introduces no new service, no DI key, no cache, and no dependency. Decryption itself still goes through `TenantDataEncryptionService.decryptEntityPayload` and `decryptIndexDocCustomFields` unchanged. Logging goes through the existing `createLogger` facade already imported in both engines.

## 📝 Data Model

No schema change. No migration. No new entity, column, or index. `encryption_maps` and the DEK/KMS contract are untouched.

## 📝 API Contracts

No HTTP route changes shape, and no response body changes for any correctly scoped caller. Two additive TypeScript surfaces:

```ts
// packages/shared/src/lib/query/types.ts — QueryOptions
/**
 * When false, the engine returns encrypted fields as stored (ciphertext) instead of
 * decrypting them. Defaults to true for ordinary scoped queries — today's behaviour.
 * Defaults to FALSE when `omitAutomaticTenantOrgScope` is set: those queries deliberately
 * cross tenants, so the caller must ask for plaintext explicitly.
 */
decryptEncryptedFields?: boolean
```

```ts
// packages/shared/src/lib/crud/factory.ts — list options
decryptEncryptedFields?: boolean
```

Per `BACKWARD_COMPATIBILITY.md`, `QueryOptions` and the `makeCrudRoute` options object are STABLE type surfaces; both changes are **additive optional properties**, which the contract permits without a deprecation cycle. The one behaviour change on a public surface is the `omitAutomaticTenantOrgScope` default (Phase 3) — see *Risks*.

## 📝 UI/UX

None. No page, component, form, or user-facing string changes. The Encryption Manager UI is untouched; Phase 4 corrects prose in the documentation site only, not the in-app `entities.encryption.description` string (changing a shipped locale value would ripple across every translation file for no functional gain, and the docs are where the contract belongs).

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|---|---|
| Correctly scoped query, row tenant == caller tenant | Decrypted exactly as today. No log line. |
| Deliberate cross-tenant read (`opts.tenantId` unset) | Decrypted using the row's own tenant, exactly as today — the guard cannot fire without a caller assertion. |
| Row has no `tenant_id` column / value | Falls back to the caller's tenant, exactly as today. |
| Mis-scoped query returns a foreign row | Row returned untouched (ciphertext in the encrypted fields), one aggregated `warn` per query naming the entity and the mismatching tenant ids. |
| `keyScope: 'system'` map (e.g. `onboarding:onboarding_request`) with `tenant_id IS NULL` | Unaffected: no row tenant, so the guard cannot fire, and `decryptEntityPayload` still resolves `system:<entityId>`. |
| `keyScope: 'system'` map on a row that *does* carry a contradicting tenant | Refused. This is the correct outcome — the caller should not read another tenant's record regardless of which key encrypts it — and is called out here because the refusal happens before the key-scope branch inside `decryptEntityPayload`. |
| `omitAutomaticTenantOrgScope` query | Unchanged. `opts.tenantId` is mandatory on every query, so the guard already refuses foreign-tenant rows on these reads; genuinely global rows (`tenant_id IS NULL`) still decrypt under the caller's tenant. |
| Sorting on an encrypted field in a query that declined decryption | Unavailable — the engine takes no plaintext-sort path, because there is no plaintext to sort by. |
| Encryption disabled (`isTenantDataEncryptionEnabled()` false) | Unchanged — `decryptEntityPayload` already short-circuits, and the guard adds no work. |
| Sorting/pagination on an encrypted field in a mis-scoped query | Refused rows sort by ciphertext. Acceptable: the query is already returning rows it should not, and ordering correctness is not a security property worth leaking plaintext to preserve. |

## 📝 Risks & Impact Review

**Blast radius.** Phases 1–2 touch every read path that decrypts, which is broad, but the changed branch is unreachable for correctly scoped callers — the decision function returns today's exact values unless the caller asserted a tenant that the row contradicts. The realistic risk is not a behaviour change for good callers but that a *pre-existing* scoping bug somewhere in the codebase starts returning ciphertext where it used to return plaintext, and is reported as a regression. That is the intended outcome, and the aggregated warning is what makes it diagnosable; the release notes must say so.

**Phase 3 changes no behaviour at all.** The option is additive and defaults to today's behaviour, so no shipped caller is affected. The originally proposed default flip for `omitAutomaticTenantOrgScope` queries was dropped once implementation established that `opts.tenantId` is mandatory (see the Q3 row) — it would have carried real risk for no security gain.

**Rollback.** Each phase is one small, self-contained commit and reverts independently: reverting Phase 1 restores the old precedence expression, reverting Phase 3 removes an optional property nothing else reads. There is no data migration and no persisted state, so a revert needs no cleanup.

**Performance.** `resolveDecryptScope` is a pure comparison of two strings per row, run inside the existing `mapWithConcurrency` loop. On refusal it *saves* a DEK lookup and an AES pass. Net effect is neutral-to-positive.

**Compatibility.** No FROZEN or STABLE surface changes incompatibly; both new properties are optional additions. No event id, DI key, ACL feature, route, or generated file is touched.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written by an unattended run, so the Open Questions were resolved with conservative defaults. Each is reversible before merge.

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Guard the two query engines only, or the ORM subscriber too? | Both, phased — engines in Phase 1 (exactly the report's scope), subscriber in Phase 2 via the same helper. | The precedence is identical at `subscriber.ts:318`; a guard on two of three read paths is a false sense of coverage. Phasing keeps Phase 1's blast radius equal to what was reported. | ok |
| Q2 | Refuse silently (ciphertext + log), or throw? | Return the row untouched and log one aggregated warning per query. | A mismatch means a scoping bug exists elsewhere; converting it into a 500 across unknown call sites is a bigger, less reversible change than degrading to ciphertext. #5430 asks for fail-closed, not fail-loud. Escalation to a throw stays a one-line change behind the helper. | ok |
| Q3 | Does `decryptEncryptedFields` default to today's behaviour everywhere? | **Yes, everywhere — a pure opt-in.** (Superseded during implementation; see below.) | The original answer defaulted it *off* for `omitAutomaticTenantOrgScope` queries on the premise that the Phase 1 guard could not fire there. That premise is wrong: both engines **require** `opts.tenantId` on every query, so a caller tenant is always available and the guard already refuses foreign-tenant rows on those reads. Flipping the default would only have stripped plaintext from legitimately global rows (`tenant_id IS NULL`) for no security gain. | ok — the `⚠ NEEDS HUMAN CONFIRMATION` this row originally carried no longer applies. |
| Q4 | Include `ModuleEncryptionMap.requiredFeatures` (issue suggestion 3)? | Defer to its own spec; file a follow-up FR. | It adds a new public contract to an ADDITIVE-ONLY surface *and* changes what `encrypted: true` means for access control — a design question bigger than this hardening. | ok |
| Q5 | Ship the documentation correction here? | Yes, as Phase 4. | It is the part that closes the *expectation* gap regardless of code, costs one file, and carries no runtime risk. | ok |
| Q6 | Split the guard and the opt-out into separate specs? | One spec, four phases. | Both are the same capability — binding decrypt-time plaintext to the caller's entitlement rather than the row's — and share one helper, one test surface, and one docs correction. Split specs would cross-reference each other at every step. | ok |

## 📋 Phasing

Each phase is independently shippable, independently revertable, and leaves the application working.

- **Phase 1 — Fail-closed tenant binding in the query engines.** The reported scope. No API change.
- **Phase 2 — Extend the guard to the ORM read path.** Same helper, third call site.
- **Phase 3 — `decryptEncryptedFields` opt-out.** Additive `QueryOptions` and `makeCrudRoute` surface, plus the `omitAutomaticTenantOrgScope` default.
- **Phase 4 — Documentation correction.** Encryption maps are at-rest protection, not read-side access control.

## 📋 Implementation Plan

### Phase 1 — Fail-closed tenant binding in the query engines

1. **Add the decision helper.** Create `packages/shared/src/lib/encryption/decryptScope.ts` exporting `resolveDecryptScope` and `DecryptScopeDecision` exactly as specified in *Architecture*, and re-export it from the package's encryption barrel alongside `decryptIndexDocCustomFields`. Test: new `packages/shared/src/lib/encryption/__tests__/decrypt-scope.test.ts` covering match, mismatch, null row tenant, null caller tenant, both null, and org fallback.
2. **Apply it in `BasicQueryEngine`.** In `packages/shared/src/lib/query/engine.ts`, rewrite `decryptRow` to call `resolveDecryptScope` and return `item` unchanged on `decrypt: false`, incrementing a per-run refusal tally. Test: add to `packages/shared/src/lib/query/__tests__/engine.test.ts` — (a) a row whose `tenant_id` differs from `opts.tenantId` is returned as-is and `decryptEntityPayload` is never called; (b) a matching row is still decrypted; (c) with `opts.tenantId` unset, a row is still decrypted using its own tenant.
3. **Apply it in `HybridQueryEngine`.** Same change in `packages/core/src/modules/query_index/lib/engine.ts`, covering both the `decryptEntityPayload` call and the `decryptIndexDocCustomFields` call so custom-field values obey the same decision. Test: mirror the three cases in `packages/core/src/modules/query_index/__tests__/hybrid-engine.test.ts`, plus one asserting a `cf:`-keyed value stays ciphertext on refusal.
4. **Emit the aggregated warning.** In both engines, after the decrypt pass, emit one `logger.warn` when the refusal tally is non-zero, carrying the entity id, the count, the caller's tenant id and up to three distinct row tenant ids — and no field values. Test: assert in both engine test files that a single warning is emitted for a page containing several refused rows, and none when nothing is refused.

### Phase 2 — Extend the guard to the ORM read path

5. **Guard `EncryptionSubscriber.decrypt`.** In `packages/shared/src/lib/encryption/subscriber.ts`, replace the `tenantId ?? fallbackScope?.tenantId` / `organizationId ?? fallbackScope?.organizationId` pair at `:318` with `resolveDecryptScope`. On `decrypt: false`, return without mutating the target, without re-baselining original entity data, and without descending into relations with a fallback derived from the refused row; log one `warn`. Test: new `packages/shared/src/lib/encryption/__tests__/subscriber-tenant-binding.test.ts` — a row whose tenant contradicts the `findWithDecryption` scope is left untouched; a matching row and a scope-less call both still decrypt; a refused parent does not leak its scope into a populated relation.

### Phase 3 — `decryptEncryptedFields` opt-out

6. **Add the option and its default rule.** Add `decryptEncryptedFields?: boolean` to `QueryOptions` in `packages/shared/src/lib/query/types.ts` with the doc comment from *API Contracts*, and export `resolveDecryptEnabled` from `decryptScope.ts`. Test: extend `decrypt-scope.test.ts` with the default matrix (unset → true; explicit `true` or `false` wins).
7. **Honour it in both engines.** Gate the `decryptPayload` construction in `packages/shared/src/lib/query/engine.ts` and the `encSvc` binding in `packages/core/src/modules/query_index/lib/engine.ts` on `resolveDecryptEnabled(opts)`, so a declined query performs no DEK lookup at all and takes no plaintext-sort path. Test: in both engine test files, assert `decryptEntityPayload` is not called when the flag is `false` and is called when it is `true` or unset.
8. **Expose it through `makeCrudRoute`.** Add `decryptEncryptedFields?: boolean` to the list options in `packages/shared/src/lib/crud/factory.ts` and pass it into the built `queryOpts` next to the existing `omitAutomaticTenantOrgScope` pass-through (~:1843). Test: extend `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts` with a case asserting the option reaches the query engine.
9. **Integration coverage.** Add `packages/core/src/modules/customers/__integration__/TC-ENC-001.spec.ts`: against an entity with a shipped encryption map (`customers`), a correctly scoped authenticated list request still returns plaintext for encrypted fields — the no-regression guarantee for every ordinary caller. Self-contained per `.ai/qa/AGENTS.md`: create its own customer fixture through the API in setup and delete it in teardown.

### Phase 4 — Documentation correction

10. **State the contract.** In `apps/docs/docs/user-guide/encryption.mdx` and `apps/docs/docs/architecture/data-encryption.mdx`, add a short, prominent statement that encryption maps are **at-rest protection and not a read-side access control** — declaring a field in a map does not restrict who can read its plaintext through an authorised query path — and document `decryptEncryptedFields` (including its `omitAutomaticTenantOrgScope` default) as the lever a caller uses to decline plaintext. No in-app locale string changes.

## Deferred / follow-up work

Filed as separate FRs rather than widened into this spec:

- **`records.ts` field projection** (issue suggestion 2): giving `packages/core/src/modules/entities/api/records.ts` a `fields` parameter is additive, but *defaulting* its projection to non-encrypted columns is a user-visible change to the record browser and its CSV export, and is a product decision about what an `entities.records.view` holder should see. It needs its own spec, and Phase 3's lever is its prerequisite.
- **`ModuleEncryptionMap.requiredFeatures`** (issue suggestion 3): the version that closes the gap between what `encrypted: true` looks like it does and what it does. New public contract plus ACL semantics; own spec.

## Validation

Run the repository gate from `.ai/agentic.config.json` — `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app` — plus `yarn test:integration` for step 9.

## Changelog

- 2026-09-01 — Spec drafted from issue #5430 under `om-auto-write-spec`; Open Questions resolved with autonomous defaults (see *Resolved assumptions*).
- 2026-09-01 — **Revised during implementation (PR #5822).** Resolved assumption Q3 was superseded: `decryptEncryptedFields` is a pure opt-in and is NOT defaulted off for `omitAutomaticTenantOrgScope` queries, because both engines require `opts.tenantId` on every query, so the Phase 1 guard is always armed and already refuses foreign-tenant rows there. This removes the spec's only `⚠ NEEDS HUMAN CONFIRMATION` assumption. All four phases implemented; the shared helper is a deep import (`@open-mercato/shared/lib/encryption/decryptScope`) because the encryption library has no barrel file.

### Review — 2026-09-01

- **Reviewer**: Agent (`om-spec-writing`, autonomous)
- **Security**: Passed — the change only ever narrows what is decrypted; tenant isolation is the subject of the spec rather than an afterthought, the aggregated warning is specified to carry ids only and never field values or key material, and no default weakens scoping. The one default that *changes* behaviour (`omitAutomaticTenantOrgScope` ⇒ no decryption) tightens rather than relaxes it.
- **Performance**: Passed — `resolveDecryptScope` is a string comparison per row inside the existing `mapWithConcurrency` loop, and a refusal skips a DEK lookup and an AES pass, so the net effect is neutral-to-positive. Log volume is explicitly bounded to one aggregated warning per query execution rather than one per row.
- **Cache**: N/A — no cache strategy, tag, or invalidation is introduced; the existing DEK and encryption-map caches inside `TenantDataEncryptionService` are untouched, and a refusal simply does not consult them.
- **Commands**: N/A — the spec introduces no mutation. Every phase is on a read path, so there is no command, no side effect, and correspondingly no undo contract to specify.
- **Risks**: Passed with one caveat recorded in the spec — the realistic risk is that a pre-existing scoping bug elsewhere starts returning ciphertext and is reported as a regression, which is the intended outcome and is why the aggregated warning exists and why the release notes must call it out.
- **Scope cohesion**: Medium finding, surfaced rather than rewritten. Phases 1–2 (the guard) and Phase 3 (the opt-out) would each function without the other, which is a bundle signal under checklist §1. They are kept in one spec because they are one capability — binding decrypt-time plaintext to the caller's entitlement instead of the row's — and share a single helper, test surface, and documentation correction. The decision is recorded as resolved assumption Q6 so a maintainer can split it before merge. Per the checklist this verdict goes back as an open decision, not an automatic rewrite. The fresh-context subagent delegation the checklist prescribes for this item was not used in this run (session policy disallowed spawning subagents), so this item carries author bias and deserves the reviewer's attention first.
- **Verdict**: Approved — implementable as written, with resolved assumption Q3 (`⚠ NEEDS HUMAN CONFIRMATION`) and the scope-cohesion decision to confirm before merge.
