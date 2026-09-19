# Plan — Pricing Engine, Phase 1 + Phase 2

Source spec: `.ai/specs/2026-08-21-pricing-engine.md`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add cross-field validation to price validators (maxQuantity≥minQuantity, endsAt>startsAt) | inline | done | 79660556f |
| 1 | 1.2 | Add `catalog.prices.*` i18n keys to all locale files | dispatch:cheap | done | c59dd2cdd |
| 1 | 1.3 | Build shared price-rule scope selector components | inline | done | a663dd0bd |
| 1 | 1.4 | Build the price rules list page (`DataTable`) | inline | done | pending |
| 1 | 1.5 | Build the price rule create page (`CrudForm`) | inline | todo | — |
| 1 | 1.6 | Build the price rule edit page (`CrudForm`, optimistic lock, delete+undo) | inline | todo | — |
| 1 | 1.7 | Integration test: create a customer-group + quantity-tier price via the admin UI | inline | todo | — |
| 2 | 2.1 | Harden `pricingResolvers` registry: `globalThis`-keyed store + `id`/dedupe + stable same-priority order test | inline | todo | — |
| 2 | 2.2 | Additive `PricingContext` fields (`currencyCode`, `customerGroupIds`) + `matchesContext` extension | inline | todo | — |
| 2 | 2.3 | Docs correction: `sales/AGENTS.md` overclaim, spec ACL/updated_at/harness corrections, `UPGRADE_NOTES.md` entry | dispatch:cheap | todo | — |
| 2 | 2.4 | Add `buildPriceRowFilter(ctx)` row-narrowing predicate | inline | todo | — |
| 2 | 2.5 | Soundness test for `buildPriceRowFilter` + full-vs-narrowed `selectBestPrice` equivalence test | inline | todo | — |

## Goal

Implement Phase 1 (catalog admin UI for `CatalogProductPrice` rules) and Phase 2 (resolver-registry hardening: `globalThis` scoping, `currencyCode`/`customerGroupIds`, `buildPriceRowFilter`) of the Pricing Engine spec. Leave the PR as a **draft** at the end (explicit user instruction) even once every Step is `done` and the gate passes — this run does not flip it to ready.

## Scope

- `packages/core/src/modules/catalog/backend/catalog/prices/` — new admin pages (list/create/edit).
- `packages/core/src/modules/catalog/components/prices/` — new shared components (DataTable, scope selectors).
- `packages/core/src/modules/catalog/data/validators.ts` — cross-field refinement on `priceCreateSchema`/`priceUpdateSchema`.
- `packages/core/src/modules/catalog/lib/pricing.ts` — `globalThis` registry, `PricingContext` additive fields, `buildPriceRowFilter`.
- `packages/core/src/modules/catalog/i18n/*.json` — new `catalog.prices.*` namespace.
- `packages/core/src/modules/sales/AGENTS.md`, `.ai/specs/2026-08-21-pricing-engine.md`, `UPGRADE_NOTES.md` — doc corrections.

## Non-goals (explicit, matches user's "phases 1 + 2" scope)

- **Phase 2b** (index-only migration) — spec's own Phasing section states Phase 2's `buildPriceRowFilter` is correct without it, "merely slow," and the two are separable. Deferred to a follow-up; no storefront read path adopts the predicate in this PR so the missing indexes carry no regression risk yet.
- **Phase 3** (new optional `pricing` module) — out of scope per the user's explicit "phases 1 + 2" instruction.
- `offerId`/`userId`/`userGroupId` scope fields ship in Phase 1's UI under a collapsed "Advanced scope" group (the CRUD route/commands already accept them) but are not the focus of Epic 1's user stories — kept minimal, not hidden.
- No `CustomerGroup` entity exists yet (owned by the unimplemented sibling spec `2026-08-14-customer-groups-and-b2b-terms.md`) — `customerGroupId` in the Phase 1 form is a plain UUID field (like `userGroupId` today), not a resolved-name selector. `customerGroupIds` in Phase 2's `PricingContext` is likewise just `string[]` with no entity backing.
- No new production dependency: the spec's Phase 2 soundness test calls for "a property-based test, not a fixture table," citing a harness (`fast-check`) that research confirmed **does not exist in this repo** — that sibling spec (`2026-04-24-agentic-property-based-testing.md`) is itself unimplemented. This run hand-rolls a seeded pseudo-random generation loop in plain Jest instead of pulling in a new devDependency belonging to a different, unimplemented spec.

