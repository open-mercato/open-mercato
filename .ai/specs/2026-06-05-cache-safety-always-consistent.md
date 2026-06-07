# OM_CACHE_SAFETY_ALWAYS_CONSISTENT — opt-in synchronous read-projection consistency

- **Status:** Draft (pending implementation)
- **Date:** 2026-06-05
- **Scope:** OSS
- **Follow-up to:** PR #2549 (`fix(test): stabilize CF multi-select edit specs` — made the query-index *projection row* synchronous on write, left the heavy tail deferred)
- **Owning packages:** `@open-mercato/shared` (data engine), `@open-mercato/core` (`query_index` module), `@open-mercato/cache` (docs)
- **Tracking issue:** _to be filed on merge of this spec_

## 1. Motivation

Open Mercato's read path is served from **projections**, not the source rows:

- CRUD `list` endpoints read `customValues` + scalar docs from the **query index** (`entity_indexes.doc`).
- Fulltext/token search reads `search_tokens`.
- Vector search reads the embedding index.
- Coverage badges read a periodically-recomputed `COUNT`.
- The CRUD list API response cache (`ENABLE_CRUD_API_CACHE`) caches assembled list payloads, tag-invalidated on write.

After PR #2549 the **query-index projection row** is updated synchronously inside the write path (`emitOrmEntityEvent` awaits `query_index.upsert_one`/`delete_one`), so a read issued immediately after a write observes the new `customValues`/scalar doc. **The heavy tail is still deferred fire-and-forget** to keep write latency bounded:

- `upsert_one` subscriber defers: search-token rebuild (`reindexSearchTokensForRecord`), `query_index.vectorize_one`, `search.index_record`.
- `delete_one` subscriber defers: `query_index.coverage.refresh` (a `COUNT`) and `search.delete_record`.

This eventual-consistency tail is the right default — it trades a few-millisecond convergence window for low write latency, and read-after-write of the *projection* is already guaranteed. But some operators run workloads (compliance reporting, automated pipelines reading immediately after a bulk write, deterministic integration suites, single-process deployments) where they would rather pay write latency to **guarantee every projection — tokens, vectors, fulltext, coverage — is converged the moment a write returns**, and to have index-write failures surface **loudly** instead of drifting silently.

This spec adds an **opt-in, default-OFF, 100% backward-compatible** env flag — `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` — that makes the deferred tail run **inline (awaited)** and **atomically** within the index write, and lets index-write errors **propagate** so the operator learns about drift instead of swallowing it.

> **Naming note.** "Cache" in the flag name reflects operator intent ("make sure my caches/read-projections are always relevant"). The CRUD API response cache (`ENABLE_CRUD_API_CACHE`) is *already* invalidated synchronously (awaited `invalidateCrudCache` in both the CRUD factory and the command bus); this spec does **not** change it. The flag governs the **query-index read-projection tail** (tokens, vectors, fulltext, coverage), which is the actual eventual-consistency surface.

## 2. Goals / Non-Goals

### Goals
- Add `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` (default OFF). When ON:
  - The deferred query-index tail runs **inline** in the write path (search-token rebuild, vectorize, fulltext index/delete, coverage refresh).
  - The per-record index writes (projection row + search tokens + coverage delta) move **all-or-nothing** via a single Kysely transaction at the subscriber layer.
  - Index-write failures **propagate** to the originating write instead of being swallowed, so the request fails loudly / can be retried.
- 100% backward compatibility: default OFF reproduces today's behavior exactly (projection sync per #2549, tail deferred, errors logged-not-thrown).
- Reinforce, in monorepo **and** standalone (`create-app`) docs, the existing `withAtomicFlush` transaction-safety contract for the **domain-write** side and its relationship to side-effect/commit timing.

### Non-Goals
- **No single transaction spanning {domain write + index projection}.** Side effects fire **after** the domain write commits (the documented `withAtomicFlush` contract — `flush.ts:117-118`; command bus drains side effects at `command-bus.ts:292/351`, post-commit). True write+index atomicity would require moving the projection emit *inside* the write transaction and is explicitly **out of scope** (§7).
- Not changing the CRUD response cache (`ENABLE_CRUD_API_CACHE`) semantics — already synchronous.
- Not changing default latency characteristics for anyone who does not set the flag.

