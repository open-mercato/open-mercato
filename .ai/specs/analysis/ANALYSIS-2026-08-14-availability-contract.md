# Pre-Implementation Analysis: Availability Contract

> **Source**: `adeptofvoltron/open-mercato` fork PR #9, branch `spec/ecommerce-module-suite`, commit `e97c98d9266cebbbdcb193af335ba4b8ef551eec` — spec-only PR, not yet merged, not in this repo's tree.
> **Analyzed against**: this repo's own `develop` (worktree `62e2b7af`), including `.ai/specs/2026-04-15-wms-roadmap.md` rev 10 (2026-08-17), which independently designed the same concept under this repo's own Phase 0.

---

## Executive Summary

The fork's `availability-contract.md` is a well-argued, implementation-ready design for a real gap (SPEC-029 uses an `availability` union with no producer). It is internally consistent, grounded in accurate reads of this repo's `wms`/`catalog` code, and covers risks, phasing, and integration coverage in more depth than most specs at this stage. **It is not ready to implement as-is**, for one dominant reason: this repo's own `.ai/specs/2026-04-15-wms-roadmap.md` already contains an approved, reviewed, differently-shaped design (ADR-4 / "Cross-Module Availability Contract", rev 10, Verdict: Approved) for the *exact same* platform seam — batch vs. single-item query shape, module-vs-shared-lib placement, and DI-override-vs-explicit-registry are all different. Implementing either spec first makes the other stale and creates two competing `AvailabilityResult` shapes that `checkout`/`cart`/`catalog` callers cannot both target. Secondary blockers: no per-tenant provider selection mechanism, and `reserve`/`release`/`commit` are specified as plain async methods with no stated command/undo modeling despite mutating stock. **Recommendation: Needs spec updates first** — reconcile with `wms-roadmap.md` §"Cross-Module Availability Contract" before either design proceeds.

---

## Fork vs. This-Repo Design Divergence (headline finding)

Both designs answer "can this buyer get this quantity of this variant" and both are grounded in the same real `wms` code (`InventoryBalance.quantity_available` as a stored generated column, `ProductInventoryProfile.safety_stock`/`reorder_point`, `InventoryReservation`). They diverge on every load-bearing decision:

| Dimension | Fork (`availability-contract.md`) | This repo (`wms-roadmap.md` rev 10, approved) |
|---|---|---|
| **Query shape** | Batch: `check(items: AvailabilityItemRef[], scope)` → `AvailabilityResult.byKey` | Single-item: `AvailabilityQuery { catalogProductId, catalogVariantId?, requestedQuantity? }` → one `AvailabilityResult` |
| **Result states** | `in_stock \| low_stock \| out_of_stock \| backorder \| preorder \| not_tracked` (6) | `in_stock \| low_stock \| out_of_stock \| backorder \| unknown` (5, no `preorder`) |
| **Result fields** | `sellableQuantity`, `canFulfil`, `leadTimeDays`, `releaseAt`, `maxOrderQuantity`, `policySourceId` | `quantityAvailable`, `providerId`, `message` |
| **Module placement** | New `packages/core/src/modules/availability/` (full module scaffold: `index.ts`, `acl.ts`, `setup.ts`, `api/`, `backend/`, `i18n/`) | `packages/shared/src/lib/availability/` (no new module; zero install/eject footprint) |
| **Provider mechanism** | `wms/di.ts` registers under the *same DI key*, overriding the fallback; "registration order is module load order" | Explicit `availabilityProviderRegistry` (mirrors `llmProviderRegistry`) with `.register(provider)`/`.get(id)`/`.list()` |
| **Provider selection** | Not specified — whichever implementation registered last for the process wins, for every tenant | `ModuleConfigService('availability', 'selectedProvider')`, tenant-scoped, `auto`/`wms`/`catalog-only`, safe fallback on stale selection |
| **DI contract name** | `availabilityService` (single interface with `check`/`reserve`/`release`/`commit`) | `resolveAvailability(container, query)` (function) + registry, no reservation surface |
| **New DB surface** | New `AvailabilityPolicy` entity/table + admin CRUD routes | None — reuses existing `module_configs` table only |
| **Reservation lifecycle** | In scope: `reserve`/`release`/`commit`, new `'checkout'` reservation source type, expiry/reconciliation jobs | Out of scope — availability is read-only; reservation stays entirely inside `wms`'s existing commands |