## Corrections found during research (folded into Step 2.3)

1. Spec's "Cross-cutting rules" claims Phase 1 reuses `catalog.products.manage` — the actual `api/prices/route.ts` write gate is `catalog.pricing.manage` (already declared, already granted to `admin`). Bottom line unchanged (no new ACL surface), mechanism name is wrong.
2. Spec's Phase 1 Step 1 says to "verify `CatalogProductPrice` carries `updated_at`; if missing, add it" — it already exists (`Migration20251030150038.ts`), so this step is a no-op confirmation, not a migration.
3. Spec's Data Model → Row narrowing section states the property-based testing harness "exists" — it does not (see Non-goals above).

## External References

None (`--skill-url` not passed).

## Risks

- `matchesContext`'s cross-field validation is new (currently absent from `priceCreateSchema`/`priceUpdateSchema`); adding it could reject rows that any pre-existing seed/demo data might contain. Mitigated: validation only applies to new create/update calls, never retroactively to existing rows.
- Hand-rolled property test (vs. `fast-check`) is a deliberate scope-minimizing substitution — documented inline in the test file and in the PR body so a reviewer doesn't mistake it for a shortcut.

## Implementation Plan

### Phase 1 — Catalog price-rule admin UI

**1.1 — Add cross-field validation to price validators**
- `data/validators.ts`: add `.superRefine(...)` to `priceCreateSchema` (and ensure `priceUpdateSchema`'s merge preserves it) rejecting `maxQuantity < minQuantity` and `endsAt <= startsAt` with field-level zod issues (`path: ['maxQuantity']` / `path: ['endsAt']`).
- Unit tests covering both rejections and the valid cases (`maxQuantity` omitted = "and above", `endsAt` omitted = no expiry).

**1.2 — i18n keys**
- Add `catalog.prices.*` namespace (list columns, empty state, scope chip labels, form field labels/placeholders, error messages, "Expired" badge) to `en.json` first, then de/es/ko/pl.
- Run `yarn i18n:check-hardcoded` scoped to the new files.

**1.3 — Shared scope selector components**
- `components/prices/PriceProductVariantSelect.tsx` (product/variant combobox, reusing the existing product search API).
- `components/prices/PriceCustomerSelect.tsx` (ComboboxInput against `/api/customers/people`).
- Reuse the `ChannelSelectInput` pattern from `sales/components/channels/ChannelOfferForm.tsx` for `channelId` (adapted into `components/prices/PriceChannelSelect.tsx`, hitting `/api/sales/channels`).
- `components/prices/PricePriceKindSelect.tsx` (against `/api/catalog/price-kinds`).
- `components/prices/PriceCurrencySelect.tsx` (against `/api/currencies/currencies/options`).
- `customerGroupId`, `userId`, `userGroupId` stay plain UUID text inputs (no backing entity/list API yet).

**1.4 — List page**
- `backend/catalog/catalog/prices/page.tsx` + `page.meta.ts` (`requireFeatures: ['catalog.pricing.manage']`, `pageGroup: 'Catalog'`).
- `components/prices/PricesDataTable.tsx`: columns for product/variant, kind (StatusBadge), amount+currency, scope chips (customer/customer-group/channel), quantity range, validity window with an "Expired" chip when `endsAt < now`, row actions (edit/delete with confirm). Empty state per spec's Epic 1.

**1.5 — Create page**
- `backend/catalog/catalog/prices/create/page.tsx`, `CrudForm` with all fields from 1.3 plus `minQuantity`/`maxQuantity`/`unitPriceNet`/`unitPriceGross`/`taxRate`/`startsAt`/`endsAt`; `kind`/`priceKindId` defaults; currency pre-fill left to the operator (spec: "no silent fallback to the store's default currency").
- Duplicate-scope 500 from the command surfaces via `createCrudFormError`.

**1.6 — Edit page**
- `backend/catalog/catalog/prices/[id]/edit/page.tsx` mirroring `categories/[id]/edit/page.tsx`: `optimisticLockUpdatedAt` from `initialValues.updatedAt`, delete with confirm + existing undo/redo command support, `RecordNotFoundState` for a missing id.

**1.7 — Integration test**
- Playwright: create a customer-group-scoped, quantity-tiered price row through the new UI, then assert (via a resolution check — API or a seeded scenario) that it outranks a plain regular price for a matching context, proving the UI reaches the dimensions the API already supported.

### Phase 2 — Catalog resolver contract hardening

**2.1 — Registry hardening**
- Migrate `pricingResolvers` in `lib/pricing.ts` to a `globalThis`-keyed singleton (mirroring the existing ORM-registry/event-bus `globalThis` pattern in this codebase).
- Add optional `id` to `registerCatalogPricingResolver(resolver, { priority?, id? })`; skip re-registration when the same `id` is already present.
- Regression test: register a resolver "from a second module instance" (simulated per the existing ORM-registry fix's own test pattern) and confirm `resolveCatalogPrice()` running "in the first instance" sees it.
- Document + test the same-priority resolver tie-break (stable insertion/registration order) in `catalog/AGENTS.md` and `lib/__tests__/pricing.test.ts`.

**2.2 — `PricingContext` additive fields**
- Add `customerGroupIds?: string[]` and `currencyCode?: string | null` to `PricingContext`; keep `customerGroupId` with a `@deprecated` note, read as a one-element set when `customerGroupIds` is absent.
- Extend `matchesContext()`: currency filter only applies when `ctx.currencyCode` is present (no behavior change for callers that omit it); `customerGroupIds` set-membership match, falling back to legacy `customerGroupId` equality.
- Unit tests: currency match/no-match, `customerGroupIds` set membership, legacy `customerGroupId` still works unchanged.

**2.3 — Docs correction**
- `sales/AGENTS.md`: correct "MUST use `selectBestPrice`" to state actual current state (not wired yet).
- `.ai/specs/2026-08-21-pricing-engine.md`: fix the `catalog.products.manage` → `catalog.pricing.manage` claim, the `updated_at` migration claim, and the property-based-harness claim (add a changelog entry).
- `UPGRADE_NOTES.md`: entry for the currency behavior change (opt-in, strictly safer — callers that start passing `currencyCode` may see rows they previously silently cross-currency-matched now resolve to "no price found").

**2.4 — `buildPriceRowFilter`**
- New export in `lib/pricing.ts`: `buildPriceRowFilter(ctx: PricingContext): FilterQuery<CatalogProductPrice>` emitting the narrowing half of `matchesContext` (customer/customer-group/user/user-group/channel/currency — all `IS NULL OR =`/`IN`). No existing caller changed.

**2.5 — Soundness test**
- Hand-rolled seeded pseudo-random generation loop (plain Jest, fixed seed for reproducibility) asserting `matchesContext(row, ctx) ⇒ buildPriceRowFilter(ctx)` admits the row, over many generated `(row, ctx)` pairs.
- One end-to-end assertion: `selectBestPrice` returns the same row whether given the full row set or the `buildPriceRowFilter`-narrowed set, for a buyer with a contract row and one without.

## Integration Test Coverage

- API: price validator cross-field rejections (1.1).
- Resolver: currency filtering, `customerGroupIds` membership, same-priority resolver order, registry visibility across simulated module instances (2.1, 2.2).
- Row narrowing: property-based soundness + full-vs-narrowed equivalence (2.5).
- UI: create a tiered/customer-group price row via the new admin page, confirm resolution (1.7).

## Final Compliance Report (filled at completion)

Pending — completed at final gate (step 9 of the loop skill).
