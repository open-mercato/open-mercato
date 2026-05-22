# Sidebar Customization — Move to Dedicated Settings Page

## TLDR

Refactor the sidebar customization UI from an in-place sidebar takeover (toggled by an internal `customizing` boolean and a `?customize=1` URL hack) into a regular auto-discovered settings page that renders its own content like every other entry in the settings menu. The customization editor becomes a self-contained component owned by the page, the AppShell stops hijacking the sidebar, and the entry appears in the settings nav through standard page-metadata auto-discovery instead of a hardcoded inject. Companion to [`2026-04-26-ds-sidebar-restyle.md`](2026-04-26-ds-sidebar-restyle.md). No new BC contract surfaces are introduced; the `?customize=1` URL trigger and the hardcoded "Customization" settings section added during the restyle PR are both reverted because they were unreleased internals.

## Overview

- **Phase 3 sub-track** (UX cleanup that lands together with or shortly after the sidebar restyle PR)
- **Branch:** `refactor/ds-sidebar-customization-page` (separate PR; can also be folded into the sidebar restyle PR if reviewer prefers a single change set)
- **Base:** `refactor/ds-foundation-v2` (same as the restyle PR)
- **Touched code:** `packages/ui/src/backend/AppShell.tsx`, new `packages/ui/src/backend/SidebarCustomizationEditor.tsx`, new backend page under `packages/core/src/modules/auth/backend/sidebar-customization/`, related route metadata, locale files
- **Not touched:** `/api/auth/sidebar/preferences` API contract, `SidebarCustomizationDraft` type, persistence model, RBAC features for the existing customize feature

## Problem Statement

The current implementation of "Customize sidebar" couples the editor to the AppShell shell:

1. AppShell owns all customization state (`customizing`, `customDraft`, `originalNavRef`, `availableRoleTargets`, `selectedRoleIds`, `canApplyToRoles`, `customizationError`, `loadingPreferences`, `savingPreferences`) plus the callbacks (`startCustomization`, `cancelCustomization`, `resetCustomization`, `saveCustomization`, `updateDraft`).
2. When `customizing === true`, AppShell's `renderSidebar` swaps the entire sidebar tree for an inline `customizationEditor` JSX block. The main page content underneath is unaffected, but the user loses the live-rendered nav while editing.
3. The entry point in the [restyle PR](2026-04-26-ds-sidebar-restyle.md) had to be hand-wired:
   - A `?customize=1` query-param effect in AppShell that calls `startCustomization()` and clears the param.
   - A hardcoded "Customization" section appended at render time inside `renderSectionSidebar`'s settings branch.
   - A defensive duplicate in `SettingsPageWrapper` for downstream apps using the wrapper directly.

This conflicts with how every other entry in the settings menu works. Existing settings pages are **regular auto-discovered backend pages** under `/backend/settings/...` with `page.meta.ts` declaring `pageContext: 'settings'`, `nav: { group, label }`, and `requireFeatures`. The shell discovers them through `buildSettingsSections` from `AdminNavItem[]`. The user's request is to make Customize sidebar behave the same: an entry in the settings menu, a real route, content rendered in the main pane.

The current shape has three concrete downsides:
- **Inconsistent navigation model.** Clicking the entry doesn't navigate to a URL; it flips a UI mode. Browser back, deep links, refreshing the page all behave differently from every other settings entry.
- **AppShell carries domain state.** AppShell is supposed to be a shell — chrome, breadcrumbs, nav, feature gating — not own a multi-state form for editing nav preferences. The state and callbacks add ~250 lines of unrelated logic.
- **Hardcoded settings injection.** Appending a section inside `renderSectionSidebar` bypasses the auto-discovery pipeline. New settings entries normally only require a page; this one needed three coordinated edits across two files.

## Proposed Solution

Replace the in-place takeover with a dedicated page. Three coordinated moves:

1. **Extract the editor.** Move the customization JSX + state + API calls out of AppShell into a self-contained `SidebarCustomizationEditor` component in `packages/ui/src/backend/`. The component owns its own draft, error, and save state. It reads `/api/auth/sidebar/preferences`, persists through the same API, and exposes a clean prop surface so the new page is a thin wrapper.
2. **Add a real backend page.** Create a page at `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx` (full URL: `/backend/sidebar-customization`, with `pageContext: 'settings'`). Its `page.meta.ts` declares the nav entry (`group: 'Customization'`, `label: 'Customize sidebar'`, `requireFeatures: ['auth.sidebar.customize']` or whatever ACL the existing button used). The page renders the extracted editor.
3. **Strip the hijack from AppShell.** Remove `customizing`, the customization state cluster, the URL `?customize=1` effect, the customize-related callbacks, the inline `customizationEditor` JSX, the hardcoded `Customization` section appended at render time, and the orphan `CustomizeIcon` const. Keep AppShell focused on chrome.

