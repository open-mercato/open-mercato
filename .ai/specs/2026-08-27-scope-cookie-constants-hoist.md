# Scope Cookie Constants Hoist

## TL;DR

The organization-selection cookie names (`om_selected_org`, `om_selected_tenant`), the
all-organizations sentinel (`__all__`) and the parsing of those cookies move into
`@open-mercato/shared/lib/scope/cookies`. `@open-mercato/core`'s
`modules/directory/constants` and `modules/directory/utils/scopeCookies` become
re-export bridges, so **no existing import path, export name or value changes**. Nothing
observable changes at runtime; the point is that four independent copies of these values
become one, and the two independently written parsers become one implementation with a
written-down blank-value semantic.

Follow-up to [#5690](https://github.com/open-mercato/open-mercato/pull/5690), raised in
its review and filed as [#5713](https://github.com/open-mercato/open-mercato/issues/5713).
It is a separate PR at the maintainer's request, because it touches a surface listed in
[`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) §4 (Import Paths).

## Overview

- **Added**: `packages/shared/src/lib/scope/cookies.ts`
- **Bridged (re-export only)**: `packages/core/src/modules/directory/constants.ts`,
  `packages/core/src/modules/directory/utils/scopeCookies.ts`
- **Copies removed**: `packages/shared/src/lib/auth/server.ts` (all three values, plus its
  private `readCookieFromHeader` / `decodeCookieValue`),
  `packages/shared/src/lib/crud/factory.ts` (`SELECTED_ORG_COOKIE`),
  `packages/core/src/modules/directory/utils/organizationScope.ts` (two inlined cookie-name
  literals)
- **Not touched**: `resolveOrganizationScopeForRequest` and everything downstream of it,
  `applySuperAdminScope`'s decision table, the `create-app` starter's
  `OrganizationSwitcher` (see *Deliberately out of scope*), every consumer's import path

## Problem Statement

`@open-mercato/shared` must not depend on `@open-mercato/core`, and the cookie names and
sentinel lived in `core`'s `modules/directory/constants`. So `shared` inlined them: all
three in `lib/auth/server.ts`, and `SELECTED_ORG_COOKIE` again in `lib/crud/factory.ts`.
`core`'s own `modules/directory/utils/organizationScope.ts` inlined the two names a third
time rather than importing its sibling constants. #5690 was about to add a fourth copy in
`lib/frontend/organizationEvents.ts`.

Reading them had diverged too, and that is the part with teeth. `parseSelectedOrganizationCookie`
maps a blank cookie value to `null` — "no selection" — while `readScopeCookie` in #5690's
`organizationEvents.ts` returns `''`, which its seed maps to `organizationId: null` — "all
organizations". The resolver treats those differently: "no selection" falls back to the
caller's own organization, "all organizations" does not.

No wrong result is reachable today. The switcher writes the `__all__` sentinel rather than
a blank organization cookie, and `applySuperAdminScope` reads blank as all-organizations
too, so the client seed and the server agree in practice. The defect being fixed is the
shape, not an outcome: four copies of a wire format, and two readings of it that nothing
forces to agree.

## The Contract

```typescript
export const SELECTED_ORGANIZATION_COOKIE = 'om_selected_org'
export const SELECTED_TENANT_COOKIE = 'om_selected_tenant'
export const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'

export type ScopeCookieName =
  | typeof SELECTED_ORGANIZATION_COOKIE
  | typeof SELECTED_TENANT_COOKIE

export function isAllOrganizationsSelection(value: string | null | undefined): boolean

// Lossless: `undefined` for an absent cookie, `''` for a present blank one.
export function readScopeCookieRaw(header: string | null | undefined, name: ScopeCookieName): string | undefined
export function decodeScopeCookieValue(raw: string | undefined): string | null

// The documented selection semantic.
export function parseScopeSelectionCookie(header: string | null | undefined, name: ScopeCookieName): string | null
export function parseSelectedOrganizationCookie(header: string | null | undefined): string | null
export function parseSelectedTenantCookie(header: string | null | undefined): string | null
```

`lib/scope/cookies.ts` is pure string handling with no imports, so it is safe in a browser
bundle, in a server component and in a worker alike. `@open-mercato/shared`'s wildcard
`exports` entries already resolve `./lib/scope/cookies`; no `package.json` change is needed.

### The blank-value semantic, chosen deliberately

**A selection cookie that is present but blank means "no selection", exactly as if it were
absent.** `parseScopeSelectionCookie` and its two wrappers return `null` for both.

Why this one rather than "all organizations":

- The all-organizations *choice* has its own sentinel. Nothing writes a blank value to
  express it, so a blank cookie is the residue of a selection being cleared, not a
  statement about scope.
- Reading it as "all organizations" lets a cleared cookie silently widen scope. Reading it
  as "no selection" falls back to the caller's own organization — the conservative
  direction, and what the server-side resolver has always done.
- It is the semantic the two functions being merged into this module already had, so
  adopting it changes no behaviour.

### The one caller that must still tell blank from absent

`applySuperAdminScope` in `lib/auth/server.ts` reports a blank organization cookie as an
**applied** override meaning "all organizations", and a **missing** cookie as no override
at all. Those produce different auth contexts, so the distinction is real and is kept
available through `readScopeCookieRaw` rather than hidden. This is not a second semantic
competing with the one above: it is the raw read, from which the selection semantic is
derived, and the module says so at the top of the file and at that call site.

Prior to this change nothing tested that difference — the mutation "make the reader return
`undefined` for a blank cookie" left the whole existing `lib/auth/__tests__/server.test.ts`
green. Two cases were added there to close it.

## Migration & Backward Compatibility

**Nothing to migrate.** No import path, export name, export value, function signature or
runtime behaviour changes for any consumer, inside the monorepo or out.

- `@open-mercato/core/modules/directory/constants` keeps exporting
  `ALL_ORGANIZATIONS_COOKIE_VALUE` and `isAllOrganizationsSelection` — now as re-exports of
  the same bindings, additionally exporting `SELECTED_ORGANIZATION_COOKIE` and
  `SELECTED_TENANT_COOKIE`, which had no canonical home before. Additive; no removal.
- `@open-mercato/core/modules/directory/utils/scopeCookies` keeps exporting
  `parseSelectedOrganizationCookie` and `parseSelectedTenantCookie`, and
  `modules/directory/utils/organizationScope` keeps re-exporting both.
- No `@deprecated` annotation is applied to those paths. They remain the documented way for
  a domain module to reach these values; the bridge is not a staging step towards removing
  them, and BACKWARD_COMPATIBILITY.md §4's re-export requirement is satisfied permanently
  rather than for one minor version. If they are ever to be retired, that is a separate
  change following the deprecation protocol in full.
- Three test files `jest.mock(...)` the `constants` path wholesale. A pure re-export module
  mocks identically; they were run unchanged.
- No `UPGRADE_NOTES.md` entry: nothing is deprecated and nothing is removed.

## Deliberately out of scope

- **`packages/create-app/template/src/components/OrganizationSwitcher.tsx`** still has its
  own `readSelectedOrganizationCookie` / `readSelectedTenantCookie`. They return a richer
  `{ value, hasCookie, raw }` shape with its own `__all__` folding, so collapsing them onto
  the shared reader is a behaviour-preserving rewrite of starter-template code with its own
  tests — a different review from a contract-surface bridge. It already imports
  `ALL_ORGANIZATIONS_COOKIE_VALUE` from `core`, so it carries no constant duplication.
- **`lib/frontend/organizationEvents.ts`** is not on `develop`; its copy arrives with
  #5690. Switching it over is a two-line follow-up on that branch and does not conflict
  with this one. It must use `readScopeCookieRaw`/`decodeScopeCookieValue`, not the
  selection parsers: its seed bails out when a cookie is absent but seeds
  `organizationId: null` when one is blank, so it is the second legitimate caller of the
  lossless pair.
- **`shared`'s remaining dependency on `core`.** `lib/crud/factory.ts` imports
  `resolveOrganizationScopeForRequest` from `@open-mercato/core/modules/directory/utils/organizationScope`,
  so the "shared must not depend on core" rule is already bent for behaviour. This change
  does not resolve that; it only stops the *leaf values* from being copied because of it.

## Testing

- `packages/shared/src/lib/scope/__tests__/cookies.test.ts` — 17 cases: the wire values,
  absent vs blank in the raw reader, the sentinel passing through the parser untouched, the
  documented blank semantic, no trimming, malformed-encoding fallback, and a case asserting
  the raw reader and the parser are related but not interchangeable.
- `packages/core/src/modules/directory/utils/__tests__/scopeCookies.test.ts` — 17 cases
  pinning the bridge from the consumer's side: same values, identical bindings (not second
  copies), the `organizationScope` re-export, and the parsers' full pre-move behaviour table.
- `packages/shared/src/lib/auth/__tests__/server.test.ts` — two added cases for the blank
  vs missing organization cookie.
- Non-vacuous: undoing the bridge fails 1 core case; flipping the blank semantic fails 3
  shared and 2 core cases; collapsing absent/blank in the raw reader fails 2 shared cases
  and 1 of the new `server.test.ts` cases.