**Why this matters, concretely**: a `cart` or `checkout` module built against the fork's `availabilityService.check(items[])` cannot consume this repo's `resolveAvailability()` (single item, no batch, no `canFulfil`/`leadTimeDays`/`preorder`) without a rewrite, and vice versa. Whichever ships first becomes the frozen DI/type contract per `BACKWARD_COMPATIBILITY.md` categories 2 (Type Definitions) and 9 (DI Service Names) — the other is then a breaking migration, not an additive one. This is exactly the collision those two BC categories exist to catch, and it is currently invisible to both spec authors because they are in different repositories.

**On product fit — which shape is more implementation-ready:**
- **Batch is the right call for the real callers.** A cart/checkout re-validation and a PDP/listing page both need N-item availability in one round trip; this repo's own risk R4 ("N+1 on listing pages", Critical) is exactly the failure mode a single-item contract invites unless every caller hand-rolls batching on top of `resolveAvailability()`. The fork's contract bakes batching into the type; this repo's design pushes it to each caller.
- **This repo's provider-selection and placement are more implementation-ready.** An explicit registry with per-tenant `ModuleConfigService` selection is testable, has a documented fallback-on-stale-selection rule, and needs zero new module (no `acl.ts`, no `setup.ts`, no role-ACL sync, no eject/toggle machinery) for every tenant that just wants availability without WMS. The fork's "last DI registration wins, order = module load order" mechanism is undocumented anywhere in this repo's AGENTS.md as a sanctioned override pattern (the sanctioned patterns are the optional-peer `tryResolve` pattern and the provider-registry pattern used by `llmProviderRegistry` — see AGENTS.md compliance below) and provides no way to keep some tenants on `catalog-only` once `wms` is installed process-wide.
- **Recommendation**: keep the fork's batch query shape and richer result fields (`preorder`, `leadTimeDays`, `canFulfil`, `maxOrderQuantity` are genuinely useful and absent from this repo's design), but adopt this repo's placement (`packages/shared`, not a new module) and provider-registry/`ModuleConfigService` selection mechanism. The `AvailabilityPolicy` entity and admin CRUD (fork §5, §8) are a legitimate net-new capability (this repo's design has no sell-policy model at all) and should be kept, but hosted as an optional module that depends on the shared contract rather than being the module that defines it.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | 2 (Type Definitions), 9 (DI Service Names) | Fork defines `AvailabilityQuery`/`AvailabilityResult`/`AvailabilityService`/`availabilityService` shapes that conflict with the already-approved `AvailabilityQuery`/`AvailabilityResult`/`AvailabilityProvider`/`resolveAvailability()` shapes in `wms-roadmap.md` rev 10. Neither is shipped yet, so this is not a BC break *today*, but the first one to ship freezes the contract per these categories, making the other a breaking migration. | **Critical** | Reconcile before implementation — see Divergence section above. Do not implement either spec until one supersedes the other in this repo's own `.ai/specs/`. |
| 2 | 8 (Database Schema, additive-only) | `InventoryReservationSourceType` union extension (`'order' \| 'transfer' \| 'manual'` → `+ 'checkout'`) — verified against `packages/core/src/modules/wms/data/entities.ts:15`, matches exactly. | None (compliant) | Correctly classified by the fork spec itself (§4.4) as additive; `UPGRADE_NOTES.md` entry for the now-non-exhaustive switch is correctly called out (R8). |

### Missing BC Section