## 3. Current architecture (verified)

| Concern | Location | Behavior today |
|---|---|---|
| Per-request EM | `packages/shared/src/lib/di/container.ts:144-157` | One forked `EntityManager` registered `asValue(em)`; `dataEngine` closes over the **same** `em`. |
| Subscriber EM | `query_index/subscribers/{upsert,delete}_one.ts` (`ctx.resolve('em')`) | Resolves the **identical** forked `em` — not a fresh fork. |
| Index writes | `query_index/lib/indexer.ts` (`em.getKysely()`) | Written via **raw Kysely**, *not* the MikroORM UnitOfWork. `replaceSearchTokensForRecord` opens its **own** `db.transaction()` (`search-tokens.ts:152`). |
| Emit | `shared/src/lib/data/engine.ts:578,597,603` | `query_index.upsert_one`/`delete_one` **awaited** (post #2549); `coverage.refresh` + the subscribers' `vectorize_one`/`search.index_record` are **fire-and-forget** (`void`). |
| Error handling | `events/src/bus.ts:127-129`; `engine.ts` `void …catch`; `engine.ts:668`; `command-bus.ts:645` | Subscriber errors are **swallowed** (logged) at every layer — index drift never fails the originating write. |
| Side-effect timing | `command-bus.ts:290-292, 350-351` | `invalidateCrudCache` then `flushOrmEntityChanges` run **after** the handler commits. |

**Why `withAtomicFlush` cannot make the tail atomic with the write:** (1) the domain write has already committed by the time the emit fires — there is no open transaction to join (`withAtomicFlush` re-entrancy finds `isInTransaction()===false`); (2) the tail is raw Kysely, which `withAtomicFlush` (a MikroORM-UoW helper) does not govern; (3) `replaceSearchTokensForRecord` already opens its own transaction, so naively nesting another on the same connection risks a nested-transaction/deadlock hazard. `withAtomicFlush` remains the correct tool for the **domain-write** phases (scalar + relation syncs) — that contract is unchanged and is reinforced in docs (§6).

## 4. Design

### 4.1 The flag

New helper in `@open-mercato/shared` (infra; no domain deps):

```
packages/shared/src/lib/data/consistency.ts
  parseAlwaysConsistentEnv(raw: string | undefined | null): boolean   // pure, testable
  isReadProjectionAlwaysConsistent(): boolean                          // memoized read of process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT
```

- Parse with the shared `parseBooleanWithDefault(raw, false)` grammar (`on/true/1/yes` → ON; unset/empty/anything else → OFF). Mirrors the `OM_OPTIMISTIC_LOCK` env-parser pattern (`crud/optimistic-lock.ts`).
- Memoize like `isCrudCacheEnabled()` (read once); expose a test-only reset (`__resetAlwaysConsistentCacheForTests`) matching existing patterns.

### 4.2 Engine: await + propagate when ON

`shared/src/lib/data/engine.ts` `emitOrmEntityEvent`:

- `query_index.upsert_one` / `delete_one` are already `await`ed (#2549). When the flag is **ON**, **do not swallow** their errors — let them reject so `flushOrmEntityChanges` → the command bus surfaces the failure. When **OFF**, keep the existing `…catch(log)` behavior (unchanged).
- `query_index.coverage.refresh` (engine.ts:603): `await` it when ON (today it is `void`). When OFF, unchanged. (Respect the existing 5-minute throttle — see §4.5.)

### 4.3 Subscribers: inline + one Kysely transaction when ON

`query_index/subscribers/upsert_one.ts` and `delete_one.ts`:

- Read `isReadProjectionAlwaysConsistent()` once at the top.
- **OFF (default):** byte-for-byte the #2549 behavior — projection sync, `deferSearchTokens: true`, heavy tail in the `void (async () => …)()` block.
- **ON:**
  - **upsert:** call `upsertIndexRow(..., { deferSearchTokens: false, trx })` so the token rebuild happens inline, and `await` `vectorize_one` + `search.index_record` instead of deferring.
  - **delete:** remove the projection row + tokens inline (already sync), then `await` `coverage.refresh` + `search.delete_record`.
  - Wrap the per-record index work (projection row upsert/delete + coverage delta + token replace) in **one** `db.transaction().execute(trx => …)` so index state moves all-or-nothing. Thread `trx` through `upsertIndexRow` / `markDeleted` / `replaceSearchTokensForRecord` and have them **reuse** an injected `trx` instead of opening their own `db.transaction()` (avoids the nested-transaction hazard).
  - On error: rethrow (do not call `recordIndexerError`-and-swallow) so the engine/bus path propagates it.

### 4.4 Indexer: accept an optional `trx`

`query_index/lib/indexer.ts` — extend `upsertIndexRow`, `markDeleted`, `reindexSearchTokensForRecord`, `replaceSearchTokensForRecord`, `deleteSearchTokensForRecord` to accept an optional `trx?: Kysely.Transaction` (or the executor) and use it when provided, falling back to `em.getKysely()` and their own `db.transaction()` otherwise. **Additive** — no existing caller changes.

### 4.5 Coverage: explicit decision

Coverage refresh is throttled (`shouldTriggerCoverageRefresh`, 5-min window, `engine.ts:40-48`) and intentionally eventually-consistent. **Decision:** when the flag is ON, run the coverage `COUNT` **inline and bypass the throttle for that write** so the badge count is converged on return. Document this as the most expensive part of the ON path. (Alternative considered: leave coverage eventual even when ON — rejected, because it would make "always consistent" misleading. Implementer may gate this sub-behavior behind the same flag with a code comment if COUNT cost proves prohibitive in bulk paths; if so, document the carve-out.)

### 4.6 Error propagation chain (must all be reversed when ON)

For the flag to surface failures, propagation must be added at **each** swallow point — otherwise the awaited tail still fails silently and the flag is a no-op:

1. `events/src/bus.ts:127-129` — ephemeral-handler try/catch. Add an opt-in "rethrow when consistent mode" path (e.g. a per-emit option or a check the bus already has access to) **without** changing default delivery semantics.
2. `engine.ts:578/597/603` — `void …catch` → `await` + rethrow when ON.
3. `engine.ts:668` (`flushOrmEntityChanges` per-entry swallow) → rethrow when ON.
4. `command-bus.ts:645` (`flushCrudSideEffects` swallow) → rethrow when ON, so the command fails.

Each change is **guarded by the flag**; OFF keeps today's fail-open contract.

## 5. Backward compatibility

- **Default OFF ⇒ zero behavior change.** Every new branch is gated on `isReadProjectionAlwaysConsistent()`; unset env reproduces the #2549 baseline exactly (projection sync, tail deferred, errors logged-not-thrown).
- All signature changes are **additive optional params** (`trx?`, options bag fields). No event IDs, DI keys, DB schema, or public types removed. Conforms to `BACKWARD_COMPATIBILITY.md` (additive-only).
- New env var is additive and documented (`.env.example`, `packages/cache/AGENTS.md`, docs).

## 6. Documentation & skills updates (monorepo + standalone parity)

The research surfaced a **parity gap**: the monorepo has a mature `withAtomicFlush` "Entity Update Safety" section (`packages/core/AGENTS.md:507-552`) but the canonical standalone source (`packages/create-app/agentic/shared/AGENTS.md.template`) has **none**, and no doc anywhere ties **cache/side-effect invalidation to commit timing**. This spec's doc phase MUST:

**Monorepo**
- `packages/cache/AGENTS.md` — add a "Consistency vs commit timing" note: cache invalidation + index side effects fire **after** the domain write commits; document `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` (default OFF) and its latency/consistency tradeoff.
- `packages/core/AGENTS.md` (Entity Update Safety) — add a cross-reference: side effects/cache fire after commit; link the flag spec.
- `packages/core/src/modules/customers/AGENTS.md` (reference module) — add a transaction-safety mechanism row.
- `.ai/skills/om-implement-spec/SKILL.md` — add a "Transaction safety" mechanisms row (use `withAtomicFlush({ transaction: true })` for multi-phase writes; side effects after commit).

**Standalone (`create-app`)** — bring to monorepo parity:
- `packages/create-app/agentic/shared/AGENTS.md.template` — add the "Entity Update Safety / `withAtomicFlush`" section mirroring `core/AGENTS.md` + the cache-after-commit + flag note.
- `packages/create-app/template/AGENTS.md` — add a short Transaction Safety section.
- `packages/create-app/agentic/shared/ai/skills/om-code-review/references/review-checklist.md` — parity items (`withAtomicFlush` across phases; no `em.find`/`em.findOne` between mutation and flush; cache invalidation after commit).
- `packages/create-app/agentic/shared/ai/skills/om-spec-writing/references/spec-checklist.md` — require specs touching multi-phase writes to name `withAtomicFlush` + declare cache/side-effect timing.
- `packages/create-app/agentic/shared/ai/skills/om-data-model-design/SKILL.md` — add a `withAtomicFlush` callout near the bare `em.flush()` examples.
- `packages/core/src/modules/customers/agentic/standalone-guide.md` — append the cache-after-commit sentence to its existing Entity Update Safety section.

> Per `create-app/AGENTS.md` Always rule #8, monorepo transaction-safety/cache doc edits MUST be mirrored into the standalone surfaces in the same change.

## 7. Out of scope / future

- **True write+index atomicity.** Would move the projection emit inside the write transaction (drain `markOrmEntityChange` as a pre-commit phase on the same connection) — contradicts the current "side effects after commit" contract and the bus's error-swallowing; a separate decision if ever required.
- Making coverage globally synchronous regardless of the flag.

## 8. Risks

- **Latency regression (intended, opt-in):** ON re-serializes exactly the tail #2549 deferred (build doc + encrypt/decrypt SELECTs, token DELETE + chunked INSERT, coverage `COUNT`, vectorize, fulltext) into write latency; worst for large token docs and bulk deletes. Mitigation: default OFF; documented tradeoff; keep the index transaction short and ordered (row → tokens → coverage).
- **Nested transactions:** `replaceSearchTokensForRecord` opens its own `db.transaction()`; ON must thread a single `trx` through, never nest on the same connection.
- **Partial drift even when ON:** because the tail runs post-commit, an inline failure can still leave the committed row with stale index — the flag converts *silent* drift into a *loud, awaited* error (request fails / retryable), it does **not** make the two writes one transaction (§7).
- **Error-propagation completeness:** every swallow layer (§4.6) must be reversed under the flag or ON is a silent no-op.
- **Deadlock contention:** inline tail runs on the same connection that just committed; keep the index transaction short and consistently ordered.

## 9. Integration & test coverage

Unit (Jest):
- `parseAlwaysConsistentEnv` grammar (on/off/default-off) — `packages/shared/src/lib/data/__tests__/consistency.test.ts`.
- `query_index` indexer: with an injected `trx`, `upsertIndexRow`/`markDeleted` reuse it and do **not** open a new transaction (`packages/core/src/modules/query_index/__tests__/indexer.test.ts`).
- Subscriber branch: flag OFF defers tail (existing behavior), flag ON awaits + wraps in one transaction; error rethrows when ON, swallowed when OFF.

Integration (Playwright, per-module under `__integration__/`):
- `OM_CACHE_SAFETY_ALWAYS_CONSISTENT=on`: create a record, **immediately** query the fulltext/search endpoint (not the projection) and assert tokens are present with **no** `expect.poll` — proving the token tail converged synchronously. (Reuse the surface from `TC-CRM-CF-MULTI-EDIT-001` / `TC-CAT-CF-MULTI-EDIT-001` but extend to the token/search read.)
- `OM_CACHE_SAFETY_ALWAYS_CONSISTENT=on`: delete a record, immediately read coverage and assert the `COUNT` reflects the delete without polling.
- Flag OFF: existing specs remain green unchanged (BC proof).
- Self-contained fixtures created/torn down in-test (no seeded-data reliance) per `.ai/qa/AGENTS.md`.

## 10. Implementation phases

1. **Flag helper** — `consistency.ts` + unit tests.
2. **Indexer `trx` threading** — additive optional `trx` on indexer/search-token helpers + unit tests.
3. **Subscriber inline+transaction path** — gated branches in `upsert_one`/`delete_one`.
4. **Engine + bus + command-bus error propagation** — flag-gated rethrow at all four swallow layers.
5. **Coverage inline** — bypass throttle when ON.
6. **Docs/skills parity** (§6) — monorepo + standalone.
7. **Integration specs** (§9) + full validation gate (`yarn build:packages`, `yarn typecheck`, `yarn lint`, `yarn test`).

## 11. Changelog

- _Unreleased_ — Spec drafted (follow-up to PR #2549).
