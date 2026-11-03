# Pre-Implementation Analysis: Buyer-Scoped Catalog Visibility — Phase 2 only

> **Spec**: `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` (changelog to 2026-09-16).
> **Release scope analysed**: **Phase 2 only** — `ecommerce` composition (`BuyerContext.assortmentScope` via `intersectScopes`), `require_authentication` column and the resolver short-circuit, and the admin UI additions to the channel-binding form. Phases 1 (shared contract + `customer_groups` resolution), 3 (cart write path) and 4 (per-customer overrides) were checked only as dependencies or exclusions.
> **Analysed against**: `develop` @ `a108dd07f4` (2026-10-05).
> **Note**: the spec's changelog cites `ANALYSIS-2026-08-21-buyer-scoped-catalog-visibility.md`; that file is **not in the repo** (`.ai/specs/analysis/` checked). Consolidated decisions: `ANALYSIS-2026-10-05-storefront-release-decisions.md`.

---

## Executive Summary

Phase 2 has almost no surface of its own: since v4.2 every item in it is already written into SPEC-029 (§5.3 `require_authentication`, §4.1 step 6 short-circuit and `intersectScopes`, §11 Channels tab). It is therefore implemented **as part of SPEC-029 Phases 1 and 3**, and its gate ("Storefront Public API's existing cross-context isolation suite still passes unmodified") cannot run before Public API Phase 1 exists. Its Phase 1 prerequisite is **only partly on `develop`**: the shared algebra shipped (with an extra `allOf` field on `AssortmentScope` that the spec does not describe, and a hand-rolled seeded property generator instead of `fast-check`), but `resolveAssortmentScope()` is a stub returning `scope: null` for every buyer, because #6709 withheld the `CustomerGroupTerms.assortment_scope` column — the code comment calls it "Phase 5 scope", while `customer-groups-and-b2b-terms.md` §5.3 specifies it and its Phase 5 is the per-customer override. Excluding Phase 3 (cart write-side enforcement) is **safe for this release only because no `cart` module exists on `develop`** — there is no storefront write path to bypass the read-side gate. **Recommendation: ready to implement after three spec fixes** (phase boundary for the exclude pickers, `allOf` + canonical hash, the `503`/empty wording) and decision D13 (whether group scopes become real in this release).

---

## Phase 1 dependency status (verified)

