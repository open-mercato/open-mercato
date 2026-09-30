# Execution plan — catalog product edit section policy

Source doc: `.ai/specs/2026-09-30-catalog-product-form-section-policy.md` (spec PR [#6769](https://github.com/open-mercato/open-mercato/pull/6769) — design-only, not merged; this run implements against it at the maintainer's explicit direction)
Tracking issue: [#6686](https://github.com/open-mercato/open-mercato/issues/6686)
Engine: `om-auto-create-pr` (steps: 15, --loop: no)

## Goal

Let a standalone app module hide any built-in section of the catalog **product edit** form declaratively, so that the card, its client validation, its slice of the update payload and its secondary writes are all disabled together while every stored value is preserved.

## Scope

- **New override domain** `entry.overrides.forms.sections` in `@open-mercato/shared` — data-only, keyed by CrudForm host spot id, built like the existing `nav` domain.
- **Catalog section descriptors** — one table owning ids, fields, validation, payload slices and secondary writes for the ten shipped product-form groups.
- **Page rewiring** — `groups`, `hiddenGroupIds` and `handleSubmit` all derived from that table.
- Unit + integration coverage, docs, and the standalone-harness refresh.

## Non-goals

- The product **create** wizard (`products/create/page.tsx`) — explicitly out of scope in the FR.
- Making `CrudForm` self-resolve its replacement handle (independent work for #6043).
- Per-product/per-record or per-role visibility rules.
- Any server-side schema, validator, ACL or API change — server invariants stay authoritative.

## Key verified facts driving the design

- `productUpdateSchema` is `.partial()`, and `catalog.product.update` gates every scalar and relation behind `!== undefined` (`syncOffers`, category/tag syncs, `hasOwnProperty('metadata')`, `setCustomFieldsIfAny`). **Omitting a payload key preserves; it does not clear.**
- `buildComplianceProductPayload` always emits all 23 compliance/SEO keys, nulling blanks — hiding that card without dropping its keys would wipe stored data. This is the regression the run must prevent.
- `CLIENT_OVERRIDE_DOMAINS` exists in two mirrored copies (`apps/mercato` + create-app template), each with a test pinning `['widgets','notifications']`.

## Risks

- **R1 (High)** — the `handleSubmit` restructure regresses the default no-override path used by every product edit. Mitigated by a byte-equality payload test written *before* the refactor and kept green through it.
- **R2 (Medium)** — a form field attributed to the wrong section, or to none. Mitigated by a guard test asserting the `ownedFields` union covers every editable `ProductFormValues` key minus an explicit exclusion list.
- **R3 (Medium)** — a secondary write path missed. Mitigated by locating every write in a descriptor rather than in `handleSubmit`.
- **R4 (Low)** — only one of the two mirrored `ClientBootstrap.tsx` copies updated. Mitigated by changing both plus `yarn template:sync:fix`.
- **R5 (Low)** — extracting six inline section components changes rendering. Mitigated by keeping the extraction a pure move.

## Implementation Plan

### Phase 1 — the `forms.sections` override domain

Shared-package transport, no consumer yet; inert by construction.

### Phase 2 — catalog section model (no behaviour change)

Extract the inline sections, introduce the descriptor table, rebuild `handleSubmit` over it with an empty hidden set, guarded by the payload-equality test.

### Phase 3 — wire the policy, cover it, document it

Consume the policy, add diagnostics, ship unit + integration coverage, docs, harness refresh.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: forms.sections override domain

- [ ] 1.1 Declare `FormSectionPolicy` / `FormsOverridesShape`, add `forms` to `ModuleOverrides`, `ModuleOverrideDomain` and `DOMAIN_KEYS`
- [ ] 1.2 Add globalThis-backed state, normaliser, applier and the multi-module warning
- [ ] 1.3 Export `applyFormSectionPolicyOverrides` / `getFormSectionPolicy` / `subscribeToFormSectionPolicies`; clear state in the test reset hook
- [ ] 1.4 Add `forms` to `CLIENT_OVERRIDE_DOMAINS` in both mirrored ClientBootstrap copies and both tests; run template sync
- [ ] 1.5 Add the `useFormSectionPolicy` React reader in `packages/ui`
- [ ] 1.6 Document the domain (overrides.mdx, shared AGENTS.md, umbrella spec status row, BACKWARD_COMPATIBILITY.md)

### Phase 2: catalog section model

- [ ] 2.1 Extract the six inline product form section components into `components/products/sections/`
- [ ] 2.2 Add `formSections.ts` with the ten descriptors, `ownedFields`, and the id/ownership guard tests
- [ ] 2.3 Rebuild `handleSubmit` over the descriptor table with an empty hidden set, under a payload-equality test
- [ ] 2.4 Build the rendered `groups` array from the descriptor table

### Phase 3: wire the policy, cover it, document it

- [ ] 3.1 Resolve the policy in the page, pass `hiddenGroupIds`, add the unknown-id and `widget:`-id diagnostics
- [ ] 3.2 Unit/component coverage for all ten sections plus baseline, all-hidden, cross-read and restoration cases
- [ ] 3.3 Self-contained Playwright integration spec proving hidden-section data and conversions survive a save
- [ ] 3.4 Document the catalog recipe in the CrudForm docs page
- [ ] 3.5 Refresh the standalone harness with a focused case and its owner knowledge