Side effect: the AppShell sidebar no longer "becomes" the editor. While the user is on the customize page, the AppShell sidebar shows the regular settings nav (with the Customize sidebar entry highlighted as the active item). The editor renders in the page's main pane. **The user does not see a live preview of the main nav being edited**, which is a UX trade-off discussed under [Risks](#risks--impact-review).

## Architecture

### Files added

| File | Purpose |
|---|---|
| `packages/ui/src/backend/SidebarCustomizationEditor.tsx` | Standalone editor component. Owns local state. Calls `/api/auth/sidebar/preferences` for load and save. Renders ordered groups + items with drag handles, label inputs, hide toggles, role apply targets, save/cancel/reset actions, error display. |
| `packages/core/src/modules/auth/backend/sidebar-customization/page.tsx` | Backend page. Server component or client wrapper that renders `<SidebarCustomizationEditor />`. |
| `packages/core/src/modules/auth/backend/sidebar-customization/page.meta.ts` | Route metadata: `pageContext: 'settings'`, `nav: { group, label, labelKey, order, icon }`, `requireFeatures`. |

### Files removed / shrunk

| File | Change |
|---|---|
| `packages/ui/src/backend/AppShell.tsx` | Drop ~250 lines: customize state hooks, `startCustomization`, `cancelCustomization`, `resetCustomization`, `saveCustomization`, `updateDraft`, the `?customize=1` `useEffect`, the inline `customizationEditor` JSX, the `effectiveCollapsed` short-circuit on `customizing`, the customizing-aware grid `lg:grid-cols-[320px_1fr]`, the hardcoded `Customization` section appended in `renderSectionSidebar`, the `CustomizeIcon` const if it was added solely for this. |
| `packages/ui/src/backend/settings/SettingsPageWrapper.tsx` | Drop the defensive duplicate Customization section + the `SidebarCustomizeIcon` const introduced for it. |
| Locale files (`en.json`, `pl.json`, `de.json`, `es.json`) in both `apps/mercato` and `packages/create-app/template` | Add new key `appShell.sidebarCustomizationGroup` (or reuse the already-shipped group key from the page metadata). Existing keys for the editor strings (`appShell.sidebarCustomizationHint`, `*Save`, `*Cancel`, `*Reset`, `*Loading`, etc.) remain — they are now consumed by the extracted component. |

### Component contract — `SidebarCustomizationEditor`

```typescript
type SidebarCustomizationEditorProps = {
  // Optional callback fired after a successful save. Page can use this for redirect / toast.
  onSaved?: () => void
  // Optional override for the API base URL (default '/api/auth/sidebar/preferences').
  apiPath?: string
}

export function SidebarCustomizationEditor(props: SidebarCustomizationEditorProps): JSX.Element
```

The component:
- Loads on mount via `apiCall` to `/api/auth/sidebar/preferences`.
- Builds a draft from the current sidebar groups (re-using `cloneGroups`, `applyCustomizationDraft`, `filterMainSidebarGroups` helpers — these stay where they are or move with the editor; the spec intentionally does not constrain that detail).
- Renders the same controls present today in the inline editor: group/item rows with drag handles, label inputs, hide checkboxes, role apply targets, save/cancel/reset buttons, error banner, hint text.
- Shows a loading skeleton while preferences are fetching.
- On save, calls the same API endpoint with the draft, surfaces validation errors as flash messages or inline banners.
- On cancel, navigates back (or fires `onSaved`/`onCanceled` callback so the page decides).

### Page contract — `/backend/sidebar-customization`

```typescript
// page.meta.ts
import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['auth.sidebar.customize'], // confirm exact feature ID during impl
  titleKey: 'appShell.customizeSidebar',
  title: 'Customize sidebar',
  pageContext: 'settings',
  nav: {
    group: 'Customization',
    groupKey: 'appShell.sidebarCustomizationGroup',
    label: 'Customize sidebar',
    labelKey: 'appShell.customizeSidebar',
    order: 9999,
    icon: 'Settings2', // or whichever lucide icon
  },
}

export default metadata
```

The page itself is minimal:

```tsx
'use client'
import { SidebarCustomizationEditor } from '@open-mercato/ui/backend/SidebarCustomizationEditor'
import { useRouter } from 'next/navigation'

export default function SidebarCustomizationPage() {
  const router = useRouter()
  return (
    <SidebarCustomizationEditor onSaved={() => router.push('/backend/settings')} />
  )
}
```

### Settings sidebar integration