| Phase 1 deliverable | On `develop`? | Evidence | Consequence for Phase 2 |
|---|---|---|---|
| `AssortmentScope`, `EffectiveAssortmentScope`, `ScopedProduct` | Yes, plus `allOf?: AssortmentScope[]` | `shared/lib/catalog-visibility/types.ts:6-31` | Channel-binding validator must reject `allOf` in admin input (types.ts says single sources never carry it); hash canonicalization must recurse into it. |
| `matchesOne`/`matchesScope`/`unionScopes`/`intersectScopes` | Yes | `matchesOne.ts:18`, `matchesScope.ts:5`, `unionScopes.ts:12`, `intersectScopes.ts:89` | Usable as-is. `intersectScopes(c, null)` → `[c]`; `(null, g)` → same reference `g`. Branches are merged objects with residual `allOf`, not pairs. |
| Property-based tests | Yes, hand-rolled (`mulberry32`, 5 000 cases) | `__tests__/testFixtures.ts:3-18`, `intersectScopes.test.ts:37` | The spec's "harness is in place" (`.ai/specs/2026-04-24-agentic-property-based-testing.md`) is not `fast-check`; reuse the existing generator for Phase 2 properties. |
| `packages/shared/AGENTS.md` Library Directory row | Yes | `packages/shared/AGENTS.md:41` | Row already claims `ecommerce` builds on it — accurate once this ships. |
| `customerGroupsService.resolveAssortmentScope()` | Signature yes; behaviour stub | `services/customerGroupsService.ts:86-111, 341` — input `{ customerId, tenantId, at? }` (spec omits `tenantId`); `groupOwnAssortmentScope()` returns `null`; `sourceCustomerOverrideId` always `null` | Every authenticated buyer resolves to `scope: null` → effective scope = channel scope alone. R7, US-A3 and "channel ∩ group" tests are hollow until the column exists (D13). |
| `CustomerGroupTerms.assortment_scope` column | **No** | No column in entity or the five migrations | Spec 1 §5.3 vs code divergence (code = current behaviour, spec = intent). |
| `ResolvedTerms.assortmentScope` removed | Yes | `ResolvedTerms` fields `priceKindId, paymentTermsDays, allowPurchaseOnAccount, approvalRequiredAbove, minOrderValue, sources` (`customerGroupsService.ts:36-43`) | — |
| Canonicalization / `assortmentScopeHash` helper | **No** | grep for `canonicaliz*Scope`, `hashScope`, `assortmentScopeHash`: zero code hits | Needed by SPEC-029 §6.1 in this release; should live in `packages/shared` next to the algebra (cart, offline mode and customer_groups will need the same hash). |
| SQL twin of `matchesScope` (`scopeKeys`) | **No** | spec-only (`storefront-public-api.md:118`) | Owned by Public API; see that analysis, D9. |

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | 2 Types (`shared`) | Spec's `AssortmentScope` (§3.3) lacks `allOf`; the shipped type has it. Not a break — the spec is stale relative to code. | Warning | Document `allOf` in §3.3 as an intersection-internal field; never accepted from admin input. |
| 2 | 3 Signatures (`customer_groups`) | Spec §5.1 signature `{ customerId, at? }`; shipped `{ customerId, tenantId, at? }`. Spec must follow code (DI interface is STABLE). | Warning | Update §5.1 and SPEC-029 §4.1 call sites. |
| 3 | 8 DB schema | `require_authentication` on a new table (`ecommerce_store_channel_bindings`) — no existing schema touched. If D13 is "yes", `customer_group_terms.assortment_scope jsonb null` is an additive column. | None | — |
| 4 | 5, 6, 7, 9, 10, 11 | Phase 2 adds no event, spot, route, DI key, ACL feature or notification type of its own (all under SPEC-029). `ecommerce.visibility.diagnose` belongs to the optional explainability tool, not Phase 2. | None | — |
| 5 | 1, 4, 12, 13, 14 | None. | None | — |

### Missing BC Section

Present in substance (§13 "Contracts and compatibility"); its claim "nothing here exists on `develop` yet" is **no longer true** — the shared contract and `resolveAssortmentScope` shipped in #6709, so further changes to them are now governed by BC categories 2, 3 and 9.

---

