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
  literals), `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` and its byte-identical
  `create-app` template mirror (one `om_selected_org` literal read from the Next.js cookie
  store; mirrored per the root `AGENTS.md` template-sync rule)
- **Not touched**: `resolveOrganizationScopeForRequest` and everything downstream of it,
  `applySuperAdminScope`'s decision table, both `OrganizationSwitcher` components (see
  *Deliberately out of scope*), every consumer's import path

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

- **`apps/mercato/src/components/OrganizationSwitcher.tsx` and its byte-identical
  `packages/create-app/template/src/components/OrganizationSwitcher.tsx` mirror** still have
  their own `readSelectedOrganizationCookie` / `readSelectedTenantCookie`. Both files inline
  the two cookie names across seven lines — `om_selected_org` at 77, 78 and 181,
  `om_selected_tenant` at 107, 108, 155 and 165 — and they import
  `ALL_ORGANIZATIONS_COOKIE_VALUE` from `core`, so the *sentinel* is not duplicated, but both
  *names* are, in the one component that **writes** the wire format everything else reads.
  Collapsing them is deferred not because there is nothing to collapse but because the readers
  return a richer `{ value, hasCookie, raw }` shape with its own `__all__` folding: replacing
  them is a behaviour-preserving rewrite of a client component with its own tests, a different
  review from a contract-surface bridge, and it is the highest-value remaining follow-up.
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

## Risks & Impact Review

### Data Integrity / Cascading / Tenant / Migration / Operational

- **No runtime behaviour changes.** Every moved function reproduces its predecessor term for
  term; the bridges re-export the same bindings. No entity, migration, API route, response
  shape, event name or DI key is touched.
- **Blast radius if the new module were wrong:** wide but shallow — organization/tenant scope
  resolution runs on every authenticated backend request. That is precisely why the change is
  a mechanical move plus tests that pin the wire values, and why the two semantics are written
  down at the module rather than left implicit.
- **No migration, no config, no ops step.** `packages/shared`'s existing `./*/*/*` export
  wildcard already resolves `./lib/scope/cookies`; nothing to add to a deploy.

### Risk Register

#### A caller reaches for the selection parser where the lossless pair is required

- **Scenario**: `applySuperAdminScope` needs `om_selected_org=` (present and blank) to stay
  distinct from an absent cookie — blank is an *applied* "all organizations" override, absent
  is *no override at all*. `parseScopeSelectionCookie` deliberately collapses blank into
  `null`. A future contributor tidying up "two functions that look the same" onto the parser
  would silently turn an applied all-organizations override into no override, widening or
  narrowing the effective scope of a superadmin request.
