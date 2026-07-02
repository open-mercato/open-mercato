# Deal create form: `initialValues` prop for prefilled defaults

## TLDR

`CreateDealForm` starts every new deal from `EMPTY_VALUES` and exposes only a `returnTo` prop, so downstream apps cannot pre-fill the "new deal" form (default status, currency, expected close date, etc.). This adds an additive, opt-in `initialValues?: Partial<BaseValues>` prop merged over `EMPTY_VALUES` for the initial form state. Omitting it preserves current behavior exactly. It also proposes two follow-ups — an opt-in auto-select of the default pipeline + first stage, and a pluggable way for `create/page.tsx` to source per-tenant defaults — for maintainer decision.

## Problem

Downstream apps frequently need new deals to open with sensible defaults (e.g. status = active, the org's default pipeline + first stage, a base currency, an expected close date N days out). Today that is not possible without forking the component:

- `CreateDealForm` initializes local state to `EMPTY_VALUES` and takes only `returnTo`.
- The form is bespoke (not a generic `CrudForm`), so there is no field-injection spot to seed values.
- Overriding the page component via the component-replacement registry renders the swapped client component under a different React instance in the App Router server catch-all, which breaks all hooks (`Invalid hook call` / `Cannot read properties of null (reading 'useContext')`). `next/dynamic` does not resolve it.
- Path-shadowing the route loses `findBackendMatch` (first-match by module order; a core route registered before an app module always wins).

Net: there is no clean, upgrade-safe downstream mechanism to prefill this form.

## Solution (this change)

Add an optional, additive prop and use a lazy initializer that merges it over `EMPTY_VALUES`:

```ts
export type CreateDealFormProps = {
  returnTo: string
  /** Seed values merged over EMPTY_VALUES for the initial form state. Additive: omitting it preserves current behavior. */
  initialValues?: Partial<BaseValues>
}

export function CreateDealForm({ returnTo, initialValues }: CreateDealFormProps) {
  const [values, setValues] = React.useState<BaseValues>(() => ({ ...EMPTY_VALUES, ...initialValues }))
  // ...unchanged
}
```

Consumers can seed the simple fields (`status`, `valueCurrency`, `expectedCloseAt`, `title`, `description`). Pipeline/stage prefill is intentionally out of scope for this prop because it needs runtime resolution (env-specific IDs) plus the pipeline→stage cascade — see Proposed Follow-ups.

## Backward Compatibility

Purely additive. When `initialValues` is omitted the initializer resolves to `EMPTY_VALUES` — byte-for-byte the previous behavior. No change to the `returnTo` contract, the submit payload, or the rendered fields. No migration. Aligns with the additive-only classification for component props in `BACKWARD_COMPATIBILITY.md`.

## Proposed Follow-ups (for maintainer decision)

1. **Auto-select the default pipeline + first stage** (opt-in, e.g. `autoSelectDefaultPipeline?: boolean`). The form already loads pipelines via `useDealPipelines`; on create it could pick the `isDefault` pipeline (fallback: first) and its first stage (by `order`), driving `loadStages`. Generally useful — most CRMs want a new deal to land in the default pipeline's entry stage. Kept opt-in to preserve current behavior.
2. **Pluggable per-tenant defaults in `create/page.tsx`.** The core create page renders `<CreateDealForm returnTo=… />` and does not pass `initialValues`, so a downstream app still cannot inject defaults without overriding the page (which hits the dual-React problem above). Proposal: have the create page source `initialValues` (and any auto-select flag) from a pluggable seam — e.g. `ModuleConfigService` (tenant-scoped `module_configs`), a DI-resolvable defaults provider, or a documented hook — so apps configure defaults declaratively without replacing the page. Final shape is a maintainer call.

## Testing

- `yarn typecheck` — the additive prop + functional initializer type-check.
- Manual: render `CreateDealForm` with and without `initialValues`; confirm omitted → empty form (unchanged), provided → fields pre-filled and editable.

## Changelog

- 2026-07-02 — Initial spec + additive `initialValues` prop on `CreateDealForm`. Follow-ups (auto-default-pipeline, pluggable page defaults) proposed for maintainer decision.