After the page lands, the entry shows up automatically because `buildSettingsSections` walks `AdminNavItem[]` filtering by `pageContext === 'settings'`. The page metadata above declares that context plus a `nav` block. No code changes needed in `backendChrome.tsx`, `nav.ts`, `AppShell.tsx`, or `SettingsPageWrapper.tsx`.

### State that disappears from AppShell

| Symbol | Where it goes |
|---|---|
| `customizing`, `setCustomizing` | Removed entirely. |
| `customDraft`, `setCustomDraft` | Moves into editor component as local `useState`. |
| `originalNavRef` | Moves into editor component as `useRef`. |
| `loadingPreferences`, `savingPreferences`, `customizationError` | Move into editor. |
| `availableRoleTargets`, `selectedRoleIds`, `canApplyToRoles` | Move into editor. |
| `startCustomization`, `cancelCustomization`, `resetCustomization`, `saveCustomization`, `updateDraft`, `applyCustomizationDraft`, `filterMainSidebarGroups`, `cloneGroups` | Moved/inlined inside editor. The pure helpers (`applyCustomizationDraft` etc.) can stay in their current location and just be imported by the editor. |
| `effectiveCollapsed = customizing ? false : collapsed` | Becomes `effectiveCollapsed = collapsed`. |
| `expandedSidebarWidth = customizing ? '320px' : '240px'` | Becomes the constant `'240px'`. |
| Customization branch in `renderSidebar` (`{customizing ? customizationEditor : ...}`) | Removed. The branch always renders the regular nav. |
| URL `?customize=1` effect | Removed. |
| Hardcoded `Customization` section in `renderSectionSidebar` settings branch | Removed. |

## Data Models

No data model changes. The persistence layer (`/api/auth/sidebar/preferences`, `SidebarCustomizationDraft` shape, `SidebarRoleTarget`, the database tables behind it) is unchanged. This refactor is presentation-only.

## API Contracts

No API changes. `/api/auth/sidebar/preferences` GET/POST shape stays the same. The editor calls the same endpoints with the same payloads.

## Migration & Backward Compatibility

Analyzed against the 13 contract surfaces from [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):

| # | Surface | Impact | Notes |
|---|---|---|---|
| 1 | Auto-discovery file conventions | Additive | New `page.tsx` + `page.meta.ts` follow the standard convention. |
| 2 | Type definitions & interfaces | None | `SidebarCustomizationDraft`, `SidebarRoleTarget`, `AppShellProps` unchanged in their public-facing fields. AppShell internal state is private. |
| 3 | Function signatures | None | No exported function signatures change. |
| 4 | Import paths | Additive | New `@open-mercato/ui/backend/SidebarCustomizationEditor` export. No existing path moves. |
| 5 | Event IDs | None | No event changes. |
| 6 | Widget injection spot IDs | None | All five spots from the restyle PR remain rendered. |
| 7 | API route URLs | None | `/api/auth/sidebar/preferences` unchanged. New page URL `/backend/sidebar-customization` is additive. |
| 8 | Database schema | None | No DB changes. |
| 9 | DI service names | None | No DI changes. |
| 10 | ACL feature IDs | None | The page reuses the existing feature gate that the customize button required. |
| 11 | Notification type IDs | None | No notification changes. |
| 12 | CLI commands | None | No CLI changes. |
| 13 | Generated file contracts | Refresh | `yarn generate` re-emits `modules.generated.ts` with the new page route. Standard regeneration; no contract change. |

**Internals that go away (not public BC):**
- The `?customize=1` URL trigger added by the restyle PR. Never released or documented; pure internal hook.
- The hardcoded `Customization` section appended inside `renderSectionSidebar`'s settings branch. Same — internal to the restyle PR.
- The `customizing` boolean prop drilling and the inline editor JSX. Internal AppShell state.

If the restyle PR has not yet merged, these can be removed in the same change set without touching `RELEASE_NOTES.md`. If it has merged, the cleanup is still safe (nothing public referenced these internals) but should be called out in the customization-page PR description.

## Integration Test Coverage

### Existing tests touched

- `packages/ui/src/backend/__tests__/AppShell.test.tsx` — remove or rewrite any assertions that exercise `customizing`-related rendering paths. Add a smoke test that the AppShell sidebar never enters editor mode regardless of state, since that mode no longer exists.
- Any test that navigated to `?customize=1` (none in tree as of writing) needs updating to instead navigate to `/backend/sidebar-customization`.

### New tests required