- **Severity**: High if it happened; Low likelihood.
- **Affected area**: `packages/shared/src/lib/auth/server.ts` → `applySuperAdminScope`, and any
  future caller of the raw pair (`lib/frontend/organizationEvents.ts` on #5690 is the second).
- **Mitigation**: the asymmetry is documented in three places — the module header (which names
  `lib/auth/server.ts` as the one legitimate caller and tells everyone else to prefer the
  parsers), this spec, and a comment in the guarding test naming `applySuperAdminScope`;
  `cookies.test.ts` closes with a case asserting the raw reader and the selection parser agree
  on a real value and diverge only on a blank one, so the tidy-up fails a test that explains
  itself; two cases were added to
  `lib/auth/__tests__/server.test.ts`, which was green before this change even when the reader
  was mutated to collapse blank into absent.
- **Residual risk**: Low — a contributor who deletes the guarding test as "redundant" defeats
  it, which is the normal residual risk of any test-enforced invariant.

#### Something starts writing a blank organization cookie

- **Scenario**: the spec's claim that "no wrong result is reachable today" rests on the fact
  that `OrganizationSwitcher` writes the `__all__` sentinel, never a blank organization
  cookie. If any future writer emits `om_selected_org=`, the client seed (blank → "all
  organizations") and the selection parser (blank → "no selection", falling back to the
  caller's own organization) disagree, and a user could see a scope they did not select.
- **Severity**: Medium.
- **Affected area**: both `OrganizationSwitcher` components (the only writers), the client seed
  arriving with #5690, and `resolveOrganizationScopeForRequest` downstream.
- **Mitigation**: the blank-value semantic is now written down once and tested, instead of
  being an accident of two independent implementations; the writers are named in
  *Deliberately out of scope* so the next person can find them.
- **Residual risk**: Medium and pre-existing — this change makes the divergence legible and
  testable but does not remove it. Removing it means collapsing the two `OrganizationSwitcher`
  readers onto the shared module, which is the deferred follow-up named above.

#### `shared` still depends on `core` for behaviour

- **Scenario**: `packages/shared/src/lib/crud/factory.ts` imports
  `resolveOrganizationScopeForRequest` from `@open-mercato/core/modules/directory/utils/organizationScope`,
  so the "shared must not depend on core" rule stays bent. A reader could take this spec's
  framing — *the leaf values now live in `shared`* — as a claim that the dependency is gone.
- **Severity**: Low (documentation/expectation, not runtime).
- **Affected area**: `packages/shared/src/lib/crud/factory.ts`.
- **Mitigation**: stated explicitly in *Deliberately out of scope*; this change removes the
  *value* duplication that the dependency caused, not the dependency.
- **Residual risk**: Low and unchanged from before this PR.

#### Partial `jest.mock` factories on the bridged path

- **Scenario**: three `auth/lib/__tests__/backendChrome.*.test.ts` files `jest.mock` the
  `directory/constants` path with a factory supplying only `isAllOrganizationsSelection`.
  Because `organizationScope.ts` now imports the two cookie names from that same mocked path,
  those constants read as `undefined` inside those suites.
- **Severity**: Low — latent, not active.
- **Affected area**: the three `backendChrome` suites.
- **Mitigation**: harmless today because all three also mock `organizationScope` wholesale, so
  the getters never run; core's suite is green.
- **Residual risk**: Low — a trap for whoever removes the `organizationScope` mock. Widening
  those factories is a Boy-Scout fix for whenever those files are next touched.

## Final Compliance Report — 2026-08-28

### AGENTS.md Files Reviewed

- Root `AGENTS.md` (contract surfaces, template-sync rule, code-quality rules)
- `packages/shared/AGENTS.md` (library directory, import strategy)
- `packages/core/AGENTS.md` (module boundaries)
- `.ai/specs/AGENTS.md` (spec content checklist)
- `BACKWARD_COMPATIBILITY.md` §4 (Import Paths)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | N/A | No entities touched |
| root AGENTS.md | Never edit generated files by hand | Compliant | None touched |
| root AGENTS.md | Editing `apps/mercato/src/app/**` MUST mirror into the create-app template in the same task | Compliant | `[...slug]/page.tsx` and its template mirror changed together; files verified byte-identical |
| root AGENTS.md | No `any`, no one-letter names, no inline comments on untouched code | Compliant | One import plus one identifier substituted |
| root AGENTS.md | Prefer package-level imports over deep relative paths | Compliant | `@open-mercato/shared/lib/scope/cookies` everywhere |
| packages/shared/AGENTS.md | Library directory documents the routing surface | Compliant | `scope/` row added |
| BACKWARD_COMPATIBILITY.md §4 | A moved implementation keeps its old import path working | Compliant | Both `core` paths are permanent re-export bridges; no export removed or renamed |
| BACKWARD_COMPATIBILITY.md §4 | `@deprecated` on a re-exported old path | Deviation, declared | See *Migration & Backward Compatibility*: these paths are not being retired, so the annotation would be false. Matches existing practice (`inbox_ops/lib/htmlToPlainText.ts`, `planner/api/helpers.ts`, `registry.ts`'s `resolvePageRouteMetadata`). Raised for the record at the maintainer's request |
| .ai/specs/AGENTS.md | Risks & Impact Review, Final Compliance Report, Changelog | Compliant | Added in this revision |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Every remaining copy of the wire format is named | Pass | Repository-wide sweep for both literals outside tests and fixtures leaves only the two `OrganizationSwitcher` files, both named |
| Spec claims match the code | Pass | The "carries no constant duplication" claim about the template switcher was inaccurate and is corrected |
| Risks cover all write operations | Pass | No writes; the write *of the cookie itself* is covered by the blank-cookie risk |
| Tests are non-vacuous | Pass | Mutation claims listed under *Testing* |

### Non-Compliant Items

None. One declared deviation (`@deprecated`), reasoned above and awaiting a maintainer's
note on the record.

## Changelog

### 2026-08-28

- Addressed review feedback on [#5715](https://github.com/open-mercato/open-mercato/pull/5715).
- Collapsed the remaining plain `om_selected_org` literal in
  `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx` onto
  `SELECTED_ORGANIZATION_COOKIE`, and mirrored it into the `create-app` template as the root
  `AGENTS.md` template-sync rule requires.
- Corrected *Deliberately out of scope*: it now names both `OrganizationSwitcher` files rather
  than only the template one, and no longer claims they carry no constant duplication — they
  inline the two cookie names across seven lines; only the sentinel is imported.
- Added the Risks & Impact Review, Final Compliance Report and Changelog sections required by
  `.ai/specs/AGENTS.md`.
- Added a `scope/` row to the Library Directory table in `packages/shared/AGENTS.md`.

### 2026-08-27

- Initial implementation: `packages/shared/src/lib/scope/cookies.ts` added; `core`'s
  `modules/directory/constants` and `modules/directory/utils/scopeCookies` turned into
  re-export bridges; inlined copies removed from `lib/auth/server.ts`, `lib/crud/factory.ts`
  and `organizationScope.ts`; three test files added or extended.