## Spec Completeness

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §12 Phase 2 vs Phase 3 | Phase 2: "admin UI additions to the channel-binding form". Phase 3: "admin group-terms/channel-binding pickers for the new exclude fields". With Phase 3 excluded, the channel-binding exclude pickers fall out of this release by the letter of the spec, while SPEC-029 §11 and US-B1 expect them. | D14: move the channel-binding exclude pickers into Phase 2 (group-terms pickers stay with D13). |
| §12 Phase 2 gate | Depends on the Public API isolation suite (built in Public API Phase 1). | State ordering: Phase 2 gate runs at the Public API Phase 1 gate. |
| §8 row "`require_authentication = true`, anonymous" | "identical to today's existing 'no default channel binding' `503`/empty-listing shapes" — `503` and an empty listing are different responses; SPEC-029 §6.2 makes the missing binding a `503`. | Anonymous on a closed channel: `200` with empty items/zero facets for listings, `404` for detail — never `503`. |
| §3.3 / §3.7 | `allOf` absent; canonicalization rule ("id arrays sorted, keys sorted, branches sorted") does not mention nested `allOf`. | Canonicalize recursively; property test "equal hashes for equivalent scopes in different branch order" must include `allOf` branches. |
| §5.1 | `tenantId` missing from input. | Fix. |
| US-B1/US-B2 live count | Needs an admin endpoint SPEC-029 §9.2 does not define. | Shared with SPEC-029 analysis (live-count endpoint). |
| §11 "assert `customer_groups` is not called" | Requires the resolver to receive `customerGroupsService` via DI so a test double can count calls. | State in SPEC-029 `buyerContext.ts` design. |
| §13 Compatibility row | "nothing here exists on `develop` yet" — stale. | Update. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Root: validate inputs with zod in `data/validators.ts` | §4.2 `assortment_scope` jsonb on channel binding | Zod schema = `AssortmentScope` **without** `allOf`, uuid arrays, strict (unknown keys rejected — matches SPEC-029 R5). |
| Root: Boolean parsing helpers | `require_authentication` in query/form | Use `parseBooleanToken` where parsed from strings. |
| `ui` AGENTS: CrudForm, DS tokens, keyboard | US-B2 toggle | Standard `CrudForm` switch field; help text i18n in 5 locales. |
| Root: "code = current behaviour, spec = intended; surface divergence" | `customer_groups` comment "Phase 5 scope" | Divergence surfaced here; fix comment when D13 is implemented. |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Shipping visibility without cart enforcement (Phase 3 excluded) | Today: none — no `cart` module, no storefront write path (verified: no `packages/core/src/modules/cart`, no `cart.lines.*`). Becomes the spec's own Critical R1 the moment any storefront add-to-cart ships. | Release note + roadmap Phase 2 gate: no storefront cart write path may ship before visibility Phase 3. |
| Group scope stub mistaken for working B2B assortment | Merchants read §10a/US-A1 docs and expect group-scoped catalogues; every group is unrestricted. | D13 — implement the column (small, `customer_groups`-owned, already specified), or state "channel-level scope only in this release" in UI help text and release notes. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `allOf` accepted from admin input | An admin-authored `allOf` makes the channel scope non-canonical and bypasses the "single source never carries `allOf`" invariant the hash relies on. | Validator rejects it. |
| Non-canonical `assortmentScopeHash` | Performance-only regression (R9) invisible to semantic tests. | Shared canonical helper + property test. |
| `require_authentication` cached publicly | Anonymous closed-channel response is `public, max-age=60` — correct (no buyer data), but must not be served to an authenticated buyer. | Covered by SPEC-029 cache-isolation suite; add an explicit case for a closed channel. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Missing referenced analysis file | Audit trail gap. | Remove the citation or restore the file. |
| Hand-rolled PBT vs spec's `fast-check` expectation | None functionally. | Reword §3.3 to "seeded property generator in `catalog-visibility/__tests__/testFixtures.ts`". |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

- None specific to Phase 2 beyond the SPEC-029 blockers it rides on (domain status, price kind, portal-token tenant binding).

### Important Gaps (Should Address)

- Phase boundary for the channel-binding exclude pickers (D14).
- Group scope column decision (D13).
- `allOf` in type docs, validator and canonical hash; canonical hash helper in `packages/shared`.
- `503` vs empty-listing wording for closed channels.
- `tenantId` in `resolveAssortmentScope` input.

### Nice-to-Have Gaps

- Fix stale §13 compatibility claim; drop or restore the missing analysis citation; reword PBT harness reference.

---

## Remediation Plan

### Before Implementation (Must Do)

1. Decide D13 and D14; update §12 phase lists accordingly.
2. Add `allOf` handling to §3.3/§3.7 and the canonical-hash requirement's test.
3. Fix §8 closed-channel row (`200` empty / `404` detail, never `503`).

### During Implementation (Add to Spec)

1. Canonical hash helper (`canonicalizeEffectiveScope`, `hashEffectiveScope`) in `packages/shared/src/lib/catalog-visibility/`, exported and listed in `packages/shared/AGENTS.md`.
2. Channel-binding zod validator without `allOf`.
3. Short-circuit test with a counting `customerGroupsService` double.

### Post-Implementation (Follow Up)

1. Phase 3 (cart) before any storefront add-to-cart.
2. Phase 4 (per-customer overrides) after Phase 3, as the spec sequences it.
3. Update spec §13 and `customer-groups-and-b2b-terms.md` to reflect what #6709 actually shipped.

---

## Recommendation

**Ready to implement once the three spec fixes above are applied and D13/D14 are decided** — as part of SPEC-029 Phases 1 and 3, not as a standalone work package.