The spec has no dedicated **"Migration & Backward Compatibility"** section (the skill's Phase 3 checklist and `.ai/specs/AGENTS.md` both expect one for any spec touching a contract surface). BC-relevant statements are scattered across §4.4 (reservation source type) and §15 (compliance table). Given this spec introduces a brand-new DI contract *and* collides with an existing approved design for the same contract, a consolidated section is not optional — the collision itself needs to be the first thing a reader of this spec sees. **Recommendation: add one, and open with the divergence against `wms-roadmap.md`.**

---

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Migration & Backward Compatibility (consolidated) | Reader cannot assess contract-freeze risk from one place | Add per above |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| UI/UX | Only one line in §12 ("policy list, policy edit with the resolution-chain preview, admin check tool") and a directory stub (`backend/`); no wireframe/description of the resolution-chain preview UI mentioned as a required feature | Add a short UI/UX section, at minimum for the resolution-chain preview since it is called load-bearing for support/debugging (§8, `policySourceId`) |
| Architecture — Commands | `reserve`/`release`/`commit` are specified as plain `Promise`-returning interface methods with no mention of the command pattern, undo, or `extractUndoPayload()` | See Gap Analysis — Critical |
| Architecture — provider selection | No mechanism described for choosing between `wms`-backed and fallback implementations beyond "module load order"; no per-tenant override | See Gap Analysis — Critical |
| Widget Injection | No mention of surfacing availability/policy state inside `catalog`'s product/variant edit pages via injected form groups (this repo's own `wms-roadmap.md` explicitly plans this for WMS profile fields on the same pages) | Nice-to-have — cross-reference with catalog product edit injection points |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `packages/core/AGENTS.md` § Commands & Undo/Redo (root AGENTS.md "Always" + review checklist §6): all write operations are implemented as undoable commands via `registerCommand`, with `extractUndoPayload()` | Fork §4.1 `AvailabilityService.reserve`/`.release`/`.commit` | Specify whether these delegate to `wms`'s already-command-driven `reserveInventory`/`releaseReservation` (which *are* undoable per `wms-roadmap.md`'s "Shared command families"), or define their own command wrappers. As written, the contract's write surface bypasses the command layer entirely, which the fork's own §2.3 problem statement rightly flags as the wrong pattern for direct `wms` querying — it should apply equally to direct `wms` writing. |
| `packages/core/AGENTS.md` § Cross-Module Coupling — sanctioned mechanisms are events, widget injection + enrichers, FK-id + snapshot, and (for optional peers) the local `tryResolve` pattern; provider override is only demonstrated in this repo via the explicit registry pattern (`llmProviderRegistry`) | Fork §3.1/§4.1: `wms/di.ts` "registers its implementation under the same DI key, overriding the fallback... Registration order is module load order" | This is a fourth, undocumented override mechanism (silent last-registration-wins keyed to declared `requires` order) rather than either sanctioned pattern. It is not proven unsafe, but it is untested against this repo's actual DI bootstrap (Awilix container construction order across dev/standalone/hot-reload) and gives no seam for per-tenant selection. Recommend adopting the explicit-registry pattern this repo's own design already specifies and reviewed as compliant. |
| `packages/core/AGENTS.md` § ACL Grant Sync | Fork §8.1 declares `acl.ts` features but §3.1/§13 never mention `setup.ts` `defaultRoleFeatures` for `admin`/`employee` | Add explicit `defaultRoleFeatures` entries and a call-out to run `yarn mercato auth sync-role-acls` post-implementation, matching the pattern every other module spec in this repo follows |
| `.ai/review-checklist.md` §1 "optional integration is soft-optional... never an unconditional `container.resolve('<peerService>')` or a hard `requires` on an optional peer" | Not violated for `wms` (fork correctly keeps `wms` optional to `availability` via fallback), but the umbrella `ecommerce-roadmap.md`'s dependency graph (companion doc) has `cart`, `checkout`, `availability` (ATP check) as a hard edge in Section 4, and fork §15 states `ecommerce`, `cart`, `checkout` "import only `availability/lib/contract`" — implying a hard `requires: ['availability']` on every commerce module | Not a rule violation per se (availability is not itself an optional/ejectable peer to those modules in the fork's design — it is core infrastructure, same category as `sales`/`catalog`), but it is a materially heavier footprint than this repo's `packages/shared` placement, which needs no `requires` edge at all from any consumer. Worth stating explicitly as an architecture trade-off, not silently absorbing it. |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Two competing, unreconciled designs for the same DI/type contract ship independently (fork PR vs. this repo's `wms-roadmap.md` Phase 0) | Whichever lands first freezes `AvailabilityQuery`/`AvailabilityResult`/the DI key per BC categories 2 and 9; the other becomes a breaking rewrite for every consumer (`cart`, `checkout`, `ecommerce`, `catalog`) | Reconcile the two specs into one before either is implemented; this repo's `.ai/specs/2026-04-15-wms-roadmap.md` is the one already reviewed and approved in *this* repository — treat it as the base and merge the fork's superior batch-query shape, richer states, and `AvailabilityPolicy` entity into it, rather than implementing the fork's module-shaped design in parallel |
| No per-tenant provider selection (DI-key-override-by-load-order instead of `ModuleConfigService`-backed selection) | A multi-tenant deployment cannot run some tenants on `catalog-only` and others on `wms`-backed availability once `wms` is installed process-wide; no documented fallback when a tenant's prior selection becomes invalid | Adopt this repo's `ModuleConfigService('availability', 'selectedProvider')` per-tenant pattern with the `auto`/explicit-id/safe-fallback-to-`catalog-only` rules already specified and reviewed in `wms-roadmap.md` |
| `reserve`/`release`/`commit` are unspecified with respect to the command/undo pattern despite mutating stock | Inconsistent undo/audit behavior versus every other stock-mutating operation in `wms`, which is fully command-driven; harder to reason about idempotency/retry semantics that the spec itself requires in §12 | Specify that `reserve`/`release`/`commit` either delegate to `wms`'s existing commands (`reserveInventory`, `releaseReservation`) or are themselves registered via `registerCommand` with `extractUndoPayload()` |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| New full module scaffold (`packages/core/src/modules/availability/`) vs. zero-footprint `packages/shared` placement | Every tenant that wants availability info (which is effectively every commerce tenant) now carries a new module with its own ACL sync, setup hooks, eject/toggle machinery, and admin routes, where this repo's own design needed none of that | If the fork's richer contract is adopted, host it in `packages/shared` per this repo's design, and make `AvailabilityPolicy` + its admin CRUD a separate, genuinely optional module that depends on the shared contract |
| DI-key override mechanism untested against this repo's actual bootstrap/module-load ordering | A standalone app or dev-mode module-instance duplication could see `wms`'s override lost if the two modules load through different bundler chunk instances, silently reverting to the `not_tracked` fallback | Same fix as above — use an explicit registry (this repo's own design already plans to mirror `llmProviderRegistry`) |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Fork's `AvailabilityResult.byKey` product-level rollup key convention (`${productId}:${variantId ?? '-'}`) is a stringly-typed composite key | Minor ergonomics/typo risk for consumers | Low priority; note in implementation, not blocking |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- **Unreconciled dual design for the same contract**: this spec cannot be implemented without first deciding, in this repo's own `.ai/specs/`, which of the two `AvailabilityQuery`/`AvailabilityResult` shapes (or a merged third shape) is canonical. This is the blocking gap.
- **No command/undo modeling for `reserve`/`release`/`commit`**: needed before implementation per root AGENTS.md "write operations MUST be undoable commands."

### Important Gaps (Should Address)

- **No per-tenant provider selection mechanism**: needed for multi-tenant flexibility and to match the safety rules this repo already worked out for the identical problem (stale-selection fallback).
- **No `setup.ts` `defaultRoleFeatures` for the new ACL features**: needed for existing tenants to receive the grants without a manual sync step being forgotten.
- **No stated DI bootstrap safety story** for the "same DI key, last-registration-wins" override (globalThis / registry pattern vs. plain module-local override).

### Nice-to-Have Gaps

- Widget injection of policy/availability state into `catalog` product/variant edit pages (the fork's own admin UI is a separate CRUD surface rather than surfaced in-context).
- Dedicated UI/UX section with the resolution-chain preview described, since §8 calls it load-bearing for support.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Reconcile with `wms-roadmap.md` §"Cross-Module Availability Contract"**: produce a single canonical `AvailabilityQuery`/`AvailabilityResult` shape (recommend: fork's batch shape + richer states/fields, this repo's placement in `packages/shared` + `ModuleConfigService`-backed per-tenant selection + explicit registry). Update or supersede one of the two documents explicitly, with a changelog entry recording the merge decision.
2. **Specify command/undo behavior for `reserve`/`release`/`commit`**, or explicitly state they delegate to `wms`'s existing undoable commands.
3. **Add a consolidated Migration & Backward Compatibility section** that leads with the dual-design collision.

### During Implementation (Add to Spec)

1. Add `setup.ts` `defaultRoleFeatures` for the new `availability.*` ACL features and the `yarn mercato auth sync-role-acls` follow-up.
2. Add a UI/UX section covering the resolution-chain preview and admin check tool.
3. Decide and document the registry's bootstrap-safety story (globalThis-backed vs. plain module singleton).

### Post-Implementation (Follow Up)

1. Consider widget injection of availability/policy state into `catalog` product/variant edit pages, mirroring the plan already documented for WMS profile fields on the same pages.
2. Revisit Open Question #1 (`reserve_at_cart` for scarce goods) once real usage data on abandonment/oversell rates exists.

---

## Recommendation

**Needs major revision** — specifically, reconciliation with this repo's own already-approved `wms-roadmap.md` Phase 0 design before any implementation work begins on either. The fork's spec is otherwise strong (accurate codebase grounding, thorough risk/testing sections, better product shape for the query surface) and most of its content survives a merge; the blocker is process (two independent, conflicting designs for one contract), not spec quality.

---

## Changelog

### 2026-08-17
- Initial pre-implementation analysis, performed against fork PR #9 (`adeptofvoltron/open-mercato`, commit `e97c98d9`) and this repo's `develop` worktree, per the `om-pre-implement-spec` skill workflow.
