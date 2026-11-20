# Customers: Replaceable Avatar in the Company and Person Detail Headers

## TLDR

**Key Points:**
- `CompanyDetailHeader` and `PersonDetailHeader` resolve their avatar through the component registry under two new handles, `section:customers.companies.detailHeader.avatar` and `section:customers.people.detailHeader.avatar`, the same way the detail tabs already resolve through `section:customers.companies.detailTabs` / `section:customers.people.detailTabs`.
- An app can then show a company logo or a contact photo in the header with a `wrapper` or `replacement` override instead of ejecting the whole `customers` module (#6490).

**Scope:**
- One new client leaf, `components/detail/DetailHeaderAvatar.tsx`: two handle constants, two props types, two default components that render exactly today's `Avatar`, and two host components that resolve the handles.
- Both headers render the host component in place of the hard-coded `Avatar`.
- Both handles declared in `customers/extension-points.ts`; unit tests; handle docs in the module's `AGENTS.md`; a dated `BACKWARD_COMPATIBILITY.md` section.

**Out of scope:**
- Image storage in core: no column, no API field, no upload flow. Where the image comes from stays with the app.
- Avatars elsewhere (list rows, `CompanyCard`, `PersonCard`, `DealDetailHeader`).

**Concerns:**
- The handle IDs and props types become frozen contract surfaces once released. The #6490 triage asked for this spec so they are agreed before implementation.

## Overview

The company and person detail pages open the header card with a large avatar: a building icon for companies, initials for people. CRM users commonly expect a logo or a photo there. Core stores no image for either record, and this spec does not add one. It only opens the avatar element to the existing component replacement mechanism (UMES Phase H), so each app decides where images come from: its own module, an attachment, a custom field, or a domain-based logo service.

> **Market Reference**: Odoo shows the partner image from an image field stored on the record in the contact form header; Twenty derives a company logo from the company domain. Both treat a picture in the record header as expected. This spec adopts neither storage model: core stays storage-agnostic and exposes the rendering seam, and either model can be built on top of it by an app.

## Problem Statement

- The avatar is hard-coded. `CompanyDetailHeader.tsx:107-112` renders `<Avatar label="" icon={<Building2 />} size="xl" variant="monochrome" />` and `PersonDetailHeader.tsx:129` renders `<Avatar label={displayName} size="xl" variant="monochrome" />` (both under `packages/core/src/modules/customers/components/detail/`, `develop` @ `12f4349`). Neither header uses the component registry or accepts an avatar prop.
- The declared detail spots (`detail:customers.company:header`, `…:status-badges`, `…:footer` and the person twins in `customers/extension-points.ts`) are rendered by the pages outside the header card. A widget there can add content next to the header but cannot change the avatar.
- `Avatar` already renders an image (`src`, `packages/ui/src/primitives/avatar.tsx:139`); only the host is closed.
- The remaining workarounds are expensive. Ejecting `customers` freezes a copy of the whole module, so the app stops receiving upstream changes to it; between 0.7.0 and 0.8.0 those included security fixes (#5462, #5469, #6021) and a record-existence leak fix (#5517). Overriding both detail pages through `overrides.routes.pages` copies about 1,400 lines of page code plus both headers to change one element.

## Proposed Solution

New leaf `packages/core/src/modules/customers/components/detail/DetailHeaderAvatar.tsx`, following `CompanyDetailTabs.tsx:35, 180-195`:

```tsx
"use client"

import * as React from 'react'
import { Building2 } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import type { CompanyOverview, PersonOverview } from '../formConfig'

export const COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID = 'section:customers.companies.detailHeader.avatar'
export const PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID = 'section:customers.people.detailHeader.avatar'

export type CompanyDetailHeaderAvatarProps = { data: CompanyOverview; displayName: string }
export type PersonDetailHeaderAvatarProps = { data: PersonOverview; displayName: string }

function DefaultCompanyDetailHeaderAvatar(_props: CompanyDetailHeaderAvatarProps) {
  return <Avatar label="" icon={<Building2 />} size="xl" variant="monochrome" />
}

function DefaultPersonDetailHeaderAvatar({ displayName }: PersonDetailHeaderAvatarProps) {
  return <Avatar label={displayName} size="xl" variant="monochrome" />
}

registerComponent<CompanyDetailHeaderAvatarProps>({
  id: COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  component: DefaultCompanyDetailHeaderAvatar,
  metadata: { module: 'customers', description: 'Avatar in the company detail header.' },
})

registerComponent<PersonDetailHeaderAvatarProps>({
  id: PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID,
  component: DefaultPersonDetailHeaderAvatar,
  metadata: { module: 'customers', description: 'Avatar in the person detail header.' },
})

export function CompanyDetailHeaderAvatar(props: CompanyDetailHeaderAvatarProps) {
  const Resolved = useRegisteredComponent<CompanyDetailHeaderAvatarProps>(
    COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID,
    DefaultCompanyDetailHeaderAvatar,
  )
  return <Resolved {...props} />
}

// PersonDetailHeaderAvatar: the same with the person constant, props type and default.
```

In the headers, `<CompanyDetailHeaderAvatar data={data} displayName={displayName} />` replaces the inline `Avatar` in `CompanyDetailHeader`, and `<PersonDetailHeaderAvatar data={data} displayName={displayName} />` does the same in `PersonDetailHeader`. `displayName` is the value each header already computes, with its `…detail.untitled` fallback.

Both handles are declared in `customers/extension-points.ts`, following the `staff` and `checkout` component-handle declarations:

```ts
companyHeaderAvatar: componentExtensionHost({
  componentId: 'section:customers.companies.detailHeader.avatar',
  propsContract: 'customers.company_detail_header_avatar.props.v1',
  source: ['components/detail/CompanyDetailHeader.tsx', 'components/detail/DetailHeaderAvatar.tsx'],
}),
personHeaderAvatar: componentExtensionHost({
  componentId: 'section:customers.people.detailHeader.avatar',
  propsContract: 'customers.person_detail_header_avatar.props.v1',
  source: ['components/detail/PersonDetailHeader.tsx', 'components/detail/DetailHeaderAvatar.tsx'],
}),
```

What an app would write (illustrative, not part of this change). A wrapper keeps the default as the fallback:

```ts
// src/modules/<app_module>/widgets/components.ts
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { withCompanyLogo } from '../components/withCompanyLogo'

export const componentOverrides: ComponentOverride[] = [
  {
    // Spelled in this file rather than imported from core: the extension-fact extractor folds
    // values only within the file it reads (see apps/mercato/src/modules/example/widgets/components.ts).
    target: { componentId: ComponentReplacementHandles.section('customers.companies.detailHeader', 'avatar') },
    priority: 100,
    metadata: { module: '<app_module>' },
    // Renders <Avatar src={logoUrl} size="xl" … /> when the app has a logo for props.data.company.id,
    // otherwise <Original {...props} />. Dynamic values are read inside the returned component's render.
    wrapper: (Original) => withCompanyLogo(Original),
  },
]
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Component registry handle, not an injection spot | The goal is to replace one element, not to add one. The registry already provides `replacement`, `wrapper` and `propsTransform` modes, feature gating (`features`), dev-time props validation, and an error boundary that falls back to the default. |
| Props `{ data, displayName }` | `data` is the object the header already receives: the detail response the page loads from `GET /api/customers/companies/{id}` / `GET /api/customers/people/{id}`, whose fields §7 already protects from removal. The handle therefore freezes two prop names and that meaning, as `InjectionWidgetComponentProps` does for `data` (§2). Overrides get the record id, `customFields` and `profile` without an extra request; `displayName` carries the header's own fallback, so an image is labelled like the heading. |
| IDs `section:customers.<companies\|people>.detailHeader.avatar` | Same `section:` family and scope as the `detailTabs` handles; `detailHeader.avatar` leaves room for other header sections without renaming. A test pins them to `ComponentReplacementHandles.section(...)` and to the extension-point declarations. |
| A leaf module instead of editing the header bodies | `PersonDetailHeader.tsx` is already 318 lines. The leaf keeps each header diff to one import and one element, and gives adopters one import path for both props types. Constants and host components follow the `CompanyDetailTabs` shape. |
| One spec for both headers | Same capability, pattern, module and PR; split specs would be identical (checklist §1 bundle test). |
| No exported Zod props schema | `replacement` overrides already supply their own `propsSchema` (registry type); `wrapper` and `propsTransform` need none, and the recommended pattern is a wrapper. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Injection spot (`detail:customers.company:header-avatar` + person twin) that replaces the default when a widget is registered | Injection spots add content. "Replace when present" would be new semantics for a single spot, with no wrapper or fallback composition. |
| Optional image URL in the detail response, filled by a response enricher and passed to `Avatar src` | Puts a presentation concern into the detail API contract (field name, URL vs attachment id, signed-URL lifetime) and still gives no way to customise rendering. |
| Override both detail pages via `overrides.routes.pages` | Copies about 1,400 lines of page code plus both headers to change one element, and drifts with every release. |
| Eject `customers` | Freezes the whole module: the status quo #6490 asks to remove. |

## Architecture

```
companies-v2/[id]/page.tsx ─▶ CompanyDetailHeader ─▶ CompanyDetailHeaderAvatar
                                                     └─ useRegisteredComponent('section:customers.companies.detailHeader.avatar', default)
                                                        ├─ no override             → DefaultCompanyDetailHeaderAvatar (today's Avatar)
                                                        ├─ replacement / wrapper   → app component, inside ReplacementErrorBoundary
                                                        └─ replacement/wrapper throws → boundary renders the default and logs the error
people-v2/[id]/page.tsx    ─▶ PersonDetailHeader  ─▶ PersonDetailHeaderAvatar (same flow, person handle)
```

- Registration is a module-level side effect of `DetailHeaderAvatar.tsx`, which both headers import, as with `CompanyDetailTabs`.
- `useRegisteredComponent` returns a component whose identity depends only on the handle, so the header does not remount when the override bundle arrives after first paint (hook contract, #5037). The defaults are module-level, so the fallback identity is stable too.
- Overrides resolve in priority order: the highest-priority `replacement` becomes the base, `wrapper`s compose around it, `propsTransform`s run on the props. An override with `features` applies only to users who have them; everyone else sees the default.
- No server code, commands, events, cache or data flow change.

### Frontend Architecture Contract

**Server/Client boundary map**

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/customers/companies-v2/[id]`, `/backend/customers/people-v2/[id]` | unchanged | `CompanyDetailHeader` / `PersonDetailHeader` (already client) → new `DetailHeaderAvatar` leaf | the page (existing `readApiResultOrThrow` load) | No page-root change |

**`"use client"` ledger**

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/detail/DetailHeaderAvatar.tsx` | Calls `useRegisteredComponent`, which reads the override provider context and holds identity refs | `CompanyDetailHeader.tsx`, `PersonDetailHeader.tsx` (both already `"use client"`) | None: `Avatar` primitive, `Building2` icon, registry helpers | None; default markup identical to today | Inline in each header, which grows a 318-line client file |

**Budgets**

| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client files over 300 LOC | 0 unless justified | `PersonDetailHeader.tsx` (318 lines, pre-existing); net change about one line |
| Heavy browser libraries at page/provider root | 0 | 0 |
| Per-route hydration smoke test | required for changed interactive route | Default markup unchanged; pinned by header render tests |
| Performance evidence | static check + one runtime/build/bundle/RSS signal when feasible | `yarn check:client-boundaries` output in the PR |

**Provider / bootstrap scope:** none touched. Overrides reach the handles through the existing `ComponentOverrideProvider` / `ComponentOverridesBootstrap`.

## Data Models

None: no schema changes.

## API Contracts

No HTTP routes change. New TypeScript exports, all additive, from `@open-mercato/core/modules/customers/components/detail/DetailHeaderAvatar`:

- `COMPANY_DETAIL_HEADER_AVATAR_COMPONENT_ID`, `PERSON_DETAIL_HEADER_AVATAR_COMPONENT_ID`
- `type CompanyDetailHeaderAvatarProps`, `type PersonDetailHeaderAvatarProps`
- `CompanyDetailHeaderAvatar`, `PersonDetailHeaderAvatar`

New component-handle hosts in the customers extension points: `companyHeaderAvatar`, `personHeaderAvatar`.

## Internationalization (i18n)

No new strings. The person default keeps using `displayName`, which already falls back to `customers.people.detail.untitled`; the company default keeps an icon with an empty label.

## UI/UX

No visual change without overrides. The avatar is the first item of the header's flex row (`sm:flex-row sm:items-start`). Overrides should keep the `size="xl"` footprint (`size-16`) so the heading does not shift; `Avatar` with `src` keeps it.

## Migration & Backward Compatibility

- Without overrides, both headers render the same element tree as today (same `Avatar` props); tests pin it.
- The handle IDs are new, so adding them is additive (§6 "MAY add new spot IDs"). Once released they are treated as FROZEN, as the #6490 triage classifies them: no rename, no removal, no change to the props passed.
- The new exports are additive (§2, §4). After release, `data` and `displayName` MUST NOT be removed or narrowed; optional props MAY be added.
- The two new hosts in `customers/extension-points.ts` are additive (`ModuleExtensionPoints`, §2; `componentExtensionHost`, §3).
- No database migration and no API change. No `UPGRADE_NOTES.md` entry, because nothing changes for existing apps. `BACKWARD_COMPATIBILITY.md` gets a dated section that lists both handles and their props as new frozen surfaces.

## Implementation Plan

### Phase 1: Handles, declaration, tests, docs (one PR)

1. Add `components/detail/DetailHeaderAvatar.tsx` as above. → Verify: `yarn typecheck`.
2. `CompanyDetailHeader.tsx`: render `<CompanyDetailHeaderAvatar data={data} displayName={displayName} />` instead of the inline `Avatar`; drop imports this leaves unused. → Verify: the existing `CompanyDetailHeader.test.tsx` passes unchanged.
3. `PersonDetailHeader.tsx`: the same with `PersonDetailHeaderAvatar`. → Verify: the existing `PersonDetailHeader.test.tsx` passes unchanged.
4. `customers/extension-points.ts`: add `companyHeaderAvatar` and `personHeaderAvatar`. → Verify: `yarn generate` completes without new warnings.
5. Tests below. → Verify: `yarn test` for `packages/core` (customers).
6. Docs: a short "Component replacement handles" section in `packages/core/src/modules/customers/AGENTS.md` listing every `section:customers.*` handle the module registers (new and existing), each with its props and the note on footprint and caching from Risks; the dated section in `BACKWARD_COMPATIBILITY.md`.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/components/detail/DetailHeaderAvatar.tsx` | Create | Handles, props types, defaults, registration, host components |
| `packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx` | Modify | Render `CompanyDetailHeaderAvatar` |
| `packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx` | Modify | Render `PersonDetailHeaderAvatar` |
| `packages/core/src/modules/customers/extension-points.ts` | Modify | Declare both component-handle hosts |
| `packages/core/src/modules/customers/components/detail/__tests__/DetailHeaderAvatar.test.tsx` | Create | Handle behaviour and spelling guard |
| `packages/core/src/modules/customers/components/detail/__tests__/CompanyDetailHeader.test.tsx`, `PersonDetailHeader.test.tsx` | Modify | One host-level override case each |
| `packages/core/src/modules/customers/AGENTS.md` | Modify | Document the handles |
| `BACKWARD_COMPATIBILITY.md` | Modify | Dated section for the new frozen surfaces |

### Testing Strategy

`__tests__/DetailHeaderAvatar.test.tsx` (jsdom, wrapped in `ComponentOverrideProvider` as in `packages/ui/src/backend/injection/__tests__/useRegisteredComponent.remount.test.tsx`):

- No override: the company avatar renders the building icon with an empty label; the person avatar renders initials from `displayName`. Same props as before the change.
- `replacement`: the replacement renders instead of the default and receives the same `data` object and `displayName`.
- `wrapper`: the wrapper receives the default as `Original`; rendering `Original` gives today's avatar.
- A `replacement` that throws: the default renders.
- An override gated by `features` the user lacks: the default renders.
- Spelling guard: each constant equals `ComponentReplacementHandles.section(...)` and the matching `extensionPoints.hosts.*.componentId`.

`CompanyDetailHeader.test.tsx` / `PersonDetailHeader.test.tsx`: one case each. With a `replacement` registered, the header renders it in the avatar position and still renders the heading and actions.

No integration test: the change is client-side rendering with unchanged default markup. The consuming side of the new contract, an override module targeting the handle, is exercised by the provider-based tests above. That is the evidence a `risk-high` change needs for a shared contract surface.

## Risks & Impact Review

- **Data integrity:** not applicable; nothing is written.
- **Cascading failures:** a failing override is contained to the avatar element by the registry's error boundary.
- **Tenant and data isolation:** the handles render data the page already loaded for the current user and fetch nothing themselves. Anything an override fetches goes through the app's own authenticated API calls and their scoping.
- **Migration and deployment:** none; the change is additive and ships with the package.
- **Operational:** failures show up as `Component replacement failed` or `Props schema validation failed for replacement` logs from `useRegisteredComponent`.

#### Override throws while rendering
- **Scenario**: An app's replacement or wrapper throws, for example on an unexpected `data` shape.
- **Severity**: Low
- **Affected area**: The avatar in one detail header.
- **Mitigation**: `useRegisteredComponent` renders replacements and wrappers inside `ReplacementErrorBoundary` with the default as fallback and logs the error.
- **Residual risk**: The user sees the default avatar; the header and page keep working.

#### Override fetches the image on every render
- **Scenario**: An override looks up the logo without caching, which costs a request per render and briefly shows the default.
- **Severity**: Low
- **Affected area**: Detail page performance.
- **Mitigation**: The handle docs recommend caching the lookup (for example React Query keyed by record id) and rendering `Original` while it loads. The default makes no requests.
- **Residual risk**: Owned by the app that registers the override.

#### Override changes the avatar footprint
- **Scenario**: A larger or differently shaped element shifts the heading and the actions.
- **Severity**: Low
- **Affected area**: Header layout on the two detail pages.
- **Mitigation**: The docs name the `size="xl"` footprint; `Avatar` with `src` keeps it.
- **Residual risk**: Visual only, owned by the app.

#### Props contract ties the handle to the detail response
- **Scenario**: Core later reshapes `CompanyOverview` / `PersonOverview`, for example by splitting the detail payload.
- **Severity**: Medium
- **Affected area**: Every override that reads `data`.
- **Mitigation**: The fields already fall under §7 (no removals from response schemas), and the handle props are listed as frozen in `BACKWARD_COMPATIBILITY.md`, so a reshape needs a bridge under the Deprecation Protocol.
- **Residual risk**: Accepted. Narrower props would force overrides to refetch data the header already holds.

#### Handle spelled differently in core and in an app
- **Scenario**: A typo in the handle string means the override never applies.
- **Severity**: Low
- **Affected area**: The app's avatar customisation.
- **Mitigation**: The spelling guard test in core; apps build the ID with `ComponentReplacementHandles.section(...)`. An unmatched override is inert, so the failure is visible in the UI (default avatar), not a crash.
- **Residual risk**: Owned by the app.

## Final Compliance Report — 2026-09-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root): Task Router row for component replacement, Design System rules
- `packages/ui/AGENTS.md`: Component Reuse; Component Replacement (UMES Phase H)
- `packages/core/AGENTS.md`: Component Replacement
- `packages/core/src/modules/customers/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`: §2, §3, §4, §6, §7

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| packages/ui/AGENTS.md | Replacement-aware hosts resolve via `useRegisteredComponent(handle, Fallback)` | Compliant | Host components in `DetailHeaderAvatar.tsx` |
| packages/ui/AGENTS.md | Expose stable handle IDs (`section:*`) | Compliant | Two `section:customers.*` IDs |
| packages/ui/AGENTS.md | Keep handle IDs stable and document them | Compliant | Module `AGENTS.md` section and `BACKWARD_COMPATIBILITY.md` entry |
| packages/core/AGENTS.md | Prefer wrapper/props modes; replacement preserves props compatibility | Compliant | The example uses a wrapper; the props contract is frozen and documented |
| BACKWARD_COMPATIBILITY.md §6 | MAY add new IDs; MUST NOT rename or remove | Compliant | Additive only |
| BACKWARD_COMPATIBILITY.md §2, §3, §4 | Additive exports and declarations only | Compliant | No existing export changes |
| BACKWARD_COMPATIBILITY.md §7 | No API URL or response change | Compliant | None |
| root AGENTS.md | i18n for user-facing strings | N/A | No new strings |
| root AGENTS.md | Design System primitives and tokens | Compliant | Defaults reuse `Avatar` and the `lucide-react` `Building2` icon unchanged |
| .ai/specs/AGENTS.md | `{date}-{title}.md`, no `SPEC-` prefix | Compliant | |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data models, no HTTP contracts |
| API contracts match UI/UX section | Pass | The new exports are exactly what the headers and overrides use |
| Risks cover all write operations | Pass | No writes |
| Commands defined for all mutations | Pass | No mutations |
| Cache strategy covers all read APIs | Pass | No new reads |

### Non-Compliant Items

None.

### Verdict

Fully compliant. Ready for implementation once maintainers agree on the handle IDs and props.

## Changelog

### 2026-09-28
- Initial specification for #6490.