- **Unit:** `SidebarCustomizationEditor.test.tsx` — render with mocked API, verify load/save/cancel flows, error states, role apply target rendering, drag-handle DOM presence (we don't validate full DnD interactions in unit tests; that lives in integration coverage). Place under `packages/ui/src/backend/__tests__/`.
- **Integration (Playwright):** New scenario `TC-AUTH-SIDEBAR-CUSTOMIZE.spec.ts` covering: open settings, navigate to Customize sidebar entry, verify page renders editor, modify a label, save, verify preference is persisted (API mock or reload assertion), reload page, verify modification still visible. Self-contained — creates its own admin fixture user, clears any preference rows in teardown.
- **Integration:** existing CRUD-based settings flows do not need updating; this is additive coverage.

### Test stability rules

- Use the canonical pattern for selectors (`data-menu-item-id` on the settings sidebar entry, label-scoped queries inside the editor).
- For Playwright `.fill()` on label inputs, follow the established pattern: `await expect(input).toHaveValue(value)` after each fill (memory entry [`feedback_ds_v2_input_fill_race.md`](../../../.claude/projects/-Users-merynos-Documents-GitHub-open-mercato/memory/feedback_ds_v2_input_fill_race.md)).
- The new page is gated by `requireFeatures`; the integration test must seed a role with that feature for the fixture user.

## Risks & Impact Review

| # | Risk | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | Loss of in-sidebar live preview | Medium | All admins customizing the sidebar | Editor component renders an explicit preview block — a static read-only render of the draft sidebar groups in the same visual style as the AppShell sidebar — so the user sees what their nav will look like without leaving the page. Implementation can reuse `applyCustomizationDraft` to build a preview tree and render it with the existing nav primitives. | Low |
| 2 | User can't easily access customization on touch / small screens where the settings nav is collapsed | Medium | Mobile / narrow viewports | Settings page already collapses its section nav on small screens; the entry is reachable through the same hamburger / drawer mechanism every other settings entry uses. No special-case work needed beyond what the settings shell already does. | Low |
| 3 | Removing the URL trigger breaks any external link or bookmark to `?customize=1` | Low | Anyone who bookmarked the URL during the restyle PR window | Add a thin redirect on AppShell: if `?customize=1` is present, `router.replace('/backend/sidebar-customization')`. Cheap one-time compat. After 1–2 minor versions the redirect can be removed. | None |
| 4 | The editor needs the actual nav groups (`navGroups`) which currently live in AppShell state | Medium | Editor implementation | Editor reads from the shared backend chrome payload (`useBackendChrome()` already exposes `groups`) instead of asking AppShell. The chrome provider is the source of truth for sidebar groups in the new world. | Low |
| 5 | Existing AppShell `__tests__/AppShell.test.tsx` may have customizing-mode assertions | Low | Test suite | Audit and update the test alongside the refactor. Already a known step in [Integration Test Coverage](#integration-test-coverage). | None |
| 6 | Generated route manifest (`modules.generated.ts`) needs regeneration when the new page lands | Low | Build pipeline | `yarn generate` is part of the predev/prebuild scripts; CI runs it. Local devs running `yarn dev` get it automatically. | None |
| 7 | `applyCustomizationDraft`, `filterMainSidebarGroups`, `cloneGroups` helpers currently live as static methods on `AppShell` | Low | Editor extraction | Move them out to `packages/ui/src/backend/sidebar/customization.ts` (or similar) as plain functions. Update both AppShell (or what's left of its references) and the editor to import from the new module. | None |
| 8 | Some downstream apps may import the editor-related helper names directly from AppShell | Low | Theoretical, no known consumer | Re-export the helper names from AppShell as deprecated for one minor version; the new module is the canonical home. Drop the deprecated aliases after the deprecation window. | None |
| 9 | The editor needs to know the user's available role targets to render the "apply to roles" block | Low | RBAC integration | The existing `/api/auth/sidebar/preferences` GET response already returns `roles` and `canApplyToRoles`. Editor consumes that as it does today. | None |
| 10 | Visual regression — the customization UI looks different on a page vs in the sidebar | Medium | UX | This is a deliberate design change. Page-level UI affords better spacing, more controls, and a real preview block. Capture before/after screenshots in the PR. The follow-up sub-track 3.C (visual regression tooling) will guard future drift. | Medium |

## Final Compliance Report

### DS rules ([`.ai/ds-rules.md`](../ds-rules.md))

- [x] Editor uses semantic tokens only — same `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border` palette as the rest of the restyled sidebar.
- [x] No raw `<button>` / `<input>` — uses primitives (`Button`, `IconButton`, `Input`, `Checkbox`).
- [x] No `dark:` overrides on semantic tokens.
- [x] No arbitrary value drift — sticks to the scale (`rounded-lg`, `px-3 py-2`, etc.).
- [x] Icons sourced from `lucide-react`.

### Component MVP compliance

No new primitive. `SidebarCustomizationEditor` is a composite that uses existing primitives (`Button`, `IconButton`, `Input`, `Checkbox`, `LoadingMessage`, `ErrorMessage`).

### BC compliance

See [Migration & Backward Compatibility](#migration--backward-compatibility). All 13 contract surfaces unaffected; the only changes are additive (new page + new export) and removals of unreleased internals.

### Code review compliance ([`.ai/skills/code-review/SKILL.md`](../skills/code-review/SKILL.md))

- [x] No new modules without `setup.ts` (no new modules — page lives inside `auth`).
- [x] No new entities (no DB changes).
- [x] All inputs validated with Zod where the editor calls API; existing API request shape is already validated server-side.
- [x] No `any` types in the new editor code.
- [x] DS Guardian rules respected — verified by `ds-health-check.sh` before/after.
- [x] Single-feature-per-commit discipline: extraction commit, page commit, AppShell shrink commit, locale commit, test commit. Optional: squash on merge.

### Generator regeneration

Required: `yarn generate` after adding the new page. The generator emits the new route into `apps/mercato/.mercato/generated/modules.generated.ts` and the new entry shows up in `buildSettingsSections` automatically.

---

## Addendum — Multi-Variant Management

> Added 2026-04-27 (afternoon). Scope expansion accepted by reviewer after the initial extraction landed locally and the editor was reskinned to "modern settings" layout (Option B). Treat this addendum as the architectural source of truth for everything related to per-role sidebar variants in this PR.

### Problem (addendum)

The persistence layer already supports per-role sidebar variants — `RoleSidebarPreference` (one row per `(role, tenant, locale)`) exists alongside `UserSidebarPreference`, and `sidebarPreferencesService.ts` exposes `loadRoleSidebarPreferences` / `saveRoleSidebarPreference` helpers. The HTTP API and UI, however, expose only a single one-way push: a user edits *their* preferences and may optionally apply that snapshot to a chosen set of roles via `applyToRoles[]` on `PUT /api/auth/sidebar/preferences`.

That model has three shortcomings the reviewer (the user adopting this feature) wants resolved as part of the extraction PR rather than punted to a follow-up:

1. **No way to see a role's variant.** An admin who needs to audit "what does the Editor role's sidebar actually look like?" has no way to load it. The GET endpoint only returns the calling user's effective settings.
2. **No way to edit a role variant directly.** The only path to populate a role variant is "edit my own prefs, then push". An admin may not want their personal layout to match the role's intended layout.
3. **No way to delete a role variant.** Once a role has a `RoleSidebarPreference` row, there is no exposed flow to revert it to the application defaults.

The data layer already supports all three operations — the gap is presentation + a thin API surface.

### Data Models (addendum)

**No schema changes.** The existing entity layout is sufficient:

- `UserSidebarPreference` — one row per `(user, tenant, locale)`. Owns a user's personal override.
- `RoleSidebarPreference` — one row per `(role, tenant, locale)`. Owns a role's variant. Multiple rows = multiple variants.

The "default" (no override) is the implicit absence of a row, computed at render time by AppShell's nav builder from the application's source-of-truth groups.

### API Contracts (addendum)

The single existing route `app/api/auth/sidebar/preferences/route.ts` is extended with three additive behaviors. No new files are introduced; the extensions live alongside the current GET/PUT exports.

#### GET — read a specific scope

| Query | Behavior | Auth |
|---|---|---|
| *(none)* | Existing behavior. Returns the calling user's effective personal settings + `roles[]` summary (each entry annotated `hasPreference: boolean`) + `canApplyToRoles`. | `requireAuth` |
| `?roleId=<uuid>` | New. Returns the named role's variant in the same response shape (`settings` populated from the `RoleSidebarPreference` row, or app defaults if the row does not exist). The `roles[]` summary is still returned so the editor can render the variant switcher without a second round-trip. | `requireAuth` + `auth.sidebar.manage` feature |

The response schema (`sidebarPreferencesResponseSchema`) gains an optional `scope: { type: 'user' } | { type: 'role', roleId: string }` discriminator so the client knows which scope it just fetched. The `settings` shape itself is unchanged.

#### PUT — write to a specific scope

The body schema gains an optional discriminator at the top level:

```typescript
const sidebarPreferencesInputSchema = z.object({
  // …existing settings fields (groupOrder, groupLabels, itemLabels, hiddenItems)
  scope: z
    .union([
      z.object({ type: z.literal('user') }),
      z.object({ type: z.literal('role'), roleId: z.string().uuid() }),
    ])
    .optional()
    .default({ type: 'user' }),
  // applyToRoles[] / clearRoleIds[] are still accepted ONLY when scope.type === 'user'
  // (see UX section below for why the secondary "copy to roles" action stays user-scoped)
})
```

When `scope.type === 'role'`:
- Required feature: `auth.sidebar.manage`
- Behavior: `saveRoleSidebarPreference` is called for the named role; `UserSidebarPreference` is **not** touched.
- `applyToRoles[]` / `clearRoleIds[]` payload is rejected with HTTP 400 (`"applyToRoles is only valid when scope.type === 'user'"`). This keeps the secondary "copy" semantics unambiguous.
- Response: same shape as GET, with `scope.type === 'role'` echoed back so the client confirms the write target.

When `scope.type === 'user'` (or omitted): existing behavior, including optional `applyToRoles[]` push.

#### DELETE — remove a role variant

New method on the same route. Required because the editor needs an explicit "delete this role variant" affordance and we don't want to overload PUT with a magic payload.

| Query | Behavior | Auth |
|---|---|---|
| `?roleId=<uuid>` | Removes the `RoleSidebarPreference` row for that role + current tenant + current locale. Idempotent — a 200 OK is returned even if no row existed. Cache tags `nav:sidebar:role:<roleId>` are invalidated. | `requireAuth` + `auth.sidebar.manage` feature |
| *(none)* | 400. We deliberately do not expose "delete my personal preference" via this method because the editor expresses that as "save with empty draft" through the existing PUT. Keeps the API surface minimal. |

Response: `{ ok: true, scope: { type: 'role', roleId } }`.

#### OpenAPI doc

The existing `openApi` export in the route file is extended with the new query param + DELETE definition. Standard `createPagedListResponseSchema` not applicable — this is a single-resource endpoint with scope discriminator.

### UI / UX (addendum)

The editor gains a **variant switcher** and an explicit **delete-variant affordance** when the active scope is a role. The "copy this draft to other roles" secondary action stays exactly as it is today — reachable from the user-scope only — because that is the legitimate fast-path for "make my admins all look like me".

#### Variant switcher

A `Select` primitive (or styled dropdown — implementation choice) sits at the very top of the editor, above the page header. Anchor for the rest of the page; everything below reflects the selected scope.

```
┌─ Editing variant ────────────────────────────┐
│ [ My preferences ▾ ]                         │
└──────────────────────────────────────────────┘
```

Items in the dropdown:
- **My preferences** — always present. Selected by default on page mount.
- **Roles** group, listing every role visible to the user (same set as today's `roles[]` payload). Each row shows:
  - Role name
  - A subtle "(custom)" tag when `hasPreference === true`, none when not. Use the `Tag` primitive's `neutral` variant.
- **Trailing action**: clicking the variant in the dropdown switches scope; an inline "Delete variant" button (visible only when the active scope is a role with `hasPreference === true`) lives next to the switcher, not inside the dropdown menu, to avoid accidental destructive clicks while browsing variants.

When the switcher loads a role variant for the first time during a session (and the response indicates `hasPreference === false`), the editor surfaces an explanatory inline note: "This role does not have a custom variant yet. Editing here will create one." The user can still edit and save — that's how new role variants are minted.

#### Editor state changes

```typescript
type EditingScope =
  | { type: 'user' }
  | { type: 'role'; roleId: string; roleName: string; hasPreference: boolean }
```

State machine for `editingScope`:
- Mount → `{ type: 'user' }`. Fetch GET (no query). Populate draft + roles list.
- User picks a role from switcher → `{ type: 'role', roleId, roleName, hasPreference }`. Fetch GET `?roleId=…`. Populate draft from response.
- Save with `scope.type === 'role'` → on success, set `hasPreference = true` for that role in the local roles cache (the GET response refreshes it anyway).
- Delete role variant → on success, set `hasPreference = false` for that role in the cache + switch back to `{ type: 'user' }` (default). The role variant is gone; staying on it would show defaults.
- Switching scope while the current draft is dirty → show a `ConfirmDialog` ("You have unsaved changes for {scope label}. Discard and switch?"). MUST use shared `ConfirmDialog` per `packages/ui/AGENTS.md` — never `window.confirm`.

The `Reset` button retains its existing meaning: revert the draft for the active scope to the response that was loaded when the scope last changed (no API call).

#### Apply-to-roles (secondary action) — kept

Still rendered, **only when `scope.type === 'user'`**, in the same Card it lives in today (between the page header and the order/visibility card). When the active scope is a role, the entire "Apply to roles" card is hidden — that path doesn't make sense from a role variant.

This preserves the one-click "make all my admins match me" flow that is the common case while letting power users carve out per-role variants when they want one.

### Risks & Impact Review (addendum)

| # | Risk | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 11 | An admin overwrites a role variant accidentally while exploring the switcher | Medium | Roles with existing `RoleSidebarPreference` rows | Confirm dialog when switching with dirty draft (above). Save button remains explicit (no auto-save). Audit log entry on every role-scope save (existing infra) — recoverable. | Low |
| 12 | DELETE is destructive | Medium | Role variants | Confirm dialog (`useConfirmDialog`) on the "Delete variant" affordance. Operation is idempotent server-side, so retry is safe. No DB cascade — only the `RoleSidebarPreference` row is removed. | Low |
| 13 | Scope discriminator drift between GET and PUT | Low | API consumers | Both endpoints use the same Zod-derived shape (`scope: 'user' \| 'role'`); the client sets it from a single `editingScope` source of truth. Server validates on every write. | Low |
| 14 | Existing API consumers (none known outside this editor) break when the response gains an `optional` `scope` field | Low | Hypothetical downstream client | Field is optional and absent on the legacy "no roleId" GET path. No existing client reads it. Additive change only. | None |
| 15 | A tenant-scoped role gets edited from a global tenant context (cross-tenant leak) | High if mishandled, Low because it's gated | Multi-tenant deployments | The route already loads `tenantId` from auth and constrains the role lookup to `{ $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }`. The new `?roleId` path validates the role belongs to that scope before touching prefs (404 otherwise). RBAC feature `auth.sidebar.manage` is also tenant-scoped. | None |
| 16 | Cache invalidation misses for role variants | Medium | Sidebar nav cache (`nav:sidebar:role:<roleId>`) | Both the new PUT-with-scope and DELETE paths reuse the existing tag-based invalidation already in place for the apply-to-roles flow. No new cache logic needed. | Low |

### Test Coverage (addendum)

- **Unit (`SidebarCustomizationEditor.test.tsx`):**
  - Switcher renders all roles when `canApplyToRoles === true`; renders "My preferences" only otherwise.
  - Switching to a role triggers a GET with the right `roleId`.
  - Saving with role scope sends `scope: { type: 'role', roleId }` in the PUT body.
  - Switching scope with a dirty draft prompts the confirm dialog and aborts when the user cancels.
  - The "Apply to roles" card is hidden when scope is a role.
  - "Delete variant" calls DELETE and switches back to user scope on success.
- **API route tests** (new — under `packages/core/src/modules/auth/api/sidebar/preferences/__tests__/`):
  - GET `?roleId=…` returns 403 without `auth.sidebar.manage`, 404 for cross-tenant role, 200 with the role's settings otherwise.
  - PUT with `scope.type === 'role'` requires the feature; 400 if `applyToRoles` is provided.
  - DELETE `?roleId=…` is idempotent; 404 for cross-tenant role; cache tags invalidated on success.
- **Integration (Playwright)** — extends `TC-AUTH-SIDEBAR-CUSTOMIZE.spec.ts`:
  - Seed admin fixture with a second role.
  - Navigate to `/backend/sidebar-customization`.
  - Switch to second role → modify a label → save → reload → confirm role variant persists (separate from personal).
  - Delete role variant → reload → confirm role row no longer has `(custom)` tag.

### BC compliance (addendum)

Re-running the 13-surface analysis with this addendum applied:

| # | Surface | Impact (extraction only) | Impact (with addendum) |
|---|---|---|---|
| 1 | Auto-discovery file conventions | Additive | Additive |
| 2 | Type definitions & interfaces | None | Additive (`scope` field optional) |
| 3 | Function signatures | None | Additive (Zod schema gains optional discriminator; service signatures unchanged) |
| 4 | Import paths | Additive | Additive |
| 5 | Event IDs | None | None |
| 6 | Widget injection spot IDs | None | None |
| 7 | API route URLs | None | Same URL, additive query params + new DELETE method |
| 8 | Database schema | None | None |
| 9 | DI service names | None | None |
| 10 | ACL feature IDs | None | None — reuses existing `auth.sidebar.manage` |
| 11 | Notification type IDs | None | None |
| 12 | CLI commands | None | None |
| 13 | Generated file contracts | Refresh | Refresh |

All additions are optional or method-additive. No existing client breaks.

### Implementation order (addendum)

The work splits into three commits inside the same PR. Land in order; each commit compiles + tests pass on its own:

1. **API extension** — Zod schema adds `scope` discriminator; GET handles `?roleId`; PUT handles scope routing; new DELETE handler; route tests.
2. **Editor variant switcher** — `editingScope` state, switcher UI, scope-aware fetch/save, confirm dialog on dirty switch, "Delete variant" button, hide "Apply to roles" card when scope is a role.
3. **Polish** — locale keys for new strings (variant switcher labels, dirty-switch confirm copy, delete-confirm copy, "no custom variant" hint) + unit + integration test additions.

### Generator regeneration (addendum)

Same as the base extraction — no additional generator runs required. The new DELETE method on the existing route file is picked up automatically by the OpenAPI bundle via `yarn generate`.

### Out of scope — Icon customization (deferred to follow-up)

Allowing users to override the icon attached to each group / nav item (e.g. user wants a heart icon for "Customer Care" instead of the module-shipped headphones) was discussed during this iteration and explicitly **deferred to a separate companion spec** for the following reasons:

1. **Picker UX is its own mini-feature.** A useful icon picker needs search, category grouping, recently-used, keyboard navigation, and accessibility — that's a dedicated UI work item, not a bolt-on.
2. **DS Guardian decision required.** The picker can either expose all of `lucide-react` (~1500 icons, conflicts with DS conventions for module icon choices) or only the curated subset already in `lucideRegistry.generated.tsx`. That choice belongs in its own spec with design review.
3. **Storage shape is additive but non-trivial.** New `groupIcons: Record<string, string>` and `itemIcons: Record<string, string>` fields on `SidebarCustomizationDraft`, new Zod validation that the icon name is a known lucide entry, render-path lookup with fallback to the module-shipped icon. Each is small, but together they expand the multi-variant API contract that this spec just defined.
4. **Multi-variant first.** Per-role icon variants only make sense once per-role label variants are stable in production. Land multi-variant management; if usage validates the per-role model, icon customization joins it.

When picked up, the follow-up will live at `.ai/specs/{date}-ds-sidebar-icon-customization.md` and will reuse: the `EditingScope` machine from this spec's addendum, the same `auth.sidebar.manage` ACL feature, the existing `RoleSidebarPreference` table (still no schema change — settings is a JSON column), and the same render-time fallback semantics that already apply to label overrides ("user override persists if the module updates its choice").

## Changelog

- **2026-04-27** — Initial draft. Extraction approach, page contract, AppShell cleanup list, BC analysis, risk #1 (loss of live preview) addressed by an explicit preview block inside the editor.
- **2026-04-27 (afternoon)** — Implementation of the extraction phase landed locally on `refactor/ds-sidebar-restyle` (helpers, editor, page, AppShell strip, SettingsPageWrapper strip — all green: typecheck, 347/347 tests, full package build). Editor was reskinned from in-sidebar layout to "modern settings page" layout (Option B): page header + Cards + sticky preview pane + `Switch` toggles + `Input` primitive + loading skeleton.
- **2026-04-27 (addendum)** — Multi-variant management appended: API extension (`?roleId` on GET, `scope` discriminator on PUT, new DELETE), editor variant switcher with dirty-state confirm, "Delete variant" affordance, kept "Apply to roles" as user-scope secondary action. No DB or new ACL feature; reuses `RoleSidebarPreference` + `auth.sidebar.manage`.
- **2026-04-27 (deferral)** — Multi-variant implementation **deferred to a follow-up PR** per reviewer decision. Current PR ships only the extraction + UX polish (reset-to-default per field, "Hidden" badge, "Default: {original}" hint when modified). Addendum stays in this spec as the design source of truth for the follow-up; implementation order from the addendum (API → switcher → polish) carries over verbatim. Icon customization remains deferred to its own future spec as documented above.
- **2026-04-27 (re-scoped — multi-variant in current PR)** — Reviewer reversed the deferral and asked to ship multi-variant in the current PR (icons stay deferred). All three implementation phases landed locally on `refactor/ds-sidebar-restyle`: (Step A) API route — `?roleId` on GET, `scope` discriminator on PUT (rejecting `applyToRoles`/`clearRoleIds` when role-scoped), new DELETE method, cross-tenant guard via `findRoleInScope`, OpenAPI updated; (Step B) editor — `EditingScope` discriminated union state, variant `Select` switcher, `useConfirmDialog` for dirty-state switch and destructive variant deletion, `Trash2` "Delete variant" inline button when role scope has an existing preference, "Apply to roles" Card hidden in role scope, dirty tracking gates Save and the switch confirm; (Step C) i18n — 13 new keys (`appShell.sidebarCustomization{Default,DeleteVariant*,Group,HiddenBadge,OrderHeading,OrderDescription,Preview,ResetField,Scope*,SwitchConfirm*,VariantLabel}`) with EN + PL translations, German + Spanish + create-app template locales not yet synced (TBD via standard i18n process). Validation: typecheck UI + core clean, 347/347 UI tests passing, 3241/3241 core tests passing, full package build OK, `yarn generate` re-emits OpenAPI bundle with new DELETE method. Bug fix included: editor previously raced the BackendChromeProvider payload (mounted with empty groups, never re-loaded); now guarded by `hasInitializedRef` + `sourceGroups.length` dep so the load fires once when chrome data arrives.
