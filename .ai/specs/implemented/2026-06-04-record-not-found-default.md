# RecordNotFoundState — Improve UX and make it the default not-found component

- Date: 2026-06-04
- Issue: [#2127](https://github.com/open-mercato/open-mercato/issues/2127)
- Scope: OSS (`packages/ui`, `packages/core`)
- Status: Draft

## Problem

`RecordNotFoundState` (`packages/ui/src/backend/detail/RecordNotFoundState.tsx`) renders its body
through `ErrorMessage`, which is a **destructive alert** (`border-destructive/50 bg-destructive/5
text-destructive`, `role="alert"`, `AlertCircle` icon). A missing record therefore looks like a
critical, alarming error (red box, red text) instead of a calm, neutral "nothing here" state.

The component is already adopted as the de-facto not-found UI across **39 backend detail/edit pages**,
but because the component itself wraps `ErrorMessage`, every one of those pages shows the same red
alert. It also has **no unit test** and **no entry** in the DS component reference. A handful of
backend detail/edit pages still render their own not-found state via `ErrorMessage`/`throw` instead
of using the component.

## Goals

1. Rewrite `RecordNotFoundState` to render a neutral, centered empty state using the existing
   `EmptyState` primitive (`variant="subtle"`), fixing the UX on all 39 adopters at once.
2. Keep the public API **1:1 backward compatible** so no adopter changes are required.
3. Add a unit test for the component.
4. Document it in `.ai/ui-components.md` and correct the guidance in `packages/ui/AGENTS.md`.
5. Migrate the 4 remaining backend detail/edit stragglers that still hand-roll not-found.
6. Bring the portal / public / embedded not-found surfaces into the same neutral UX. They render a
   destructive red alert / raw red text today (same root problem as the bug). Where the backend
   `RecordNotFoundState` API does not fit (frontend/portal layer, no backend "back to list"), render
   the shared `EmptyState` primitive (`variant="subtle"`) directly to keep neutral, DS-consistent UX.

## Non-goals (explicitly out of scope)

- `auth/frontend/login.tsx` inline "Tenant not found" (~line 387): an inline warning rendered inside
  the login card during tenant selection, not a page-level record-not-found. Leave as-is.
- Generalizing `RecordNotFoundState` itself into a frontend/portal export path (its `@open-mercato/ui/
  backend/detail` location and `backHref`-to-backend-list shape stay backend-scoped); portal/public use
  the `EmptyState` primitive instead.

## Design

### Component rewrite (`packages/ui/src/backend/detail/RecordNotFoundState.tsx`)

Compose `EmptyState` from `@open-mercato/ui/primitives/empty-state` instead of `ErrorMessage`:

- `variant="subtle"` — no dashed box; round muted icon container; reads as a full-page state.
- Default leading icon (`SearchX` from `lucide-react`), overridable via a new optional `icon` prop.
- `title` = `label`; `description` = `description`.
- Action = the provided `action` node, else the default back button when `backHref` is set:
  `<Button asChild variant="outline" size="sm"><Link href={backHref}>{backLabel ?? t(...)}</Link></Button>`.
  The back affordance **MUST remain a real `<a>` (role `link`)** — integration tests assert
  `getByRole('link', { name: /back to .../i })` + `href`.
- Keep the outer centering wrapper (`min-h-[50vh]`, centered) and `className` passthrough.
- Preserve the `formatErrorMessageLabel` safety net (reuse the exported helper) so a leaked technical
  i18n key still renders readably.

**Public API** (unchanged + additive):

```ts
export type RecordNotFoundStateProps = {
  label: string
  description?: string
  backHref?: string
  backLabel?: string
  action?: React.ReactNode
  className?: string
  icon?: React.ReactNode   // NEW, optional, additive — defaults to <SearchX />
}
```

No exports removed; only an optional prop added → additive, non-breaking per `BACKWARD_COMPATIBILITY.md`.

### Straggler migration (4 backend detail/edit pages)

Each currently does `if (!record) throw new Error(t('...notFound...'))` inside the loader, folds it
into the generic `error` state, and renders `<ErrorMessage label={error ?? notFound} />`. Migrate to
the same shape `currencies/[id]/page.tsx` already uses: a dedicated `isNotFound` boolean rendered via
`RecordNotFoundState`, with `ErrorMessage` reserved for genuine load failures.

| # | File | Back target |
|---|------|-------------|
| 1 | `packages/core/src/modules/staff/backend/staff/timesheets/projects/[id]/page.tsx` | projects list |
| 2 | `packages/core/src/modules/staff/backend/staff/timesheets/projects/[id]/edit/page.tsx` | project detail/list |
| 3 | `packages/core/src/modules/catalog/backend/catalog/products/[productId]/variants/create/page.tsx` | parent product (`/backend/catalog/products/${productId}`) |
| 4 | `packages/core/src/modules/resources/backend/resources/resource-types/[id]/edit/page.tsx` | resource-types list |

For #3 the parent **product** is the missing record; show `RecordNotFoundState` (back to product)
instead of rendering the create form behind an inline error banner.

`currencies/[id]/page.tsx` is already correct (uses `RecordNotFoundState` + a separate generic
`ErrorMessage`) and is intentionally NOT in this list.

### Portal / public / embedded not-found (neutral `EmptyState`)

These also render a red alarm today and move to a neutral state. Backend `RecordNotFoundState` is not
used here (see Non-goals); instead render the `EmptyState` primitive with `variant="subtle"`.

| # | File | Current | Approach |
|---|------|---------|----------|
| 5 | `packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx` | `<Alert variant="destructive">` org-not-found | `EmptyState` `subtle` `lg`, message `portal.org.invalid`, no back-to-list action |
| 6 | `packages/core/src/modules/portal/frontend/[orgSlug]/portal/login/page.tsx` | same | same |
| 7 | `packages/core/src/modules/portal/frontend/[orgSlug]/portal/signup/page.tsx` | same | same |
| 8 | `packages/core/src/modules/portal/frontend/[orgSlug]/portal/reset-password/page.tsx` | same | same |
| 9 | `packages/core/src/modules/sales/frontend/quote/[token]/page.tsx` | raw `<p className="text-destructive">` | `EmptyState` `subtle`, message `sales.quotes.public.notFound`; keep the combined `error || !data` branch |
| 10 | `packages/core/src/modules/sales/components/channels/ChannelOfferForm.tsx` | `throw notFound` swallowed into a generic load error | split a `notFound` flag from the generic error; render `RecordNotFoundState` (backend sales) at the top-level return, `backHref` → the channel's offers list |

Item 10 is the highest-risk change (a 1300-line form where not-found is currently buried) and will be
handled last, after the component and the simpler migrations are green.

## Backward Compatibility

- `RecordNotFoundState` props/exports unchanged; one optional `icon` prop added (additive).
- Visual change (red alert → neutral empty state) is the intended bug fix.
- The 4 dedicated integration tests (`TC-UX-006/007/008/009`) assert on the not-found **text** and the
  **back link** (`role=link` + href), not on `role="alert"` or destructive styling — verified
  compatible with the rewrite.

## Test / Integration Coverage

- **Unit (new):** `packages/ui/src/backend/detail/__tests__/RecordNotFoundState.test.tsx` — renders
  title, renders back link with correct href when `backHref` set, renders custom `action`, is **not**
  `role="alert"` (regression guard against reintroducing the destructive box).
- **Existing integration (must stay green):** `TC-UX-006` (people), `TC-UX-007` (documents),
  `TC-UX-008` (back nav / companies), `TC-UX-009` (document orders) — cover the 39-adopter rendering
  path through the rewritten component.
- **Migrated stragglers:** covered by typecheck + the shared rendering path; an integration test for a
  migrated staff-timesheets-project not-found is optional follow-up (no new API surface).
- **Portal / public / `ChannelOfferForm`:** UI-only swaps (destructive alert / raw red text →
  neutral `EmptyState`; buried throw → explicit not-found). No API or route changes. Existing portal
  and sales suites must stay green; verify the affected pages still mount with `yarn typecheck` +
  targeted UI mounting.

## Validation

```bash
yarn build:packages
yarn typecheck
yarn lint
yarn workspace @open-mercato/ui test
# + the four TC-UX-00x integration specs via the ephemeral runner
```

## Changelog

- `RecordNotFoundState` now renders a neutral empty state (was a destructive red alert); fixes #2127.
- Added unit test + DS reference entry; corrected `packages/ui/AGENTS.md` not-found guidance.
- Migrated 4 backend detail/edit pages to `RecordNotFoundState`.
- Portal "Organization not found" (4 pages) and the public quote page now use a neutral `EmptyState`
  instead of a destructive alert / raw red text.
- `ChannelOfferForm` distinguishes a missing offer from a load error and renders a neutral not-found.
