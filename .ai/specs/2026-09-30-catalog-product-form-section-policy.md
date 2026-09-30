# Catalog product edit — externally configurable section policy

## 📝 TLDR

A standalone app can already hide a `CrudForm` card by id — `hiddenGroupIds` shipped with [`2026-09-04-crudform-group-visibility.md`](2026-09-04-crudform-group-visibility.md) — but only the **host** can pass that prop, and hiding is **presentation-only**. On `/backend/catalog/products/[id]` neither half works for an app module: the catalog page passes no external policy, and even if it did, `handleSubmit` would still validate, re-serialize and re-write every hidden section's data. This spec adds one reserved-domain override key, `overrides.forms.sections`, keyed by the declared `crud-form:catalog.product` host, and reshapes the catalog edit form around ten **section descriptors** so that hiding a section removes its card, its client validation, its slice of the update payload and its secondary writes together — leaving the stored values untouched. With no override configured the page renders and submits byte-for-byte as it does today.

Resolves FR [#6686](https://github.com/open-mercato/open-mercato/issues/6686).

## 📝 Overview

Two layers, deliberately separated:

- **Transport (generic, `@open-mercato/shared`).** A new wired override domain, `forms.sections`, carrying a data-only policy per CrudForm host id. It follows the `nav` domain (spec [`2026-07-30-nav-group-order-override-domain.md`](2026-07-30-nav-group-order-override-domain.md)) exactly: typed sub-shape, composer, `globalThis`-backed state, programmatic tier, dispatcher applier, and a "later module wins" warning. `BACKWARD_COMPATIBILITY.md` § 3 already reserves unused `ModuleOverrides` domain keys for exactly this ("other domain keys are reserved by the unified override contract and may be wired additively"), so no new contract category is invented.
- **Semantics (catalog-owned, `@open-mercato/core`).** A `CatalogProductFormSection` descriptor table that names, for each of the ten shipped group ids, the form fields it owns, the client validation it owns, the update-payload slice it owns, and the secondary writes it owns. The page derives `hiddenGroupIds`, the pre-validation sanitisation, the payload and the post-save writes from that one table.

Out of the box nothing changes. `getFormSectionPolicy('crud-form:catalog.product')` returns `null`, every section is visible, and the existing code paths run unmodified.

> **Anchor convention.** Line numbers are hints recorded against `develop` at `521e99611` (2026-09-30) and drift. The **symbol name** is the durable anchor; read every `(~NNNN)` as "look near here".

## 📝 Problem Statement

`packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` declares ten groups in one `React.useMemo` (`~889`):

`details`, `dimensions`, `metadata`, `options`, `product-uom`, `compliance`, `variants`, `meta`, `categorize`, `custom-fields`.

An app that ships a narrower product form — a services catalogue with no physical dimensions, a market with no PL/EU compliance codes, a single-unit catalogue with no UoM card — has no supported way to drop one. Three paths exist today and all three fail:

1. **`hiddenGroupIds`** — the prop exists on `CrudForm` but only the host passes it (`~1562`). The catalog page passes no external policy.
2. **A `widgets/components.ts` `propsTransform`** — `CrudForm` computes `resolvedReplacementHandle` (`~918`) and emits it as a `data-component-handle` attribute (`~3862`, `~3945`) but, unlike `DataTable` (`DataTable.tsx:4016`, which resolves itself through `useRegisteredComponent`), never resolves itself through the component registry. A registered `propsTransform` for `crud-form:catalog.product` therefore never runs, so it cannot inject `hiddenGroupIds`.
3. **Replacing the page** through the `page:` handle — technically available, and exactly the coupling the FR exists to remove: the app inherits every future change to a 3 443-line file.

And even if (1) or (2) worked, visual hiding alone is **unsafe here**, because `handleSubmit` (`~1039`) is monolithic:

- `productFormSchema.safeParse(withCanonicalUomFields(formValues, locale))` (`~1055`) validates *every* field regardless of what rendered.
- Imperative gates throw `createCrudFormError` for sections the user cannot see — the title guard (`~1157`), the UoM base-unit / duplicate-conversion / default-sales-conversion gates (`~1222`–`~1265`) and the unit-price gates (`~1266`–`~1290`).
- `buildComplianceProductPayload(values)` (`productForm.ts:500`) **always emits all 23 compliance/SEO keys, nulling the empty ones**. Hiding the compliance card and saving any other field would therefore wipe `pkwiuCode`, `cnCode`, `gtuCodes`, `seoTitle` and the rest of the stored record — the single worst failure this spec must prevent.
- The unit-conversion synchronisation after `updateCrud` (`~1419`–`~1501`) deletes, updates and creates `catalog/product-unit-conversions` rows from the form's `unitConversions` array. A hidden, never-populated UoM card would delete every stored conversion.
- Offer removal for de-selected channels (`~1357`–`~1387`) and `payload.offers` (`~1356`) are driven by `categorize`'s `channelIds`.

So "hide a card" and "do not corrupt the record" are, on this page, the same feature.

**Why omission is safe.** `productUpdateSchema` is `z.object({id}).merge(productBaseSchema.partial())` (`data/validators.ts:~326`), and `catalog.product.update` applies every scalar behind an `if (parsed.X !== undefined)` guard (`commands/products.ts:~1796` onward). Relations follow the same rule: `syncOffers` returns early on `!inputs` (`~767`), the category and tag syncs return early on `=== undefined` (`~841`, `~901`), `metadata` is gated on `hasOwnProperty(rawInput, 'metadata')` (`~1876`) and `setCustomFieldsIfAny` returns early on an empty map (`shared/lib/commands/helpers.ts:36`). **Omitting a key from the payload is a preserve, not a clear** — verified against the command, not assumed.

## 📝 Proposed Solution

### 1. `overrides.forms.sections` — the transport

```ts
// packages/shared/src/modules/overrides.ts

/**
 * Presentation + behaviour policy for a CrudForm host, keyed by the host's
 * spot id (e.g. `'crud-form:catalog.product'`).
 *
 * Data only — no functions, no components — so it is serialisable, safe to
 * evaluate in the browser, and cheap to reason about. What a host DOES with
 * the policy is the host's contract, documented per host; this domain only
 * transports it.
 */
export interface FormSectionPolicy {
  /**
   * Built-in section ids to hide, from the set the host documents as stable.
   * Ids the host does not declare are ignored with a dev-only warning.
   *
   * An injection-widget card (`widget:<widgetId>`) is NOT addressable here:
   * hiding it would leave its `onBeforeSave` / `transformFormData` handlers
   * running. Disable the widget with
   * `overrides.widgets.injection['<widgetId>'] = null` instead.
   */
  hidden?: readonly string[]
}

export type FormSectionPolicyOverride = FormSectionPolicy | null
export type FormSectionPolicyOverridesMap = Record<string, FormSectionPolicyOverride>

export interface FormsOverridesShape {
  sections?: FormSectionPolicyOverridesMap | LooseOverrideMap
}
```

`ModuleOverrides` gains `forms?: FormsOverridesShape`; `ModuleOverrideDomain` and `DOMAIN_KEYS` gain `'forms'`. Runtime surface, mirroring `nav`:

| Export | Purpose |
|---|---|
| `applyFormSectionPolicyOverrides(map \| null)` | Programmatic tier (env-driven boot decisions, tests). Takes precedence over `modules.ts`. |
| `getFormSectionPolicy(hostId)` | `FormSectionPolicy \| null`. `null` means "shipped behaviour, unchanged". |
| `subscribeToFormSectionPolicies(listener)` | Returns an unsubscribe. Fires when the applier or the programmatic setter changes state. |

Usage in an app:

```ts
// apps/<app>/src/modules.ts
export const enabledModules = [
  {
    id: 'catalog',
    overrides: {
      forms: {
        sections: {
          'crud-form:catalog.product': { hidden: ['compliance', 'product-uom', 'dimensions'] },
        },
      },
    },
  },
]
```

### 2. `CatalogProductFormSection` — the semantics

A new catalog-owned module, `packages/core/src/modules/catalog/components/products/formSections.ts`:

```ts
export const CATALOG_PRODUCT_FORM_SECTION_IDS = [
  'details', 'dimensions', 'metadata', 'options', 'product-uom',
  'compliance', 'variants', 'meta', 'categorize', 'custom-fields',
] as const
export type CatalogProductFormSectionId = (typeof CATALOG_PRODUCT_FORM_SECTION_IDS)[number]

export type CatalogProductSectionContext = {
  productId: string
  values: ProductFormValues          // post-parse, post-sanitisation
  initialValues: ProductFormValues   // as loaded from the server
  taxRates: TaxRateOption[]
  variants: VariantSummary[]
  t: Translator
}

export type CatalogProductFormSection = {
  id: CatalogProductFormSectionId
  /** Form value keys this section owns. Drives sanitisation and the guard test. */
  ownedFields: readonly (keyof ProductFormValues)[]
  /** Client validation owned by this section. Throws `createCrudFormError`. */
  validate?: (ctx: CatalogProductSectionContext) => void
  /** This section's slice of the `catalog/products` update payload. */
  buildPayload?: (ctx: CatalogProductSectionContext) => Record<string, unknown>
  /** Secondary writes owned by this section, before the product update. */
  writeBefore?: (ctx: CatalogProductSectionContext) => Promise<void>
  /** Secondary writes owned by this section, after the product update. */
  writeAfter?: (ctx: CatalogProductSectionContext) => Promise<void>
}
```

The ownership partition, derived from what each section component actually renders and writes (`setValue` call sites in `page.tsx` and in `ProductUomSection` / `ProductComplianceSection` / `ProductCategorizeSection`):

| Section | `ownedFields` | `validate` | `buildPayload` keys | Secondary writes |
|---|---|---|---|---|
| `details` | `title`, `description`, `useMarkdown`, `mediaItems`, `defaultMediaId`, `defaultMediaUrl` | title required (`~1157`) | `title`, `description`, `defaultMediaId`, `defaultMediaUrl` | — (owns the variant-media fallback, `~1184`) |
| `dimensions` | `dimensions`, `weight` | — | `dimensions`, `weightValue`, `weightUnit` | — |
| `metadata` | `metadata` | — | `metadata` | — |
| `options` | `options` | — | `optionSchema`, or `optionSchemaId: null` when cleared | — |
| `product-uom` | `defaultUnit`, `defaultSalesUnit`, `defaultSalesUnitQuantity`, `uomRoundingScale`, `uomRoundingMode`, `unitPriceEnabled`, `unitPriceReferenceUnit`, `unitPriceBaseQuantity`, `unitConversions` | base-unit-required, duplicate conversion, default-sales conversion, unit-price reference/base (`~1222`–`~1290`) | the nine UoM/unit-price keys | **`writeAfter`**: `catalog/product-unit-conversions` delete / update / create sync (`~1419`–`~1501`) |
| `compliance` | the 23 keys of `ComplianceFormValues` | none imperative — the three date/qty `.refine`s it owns live on the shared `productFormSchema` (`productForm.ts:~330–349`) and pass on restored values | `buildComplianceProductPayload(values)` | — |
| `variants` | — (read-only view; variant CRUD is its own API surface) | — | — | — |
| `meta` | `subtitle`, `handle`, `sku`, `productType`, `hasVariants`, `taxRateId` | — | `subtitle`, `handle`, `sku`, `productType`, `isConfigurable`, `taxRateId`, `taxRate` | — |
| `categorize` | `categoryIds`, `channelIds`, `tags` | — | `categoryIds`, `tags`, `offers` | **`writeBefore`**: delete offers for de-selected channels (`~1357`); owns `offerSnapshotsRef` merge |
| `custom-fields` | `customFieldsetCode`, every `cf_*` key | — | `customFieldsetCode`, `customFields` | — |

### 3. The submit contract

`handleSubmit` becomes a four-step loop over the **visible** sections:

```
visible = SECTIONS.filter(s => !hiddenIds.has(s.id))

1. sanitise  values = restoreHiddenSectionFields(formValues, hidden, initialValues)
2. parse     productFormSchema.safeParse(withCanonicalUomFields(values, locale))   // unchanged
3. validate  for (s of visible) s.validate?.(ctx)
4. write     for (s of visible) await s.writeBefore?.(ctx)
             payload = { id, ...merge(visible.map(s => s.buildPayload?.(ctx))) }
             await updateCrud('catalog/products', payload)
             refresh updatedAt + merge values into initialValues              // unchanged (#5985, #6170)
             for (s of visible) await s.writeAfter?.(ctx)
```

**Step 1 is the load-bearing rule, and it is one sentence: every field owned by a hidden section is reset to its loaded value before validation, and omitted from the payload afterwards.** Two properties fall out of it rather than needing separate mechanisms:

- *No unreachable validation error.* The stored record is by construction a value the server accepted, so a hidden section's restored fields cannot fail the shared `productFormSchema`. The imperative gates are skipped outright because their section is not in `visible`.
- *Cross-section reads stay correct.* `options.buildPayload` calls `buildOptionSchemaDefinition(values.options, title)` and `categorize`'s offer fallback reads `title` / `description` / `defaultMediaId`, all owned by `details`. Restoring to the **loaded** values (rather than to `BASE_INITIAL_VALUES`) means a visible section reading a hidden section's field sees the real stored value, not an empty string. Restoring to the blank baseline would make a hidden `details` produce an empty option-schema title and trip the page's own title guard.

`ownedFields` is the single source for step 1 and for `hiddenGroupIds`, so the two can never disagree.

### Alternatives considered

| Alternative | Why it lost |
|---|---|
| Make `CrudForm` self-resolve its handle (parity with `DataTable:4016`) so a `widgets.components` `propsTransform` can inject `hiddenGroupIds` | Delivers presentation only. The submit logic lives in the page, not in `CrudForm`, so a props transform cannot make hiding coherent — it would ship exactly the data-loss hazard this FR is about. Worth doing on its own merits for [#6043](https://github.com/open-mercato/open-mercato/issues/6043); explicitly **not** this feature's mechanism. |
| A catalog-local `registerCatalogProductSectionPolicy(...)`, mirroring `registerCatalogPricingResolver` | A parallel substitute for `entry.overrides`, which the unified spec calls "the ONE canonical override surface per app". It would also need its own boot hook for an app module to call it. |
| Tenant-scoped `ModuleConfigService` rows | Wrong layer: the FR asks for a **build-time app-module** decision, not a per-tenant runtime setting. `useUnitPriceDisplayEnabled` is the existing tenant-setting precedent and it deliberately governs unit-price *presentation* only. |
| A `hidden` flag on each `CrudFormGroup`, or per-section props | Requires the app to own the group array — the coupling being removed. |
| Keying policy on translated card titles or CSS selectors | Locale-dependent and explicitly rejected by the FR. |
| Filtering the payload generically inside `CrudForm` | `CrudForm` does not build this payload; the page does, from derived values (`buildComplianceProductPayload`, `buildOfferPayloads`, `buildOptionSchemaDefinition`). A generic filter cannot know that `compliance` owns `seoTitle`. |

### Prior art

Shopware's `Administration` hides detail-page cards through module-level view overrides and keeps the omitted fields out of the change-set rather than sending nulls; Magento's `ui_component` XML sets `visible: false` on a fieldset and the data provider stops contributing it. Both converge on the same rule this spec adopts — **hidden means "not submitted", never "submitted empty"**. What they carry and this spec skips: a general visibility-expression layer (per-record/per-role rules), explicitly out of scope in the FR.

## 📝 Architecture

### Component map

| File | Change |
|---|---|
| `packages/shared/src/modules/overrides.ts` | New `FormsOverridesShape` + `'forms'` domain, state on `globalThis`, applier, `getFormSectionPolicy`, `subscribeToFormSectionPolicies` |
| `packages/ui/src/backend/injection/useFormSectionPolicy.ts` (new) | `useSyncExternalStore` hook over the two exports above |
| `apps/mercato/src/components/ClientBootstrap.tsx` + `packages/create-app/template/src/components/ClientBootstrap.tsx` | `CLIENT_OVERRIDE_DOMAINS` gains `'forms'` |
| `packages/core/src/modules/catalog/components/products/formSections.ts` (new) | Section ids, types, descriptor table, `restoreHiddenSectionFields`, `resolveHiddenCatalogProductSections` |
| `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` | `groups` and `handleSubmit` rebuilt over the descriptor table; extract the six inline section components into `components/products/sections/` |
| `apps/docs/docs/framework/modules/overrides.mdx`, `.../admin-ui/crud-form.mdx` | Document the domain and the catalog recipe |
| `BACKWARD_COMPATIBILITY.md` | Record `overrides.forms.sections` as STABLE under the reserved-domain clause |

### Why the reader is a subscription, not a plain getter

`nav` reads its override with a plain `getNavGroupOrderOverride()` because the sidebar renders after bootstrap has already dispatched. The catalog page cannot assume that: on the client the dispatcher runs inside `ensureModuleOverridesApplied()` (`ClientBootstrap.tsx:60`), which is an awaited dynamic import resolving **after** first paint. A plain getter would render the full form, then drop the hidden cards a tick later — a visible layout jump, and a window in which a fast submit would run the wrong section set.

`useFormSectionPolicy(hostId)` therefore subscribes. `getFormSectionPolicy` is still exported for non-React readers and tests.

### Where the policy is consumed, and where it deliberately is not

| Consumer | Effect |
|---|---|
| `CrudForm hiddenGroupIds` | The card, its header, its sortable entry, its column space and its validation focus target disappear — all of it inherited from the generic mechanism, nothing re-implemented |
| `restoreHiddenSectionFields` (pre-parse) | Hidden sections' fields revert to loaded values |
| `visible.map(s => s.validate)` | Hidden sections' imperative gates never run |
| `visible.map(s => s.buildPayload)` | Hidden sections contribute no payload key, so the command preserves |
| `visible.map(s => s.writeBefore / writeAfter)` | Hidden sections' secondary writes never fire |
| **Server validators and domain invariants** | **Untouched.** The policy is a client-side form contract. `productUpdateSchema`, the mutation guards, ACL, optimistic locking and the command's own invariants remain authoritative for everything actually mutated. |
| **Injection widget handlers** | **Untouched**, and unreachable from this policy by design — see the widget rule below. |
| **The create wizard** (`products/create/page.tsx`) | Untouched. Out of scope per the FR; the descriptor table is written so a later phase can adopt it. |

### The injected-widget rule

Built-in section suppression and injection-widget disabling are different operations and this spec keeps them visibly different:

- `overrides.forms.sections['crud-form:catalog.product'].hidden` accepts **built-in ids only**. A `widget:` id is rejected with a dev-only error naming the correct mechanism, and is **not** forwarded to `hiddenGroupIds`.
- The correct mechanism is `overrides.widgets.injection['<widgetId>'] = null`, which removes the widget from the registry — card *and* `onBeforeSave` / `transformFormData` / `onFieldChange` handlers, per `useInjectionSpotEvents` building its handler set from the loaded widget definitions.

Rejecting rather than silently forwarding is the point: forwarding would hand an app the exact "invisible handler still blocks save" trap that the generic spec documents as its one sharp edge.

## 📝 Data Models

No entity, column, migration, index or persisted-schema change. The only new state is process-local: the `forms.sections` policy map on `globalThis` (same rationale as `nav` — the writer is app bootstrap, the reader is `@open-mercato/core`, and a module-local variable is invisible across the duplicated module instances a standalone build produces).

## 📝 API Contracts

No HTTP endpoint, command, event, ACL feature or DI key changes. Three contract additions, all additive:

1. **`ModuleOverrides.forms`** — new domain under the `BACKWARD_COMPATIBILITY.md` § 3 reserved-key clause, wired with its own applier before being documented, exactly as the umbrella spec requires. Absent the key, dispatch is byte-identical.
2. **`CATALOG_PRODUCT_FORM_SECTION_IDS`** — the ten ids become an exported, documented, contract-pinned constant. They are already protected by the *"Built-in `CrudFormGroup.id` values"* row of `BACKWARD_COMPATIBILITY.md` § 3; this promotes them from "declared inline" to "declared once and tested".
3. **`useFormSectionPolicy` / `getFormSectionPolicy` / `subscribeToFormSectionPolicies`** — new exports; nothing renamed or removed.

Nothing is deprecated, so the deprecation protocol does not apply. The update payload shape is unchanged — the policy only decides which of its existing optional keys are present.

## 📝 UI/UX

Nothing new is drawn. A hidden section renders no card, no header, no chevron, no drag handle and reserves no column space; column balance and autofocus follow the generic `hiddenGroupIds` behaviour unchanged. The page keeps its current DS surface, so no new tokens, primitives or i18n keys are introduced beyond the dev-diagnostic strings below.

Two user-visible strings are added, both **development-only** `logger` output and therefore `[internal]`-prefixed rather than translated:

- unknown built-in section id named in a policy;
- a `widget:` id named in a policy, with the `overrides.widgets.injection` pointer.

Per the Boy Scout rule, any line touched while extracting the six inline section components migrates to semantic tokens and the DS text scale.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| No override configured (the default) | `getFormSectionPolicy` returns `null`; rendering and the submitted payload are byte-for-byte today's. Pinned by a baseline test. |
| Unknown / misspelled built-in id | Ignored, dev-only warning naming the id and listing the valid ids. Never throws — a stale id after a rename must not white-screen a product page. |
| `widget:<id>` named in `hidden` | Rejected with a dev-only error pointing at `overrides.widgets.injection['<id>'] = null`. Not forwarded to `hiddenGroupIds`, so the widget keeps both its card and its handlers rather than losing one and keeping the other. |
| Every built-in section hidden | The generic all-hidden guard applies: the grouped layout is kept and renders zero built-in cards, never falling back to the flat field list. Injected widget cards still render. The payload is `{ id }` alone — an accepted no-op update that still bumps `updatedAt`. |
| Hidden `compliance`, user edits `title` and saves | The 23 compliance/SEO keys are absent from the payload; `catalog.product.update` leaves each stored value untouched. **This is the regression the whole spec exists to prevent** and gets both a unit and an integration assertion. |
| Hidden `product-uom`, user saves | No `defaultUnit` / `unitPrice*` keys, and `writeAfter` never runs — so no `catalog/product-unit-conversions` row is deleted, updated or created. Stored conversions survive verbatim. |
| Hidden `categorize`, user saves | No `categoryIds` / `tags` / `offers` keys and no offer deletes. Stored categories, tags and channel offers survive. **Documented consequence:** an offer's denormalised title/description no longer follows a `details` edit while `categorize` is hidden, because offer synchronisation is owned by `categorize`. Re-showing the section and saving re-synchronises. |
| Hidden `details`, `options` visible | `options.buildPayload` reads the **restored** `title`, so the generated option-schema title is the stored product title, not `''`. The title guard lives in `details.validate` and therefore does not run. |
| Hidden section holds a value the user changed before it was hidden | Impossible in one session (the policy is static per build), but the sanitiser makes it safe regardless: the field reverts to its loaded value before validation and is not submitted. |
| Hidden `custom-fields` | No `customFields` / `customFieldsetCode` keys. `setCustomFieldsIfAny` returns early on an empty map, so stored custom values are preserved. The custom-field fetch still runs and the autofocus effect still waits on `isLoadingCustomFields` — a small, harmless delay inherited from the generic mechanism. |
| Two modules declare a policy for the same host | Later module-load order wins (the umbrella's uniform replace semantic), **with a `logger.warn` naming both module ids** so the collision is visible instead of silent. Union semantics were rejected as a special case no reader would predict from the other domains. |
| Policy declared on a module entry gated by a **server-only** env var | The browser re-evaluates `modules.ts` with that read `undefined`, so the entry is absent client-side and the policy never applies there. Same trap as `widgets`/`notifications` (#5152); documented in the same place, with the same remedy — declare it on an ungated entry or gate on `NEXT_PUBLIC_*`. |
| Client dispatch fails (chunk-load error) | `ensureModuleOverridesApplied` already logs and leaves registries unfiltered; the policy stays `null`, so the page renders the **full, fully-functional** form. Failure mode is "no customisation", never "half-applied customisation". |
| A hidden section's stored value is invalid for the current schema (e.g. a constraint tightened after the row was written) | The restored value still reaches `safeParse`, so the parse can fail on a field the user cannot see — the one case the sanitiser does not make safe. The dev warning names the section, and the documented remedy is a data migration. Accepted: silently dropping hidden sections from the parse would also drop the cross-section reads that depend on them. |

## 📝 Risks & Impact Review

| # | Risk | Severity | Mitigation | Residual |
|---|---|---|---|---|
| R1 | The `handleSubmit` restructure regresses the **default** (no-override) path, which every product edit in every deployment uses. | **High** — blast radius is all product editing. | The submit path is refactored before any policy is consulted, under a payload-equality test that snapshots today's `updateCrud` argument for a fully-populated form and asserts byte-equality after the refactor; the section loop then runs with an empty hidden set. Phase 2 lands with that test green before Phase 3 introduces a hidden id. | A behaviour the snapshot does not cover. Bounded by the integration test editing a real product end to end. |
| R2 | The `ownedFields` partition is wrong — a field is attributed to the wrong section, or to none. | Medium | A guard test asserts the union of `ownedFields` equals the editable key set of `ProductFormValues` minus an explicit, commented exclusion list, so a **new** form field fails the build until it is attributed. Per-section payload tests assert each slice's exact key set. | A field attributed to the wrong (but real) section. Caught by the per-section payload key assertions. |
| R3 | An app hides a section and silently loses data anyway, through a write path this spec did not enumerate. | Medium | The three secondary-write paths (conversions, offer deletes, offer payload) are enumerated from the code and each is attached to an owning section; the integration test asserts stored conversions and compliance values are unchanged after a save with those sections hidden. | A future PR adding a fourth write path outside a descriptor. Mitigated by locating writes in the descriptor table rather than in `handleSubmit`. |
| R4 | Adding `'forms'` to `CLIENT_OVERRIDE_DOMAINS` in only one of the two mirrored `ClientBootstrap.tsx` copies. | Low | Both copies change in the same step, both mirrored tests are updated, and `yarn template:sync:fix` runs; the template-drift gate then fails on any remaining divergence. | None material. |
| R5 | Extracting six inline section components from a 3 443-line file changes rendering by accident. | Low | Pure move — the extraction step changes no JSX and no props, and is verified by the page's existing tests plus the Phase 3 integration run before any behavioural step builds on it. | None material. |
| R6 | A new override domain widens the app-facing contract surface. | Low | The key is data-only (no functions/components), sits in a slot `BACKWARD_COMPATIBILITY.md` already reserves, and is inert when absent. Rollback is deleting the domain and the catalog consumer; nothing is persisted or migrated. | None material. |

**Blast radius.** Default path: the catalog product edit page only. With an override: that page for that app. Nothing server-side changes, so no deployment carries risk until an app opts in.

**Rollback.** Remove the descriptor consumption from `handleSubmit` and the `forms` domain. There is no migration, no persisted artifact and no serialized state to unwind; an app that had declared the override simply gets the full form back.

## 📋 Phasing

Three phases. Each leaves the application working and is independently reviewable; the **capability** is only complete at Phase 3, which is why this is one spec rather than three (the transport alone transports nothing, and the refactor alone hides nothing).

- **Phase 1 — transport.** The `forms.sections` domain end to end, with no consumer. Inert by construction.
- **Phase 2 — catalog section model.** Extract the inline sections, introduce the descriptor table, rebuild `handleSubmit` over it with an empty hidden set. **No behaviour change**, guarded by the payload-equality test.
- **Phase 3 — wire the policy, cover it, document it.** Consume the policy, add the diagnostics, ship unit + integration coverage, docs, and the standalone-harness refresh.

## 📋 Implementation Plan

### Phase 1 — `overrides.forms.sections`

1. **Declare the shape.** Add `FormSectionPolicy`, `FormSectionPolicyOverride(sMap)`, `FormsOverridesShape` to `packages/shared/src/modules/overrides.ts` with the JSDoc from Proposed Solution; add `forms?` to `ModuleOverrides`, `'forms'` to `ModuleOverrideDomain` and to `DOMAIN_KEYS`. *Testable:* `yarn workspace @open-mercato/shared typecheck`; an app may declare the key.

2. **State, composer and applier.** Add `globalThis`-backed state with `modules` / `programmatic` tiers (copy the `getNavOverrideState` shape), a normaliser that drops blank and duplicate ids, `formsOverridesApplier` registered via `registerModuleOverrideApplier('forms', …)` in `registerBuiltInModuleOverrideAppliers`, and the "declared by more than one module — the later one wins" `logger.warn`. *Testable:* disable + replace + precedence + multi-module-warning unit tests, mirroring `nav`'s.

3. **Readers.** Export `applyFormSectionPolicyOverrides`, `getFormSectionPolicy(hostId)` and `subscribeToFormSectionPolicies(listener)`; clear the new state in `resetModuleOverrideAppliersForTests`. *Testable:* a subscriber fires exactly once per applied change and not on a no-op re-apply.

4. **Client dispatch.** Add `'forms'` to `CLIENT_OVERRIDE_DOMAINS` in **both** `apps/mercato/src/components/ClientBootstrap.tsx` and `packages/create-app/template/src/components/ClientBootstrap.tsx`, update both `ClientBootstrap.moduleOverrides.test.ts` expectations, and run `yarn template:sync:fix`. *Testable:* both mirrored tests; the template-drift gate.

5. **React reader.** Add `packages/ui/src/backend/injection/useFormSectionPolicy.ts` — `useSyncExternalStore(subscribeToFormSectionPolicies, () => getFormSectionPolicy(hostId), () => null)`, with the SSR snapshot returning `null` so server and first client render agree. *Testable:* a hook test asserting a policy applied after mount re-renders the consumer, and that the server snapshot is `null`.

6. **Document the domain.** `apps/docs/docs/framework/modules/overrides.mdx` gains a `forms.sections` section (key format, replace semantics, the built-in-ids-only rule with the `widgets.injection` pointer, and the server-only-env-gating trap); `packages/shared/AGENTS.md` gains its helper row; the umbrella spec's status table gains a "20 | Form section policies | `forms.sections` | CrudForm host spot id | **YES**" row; `BACKWARD_COMPATIBILITY.md` § 3 records the key as STABLE under the reserved-domain clause. *Testable:* docs build; `yarn agents:check-budget`.

### Phase 2 — catalog section model (no behaviour change)

7. ~~**Extract the inline sections.**~~ **Descoped during implementation.** The six components reference nine page-local symbols — `OptionSchemaDialog`, `SaveSchemaDialog`, `buildSchemaFromOptions`, `extractOptionsFromTemplate`, `OptionSchemaTemplateListResponse`, `VariantSummary`, `VariantPriceSummary`, `normalizeMetadata`, `logger` — so the move drags both option-schema dialogs with it, ~1400 lines in total, for an organizational benefit the FR does not ask for: its step 2 asks to centralize *visibility, validation, payload mapping and side effects*, which step 8's `formSections.ts` does in full. Left as an optional follow-up rather than risking a large mechanical move inside the same change as the behavioural one.

8. **Introduce the descriptor table.** Add `formSections.ts` with `CATALOG_PRODUCT_FORM_SECTION_IDS`, the types, and the ten descriptors populated from the ownership table — each `validate` / `buildPayload` / `writeBefore` / `writeAfter` body **moved verbatim** out of `handleSubmit`. *Testable:* a guard test pinning the ten ids in order, and asserting the `ownedFields` union covers `ProductFormValues`' editable keys minus the commented exclusions.

9. **Rebuild `handleSubmit` over the table**, with the hidden set hard-coded empty. Keep the `updatedAt` refresh (#5985) and the `initialValues` merge (#6170) exactly as they are. *Testable:* the **payload-equality** test — a fully-populated form produces an `updateCrud` argument byte-identical to the pre-refactor snapshot, and the conversion/offer calls fire in the same order with the same arguments.

10. **Build `groups` from the table** so the rendered group array and the descriptor ids cannot drift. *Testable:* a test asserting the rendered card ids equal `CATALOG_PRODUCT_FORM_SECTION_IDS`.

### Phase 3 — wire the policy, cover it, document it

11. **Resolve and apply the policy.** `resolveHiddenCatalogProductSections(policy)` filters to known built-in ids, rejecting `widget:` ids with the dev-only error and unknown ids with the dev-only warning; the page calls `useFormSectionPolicy('crud-form:catalog.product')`, passes the result to `CrudForm hiddenGroupIds`, and derives `visible` and `restoreHiddenSectionFields` from the same set. *Testable:* a hidden id produces no card, no payload slice and no secondary write; a `widget:` id is rejected and the widget card still renders.

12. **Unit / component coverage** in `packages/core/src/modules/catalog/components/products/__tests__/catalogProductFormSections.test.tsx`: for **every** one of the ten ids — card absent when hidden, its payload keys absent, its `validate` not run, its `writeBefore`/`writeAfter` not called; plus the no-override baseline, unknown-id tolerance, `widget:`-id rejection, the all-hidden case, the hidden-`details` + visible-`options` cross-read, and restoration-to-loaded-values. Retain `packages/ui/src/backend/__tests__/CrudForm.hiddenGroups.test.tsx` semantics unchanged. *Testable:* `yarn workspace @open-mercato/core test`.

13. **Self-contained integration spec** at `packages/core/src/modules/catalog/__integration__/TC-CAT-036-product-section-policy.spec.ts`: create its own product fixture, write compliance and UoM data through the API, then assert both halves of the invariant the whole feature rests on — a title-only update with every compliance/UoM key **absent** preserves them, while an explicit `null` clears them per key. Plus a UI round-trip proving the unmodified edit page still saves. Clean up every created record in teardown.

    **Correction to this step as originally written.** It assumed the test could install a policy by calling `applyFormSectionPolicyOverrides`, "so no fixture app module is needed". That is wrong: Playwright drives the *application's* JavaScript context and has no way to reach its module registry, and a section policy is a build-time `modules.ts` decision rather than per-request state — so there is no per-test seam for it at all. The policy-**active** rendering and submit paths are therefore covered by `backend/catalog/products/[id]/__tests__/page.sectionPolicy.test.tsx`, which drives the real page component with a real policy applied, and the integration spec covers the server-side invariant that makes the design safe. Covering the policy-active path in Playwright would require building the app with a fixture policy configured; that is a release-harness concern, not a per-test one.

14. **Document the catalog recipe** in `apps/docs/docs/framework/admin-ui/crud-form.mdx`: the three-way distinction between presentation-only `hiddenGroupIds`, the catalog section policy (presentation **plus** validation, payload and secondary writes), and full widget disablement through `overrides.widgets.injection`; the ten stable ids; and the explicit statement that server validators stay authoritative. *Testable:* docs build.

15. **Refresh the standalone harness** with `.ai/skills/om-refresh-standalone-harness/SKILL.md`, following its failure-first, fresh-scaffold, knowledge-change-manifest, focused-case and release-suite gates. Add one focused case to `packages/create-app/agentic/shared/ai/harness/cases.json` (next free id — `OMH-238` at authoring time — `family: "umes"`, owner `.ai/skills/om-system-extension/references/unified-overrides.md`) whose evaluation requires an agent to: pick `overrides.forms.sections` over page replacement or CSS; read the section ids from generated framework facts rather than from titles; state that hidden sections keep their stored data and run no validation or writes; disable an injected widget through `overrides.widgets.injection` rather than by hiding its card; and refuse to copy or edit installed framework files. Strengthen the smallest owner under `.../skills/om-system-extension/` accordingly. *Testable:* the harness's focused evaluation passes and the failure-first run on the pre-change knowledge base fails.

## 📋 Acceptance Criteria

FR [#6686](https://github.com/open-mercato/open-mercato/issues/6686)'s criteria as the merge bar:

| # | FR acceptance criterion | Satisfied by | Verified by |
|---|---|---|---|
| AC1 | An app module hides any named built-in group via a documented stable contract, without editing installed files | Steps 1–4, 11 | Integration spec (step 13) + the `overrides.mdx` entry |
| AC2 | All ten group ids documented and contract-pinned | Step 8 | Id-order guard test; `BACKWARD_COMPATIBILITY.md` row |
| AC3 | Hidden groups render no card or empty layout space | Step 11 (inherited `hiddenGroupIds`) | Per-section component tests (step 12) |
| AC4 | A hidden group produces no unreachable validation error and runs no section-owned mutation | Steps 3, 9, 11 | `validate` / `writeBefore` / `writeAfter` not-called assertions (step 12) |
| AC5 | Saving a visible field leaves every hidden section's stored data unchanged, conversions included | The omission rule + step 11 | Integration re-read assertions (step 13) |
| AC6 | Visible groups keep current validation, payload, optimistic-lock, audit/event and side-effect behavior | Step 9 | Payload-equality test (step 9); optimistic-lock path untouched |
| AC7 | An injected widget can be fully disabled; hiding `widget:<id>` is not offered as a substitute | The widget rule + step 11 | Rejection test (step 12); docs (step 14) |
| AC8 | Unknown configured ids fail safely with actionable dev diagnostics | Step 11 | Unknown-id tolerance test (step 12) |
| AC9 | No override preserves current rendering and request behavior | Steps 9, 11 | Baseline + payload-equality tests |
| AC10 | Self-contained unit and Playwright coverage ships with the change | Steps 12–13 | Both suites |
| AC11 | Refreshed standalone harness with failure-first evidence and a passing focused evaluation | Step 15 | The harness skill's own gates |

## Resolved assumptions (autonomous defaults)

Written under `--autonomous`; every row is a reversible default a reviewer may overturn before merge.

| # | Question | Resolved answer | Rationale |
|---|---|---|---|
| Q1 | Which mechanism carries the policy from an app module to the page? | A new `entry.overrides.forms.sections` domain, keyed by the CrudForm host spot id | `entry.overrides` is the documented single canonical override surface, and `BACKWARD_COMPATIBILITY.md` § 3 explicitly reserves unused domain keys for additive wiring (`nav` is the 2026-07-30 precedent). A catalog-local registry would be the "parallel substitute" the review checklist rejects. |
| Q2 | Should `CrudForm` also self-resolve its replacement handle so a `propsTransform` could inject `hiddenGroupIds`? | No — out of scope, noted as independent work for #6043 | It delivers presentation only and cannot make submit coherent, so shipping it as *this* mechanism would ship the data-loss hazard. Keeping it separate leaves both changes reviewable. |
| Q3 | What happens to a hidden section's values at submit time? | Restored to their **loaded** values before validation, and omitted from the payload | The only data-safe option, and verified against the command: every scalar and relation is `undefined`-guarded, so omission preserves. Restoring to loaded (not blank) values keeps cross-section reads such as the option-schema title correct. |
| Q4 | Do hidden sections' client validations still gate submit? | No — a hidden section's `validate` never runs; the shared zod parse still runs over restored values | Mirrors the `visibleWhen` / `hiddenBaseFieldIds` precedent. Blocking on an unreachable control strands the user with nothing to fix. |
| Q5 | Can the policy address an injected widget card (`widget:<id>`)? | No — rejected with a dev-only error pointing at `overrides.widgets.injection` | Hiding a widget card leaves its `onBeforeSave` running. Rejecting is the only answer that satisfies the FR's "not presented as a safe substitute" criterion. |
| Q6 | Unknown ids — throw or ignore? | Ignore, dev-only warning | Never white-screen a product page over a stale id after a rename; matches the generic mechanism. |
| Q7 | Two modules declaring a policy for the same host — replace or union? | Replace (later wins), with a warning naming both modules | Uniform with every other override domain; union would be a special case no reader predicts. The warning removes the silent-drop hazard. |
| Q8 | Is the policy read with a getter or a subscription? | `useSyncExternalStore` subscription, with `getFormSectionPolicy` kept for non-React callers | The client dispatcher resolves after first paint, so a plain getter yields a visible flash of cards that then vanish, plus a window where a fast submit runs the wrong section set. |
| Q9 | Does the create wizard adopt the policy in this change? | No | Explicitly out of scope in the FR. The descriptor table is shaped so a later phase can adopt it. |
| Q10 | Is this one capability or should it be split? | One spec, three phases | The transport transports nothing without the catalog consumer, and the refactor hides nothing without the transport; splitting would ship two halves neither of which is usable. The harness refresh is documentation of the same contract, required by the FR. |

No assumption carries `⚠ NEEDS HUMAN CONFIRMATION`. None weakens security, tenant scoping, or a documented compatibility contract; the largest (Q1) lands in a slot the compatibility document already reserves for it, and the second-largest (Q3) is the conservative, data-preserving reading.

## 🔍 Self-review

| Item | Verdict | Justification |
|---|---|---|
| Architectural diff | ✅ | Documents the ownership partition, the omission-preserves proof, the subscription rationale and the widget boundary; does not re-document `CrudForm`, `makeCrudRoute` or the override umbrella. |
| Scope cohesion | ✅ | One capability — externally configurable, behaviorally coherent catalog product sections (Q10). *Note: the checklist's fresh-context subagent delegation for this item was not used, per this session's no-subagent policy; the check was applied inline.* |
| Canonical mechanisms | ✅ | Reuses `entry.overrides` + its dispatcher, `hiddenGroupIds`, `CrudForm`, `updateCrud`/`createCrud`/`deleteCrud`, `createCrudFormError`, `logger`. The one new construct — the section descriptor table — is catalog-owned domain data, not a framework substitute. |
| Contracts and compatibility | ✅ | Three additive surfaces, one of them in a slot `BACKWARD_COMPATIBILITY.md` reserves; nothing removed or renamed, so no deprecation protocol. Payload shape unchanged. |
| Reversibility | ✅ | No migration, no persisted state; rollback is deleting the domain and its consumer. The undo contract of `catalog.product.update` is untouched — the policy changes which optional keys the client sends, not how the command executes or undoes. |
| Boundaries and coupling | ✅ | Transport in `shared`, hook in `ui`, semantics in `catalog`; no cross-module ORM relation, no new module dependency. `@open-mercato/shared` gains no domain knowledge — the domain is a `Record<string, {hidden}>`. |
| Sensitive data | ✅ (n/a) | No PII, credential or free-text-about-people field introduced; no encryption map affected. Hidden fields are not exfiltrated anywhere new — they are sent *less* often. |
| Failure scenarios | ✅ | Fourteen cases with observable behaviour, including the three genuinely surprising ones (offer denormalisation drift under a hidden `categorize`, the all-hidden `{ id }`-only payload, and the invalid-stored-value parse failure the sanitiser cannot fix). |
| Testability | ✅ | Every step names its verification; the riskiest (R1, step 9) has a dedicated byte-equality snapshot, and the FR's eleven acceptance criteria each map to a step and a test. |
| Tenant isolation | ✅ (n/a) | Client-side form policy only; every server query and guard is unchanged and remains authoritative. |

## 📋 Final Compliance Report — 2026-09-30

| Area | Status | Evidence |
|---|---|---|
| Grounding against the codebase | ✅ | Group ids, `handleSubmit` structure, `buildComplianceProductPayload`'s always-emit behaviour, the `undefined`-guarded update command, `syncOffers`/category/tag/metadata/custom-field preservation, `DataTable`'s self-resolution vs `CrudForm`'s DOM-only handle, the `nav` domain shape, and `CLIENT_OVERRIDE_DOMAINS`' two mirrored copies were each read at `521e99611` rather than assumed. |
| Backward compatibility | ✅ | Additive only; the new domain key sits in the reserved slot of `BACKWARD_COMPATIBILITY.md` § 3, and the ten group ids are promoted to a pinned constant under the existing protected-ids row. |
| Data & security | ✅ (n/a) | No entity, column, migration, endpoint, ACL feature, DI key or tenant-scoped query. Server validators, mutation guards and optimistic locking stay authoritative. |
| i18n | ✅ (n/a) | No new user-facing string; the two new diagnostics are dev-only and `[internal]`-prefixed. The policy is keyed on ids, never on translated titles. |
| Design system | ✅ | Nothing new is drawn; the component extraction carries the Boy Scout obligation for touched lines. |
| Performance | ✅ (n/a) | One `useSyncExternalStore` read per form mount over a process-local map; no query, index or cache surface changes. |
| Test plan | ✅ | Steps 9, 12, 13 and 15 cover all eleven FR acceptance criteria, including the no-override byte-equality baseline and the stored-data-unchanged re-read. |
| Documentation | ✅ | `modules/overrides.mdx`, `admin-ui/crud-form.mdx`, `packages/shared/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, the umbrella spec status table, and the standalone-harness owner. |
| Open Questions | ✅ | Ten raised, ten resolved with reversible defaults; none carries `⚠ NEEDS HUMAN CONFIRMATION`. |

## 📋 Changelog

- **2026-09-30** — Implementation corrections, recorded while building on the implementation PR. Step 7 (extracting the six inline section components) **descoped** with its reason; step 13's integration approach **corrected** — the programmatic override tier is not reachable from a browser-driven test, so the policy-active coverage lives in the component tests and the integration spec pins the server-side omission-preserves / null-clears invariant instead. Both are flagged on the implementation PR for a reviewer to overrule.
- **2026-09-30** — Initial specification (`om-auto-write-spec`, FR #6686). Ten Open Questions resolved with autonomous defaults.
