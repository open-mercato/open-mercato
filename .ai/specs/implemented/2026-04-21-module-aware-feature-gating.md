# Module-Aware Feature Gating

| Field | Value |
|-------|-------|
| Status | Draft |
| Scope | OSS |
| Owner | Auth / UI / Shared |
| Related Issues | — |
| Related PRs | [#1567](https://github.com/open-mercato/open-mercato/pull/1567) — messages topbar icon partial fix |
| Related Guides | `packages/shared/AGENTS.md`, `packages/core/src/modules/auth/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/core/AGENTS.md` |
| Related Specs | `2026-03-25-coherent-access-denied-ux.md` (sibling concern — 403 UX) |

## TLDR

When a module is disabled in `modules.ts` (e.g. `ai_assistant`, `search`, `notifications`, `messages`) but user/role ACL rows still persist its feature strings (`ai_assistant.view`, `search.global`, …), the UI still renders gates (topbar icons, sidebar entries, page links) and server guards still accept requests gated on those features — producing 404 spam against non-existent API routes and broken navigation. PR #1567 solved this for the messages topbar icon only, using a route-visibility check that doesn't generalize to items that open panels/palettes/dropdowns instead of pages. This spec generalizes the fix at a single server-side choke point: a shared helper filters raw grants down to the set whose owning module is currently enabled, applied (a) to `BackendChromePayload.grantedFeatures` before it reaches the client, and (b) inside `rbacService.userHasAllFeatures` so declarative page/API `requireFeatures` guards inherit the same semantics. No change to `hasFeature` / `hasAllFeatures` signatures — every existing caller keeps working, and the two choke points propagate correctness to every downstream gate.

## Overview

`Module` entries in the registry already carry `features: Array<{ id, title, module }>` aggregated from each module's `acl.ts`, and the enabled-module set is available from `getModules()` in `packages/shared/src/lib/modules/registry.ts`. Feature ids follow the `<module>.<action>` naming convention (see root `AGENTS.md` — Conventions), so each feature id implies its owning module without a lookup table.

PR #1567 chose a route-visibility workaround for messages (`hasVisibleRoute(payload.groups, '/backend/messages')` in `packages/create-app/template/src/components/BackendHeaderChrome.tsx`) because the messages icon is tied to a backend page. That trick doesn't generalize:

- AI assistant icon opens a chat panel — no page route to match.
- Search icon opens the Cmd+K palette — no page route to match.
- Notifications bell opens a dropdown — no page route to match.
- Org switcher is a topbar dropdown — no page route at all.

The structural signal we need is **"is the module backing this feature installed?"** — module presence is coarser but universally available and is exactly what the bug is about.

## Problem Statement

### Root cause 1 — feature strings outlive module presence in ACL storage

Role ACL rows persist feature ids. That's intentional: disabling a module in `modules.ts` for a release and re-enabling it later should not require re-editing every role. But runtime checks consult the stored grants without asking whether the backing module is currently installed. So a role with `ai_assistant.view` renders the AI icon even when `ai_assistant` is not in `modules.ts`, and `/api/ai/*` returns 404 on click.

### Root cause 2 — PR #1567's fix is a point patch

Nav-visibility (`hasVisibleRoute`) only works when the gate happens to sit next to a page route that is itself module-gated. The four remaining topbar items, every widget placed via injection that checks features, every page/API `requireFeatures` guard, and all future gates would each need their own ad-hoc check. A single structural fix is preferable to growing point patches.

## Proposed Solution

Apply module-presence filtering in one server-side helper and consume it at two choke points: the `BackendChromePayload` builder and the RBAC service. No helper signature changes. Role/audit UIs that need raw stored grants keep reading them from the roles API (`/api/auth/roles/acl`), which is unaffected.

### 1. Shared helper — `enabledModulesRegistry`

A new server-only helper in `packages/shared/src/security/enabledModulesRegistry.ts`:

```ts
import { getModules } from '../lib/modules/registry'

export function getOwningModuleId(featureId: string): string {
  const dot = featureId.indexOf('.')
  return dot === -1 ? featureId : featureId.slice(0, dot)
}

function safeGetEnabledModuleIds(): string[] | null {
  try { return getModules().map((m) => m.id) } catch { return null }
}

export function getEnabledModuleIds(): string[] {
  return safeGetEnabledModuleIds() ?? []
}

export function filterGrantsByEnabledModules(granted: readonly string[]): string[] {
  const enabledIds = safeGetEnabledModuleIds()
  if (enabledIds === null) return [...granted]   // registry not populated (CLI, tests) — legacy pass-through
  const enabledSet = new Set(enabledIds)
  const result: string[] = []
  for (const grant of granted) {
    if (grant === '*') {
      for (const id of enabledIds) result.push(`${id}.*`)
      continue
    }
    if (enabledSet.has(getOwningModuleId(grant))) result.push(grant)
  }
  return result
}
```

Key points:

- **Module owner derived from feature id** via the `<module>.<action>` convention — no runtime feature-map needed.
- **Superadmin (`*`) expansion**: the single `*` grant expands to one `<module>.*` wildcard per enabled module. The result is a plain grant list still consumable by the existing wildcard-aware `matchFeature` / `hasAllFeatures` helpers without any signature change.
- **Fail-soft for empty registry**: if `getModules()` throws (ordering issues during CLI / tests), `filterGrantsByEnabledModules` passes through unchanged to preserve legacy behavior.

### 2. Pre-filter `BackendChromePayload.grantedFeatures` on the server

In `packages/core/src/modules/auth/lib/backendChrome.tsx`, run the filter before the payload leaves the server:

```ts
const rawGrantedFeatures = acl.isSuperAdmin ? ['*'] : acl.features
const grantedFeatures = filterGrantsByEnabledModules(rawGrantedFeatures)
```

`BackendChromePayload.grantedFeatures` is the **effective grant set for this session**, consumed by client-side gate sites (topbar icons, `useInjectedMenuItems`, notification-handler dispatch). Role editor and audit UIs have no dependency on this field — they read the raw stored grants via `/api/auth/roles/acl`. So pre-filtering at the payload boundary is safe, and a pure `hasFeature(granted, required)` on the client stays a correct gate.

### 3. Thread the same filter through `rbacService.userHasAllFeatures`

`rbacService.userHasAllFeatures` is the authoritative server check for declarative `requireFeatures` metadata on pages and APIs. It now applies:

- **Superadmin branch (runs first, preserves pre-existing org-scope bypass)**: every required feature must belong to an enabled module. If the module registry is empty (e.g. during CLI / test bootstrap), falls back to the legacy `return true` to avoid blocking tooling.
- **Non-superadmin branch**: unchanged org-scope gate, then delegate to `hasAllFeatures(required, filterGrantsByEnabledModules(acl.features))`.

Ordering matters: the `acl.isSuperAdmin` short-circuit must run BEFORE the `acl.organizations` scope check, because superadmin historically bypasses org scoping. Don't break that invariant.

### 4. Topbar icons

`packages/create-app/template/src/components/BackendHeaderChrome.tsx` already calls `hasFeature(grantedFeatures, '<module>.view')` for the AI assistant / search / notifications / org switcher icons. Because `grantedFeatures` is now filtered at the payload boundary, these calls automatically return `false` when the backing module is disabled — no per-icon code change needed. Messages keeps its `hasVisibleRoute` check — route-level is strictly stronger (also catches "page exists but hidden") and already works.

### 5. Customer portal

The same pattern applies to the portal ACL path. `packages/core/src/modules/customer_accounts/lib/customerAuth.ts` exposes `features: string[]` on the portal auth context; the equivalent portal-chrome payload pre-filter should be added as a follow-up, along with threading `filterGrantsByEnabledModules` through the portal RBAC feature check used by `requireCustomerFeatures`.

### 6. Alternatives considered

| Option | Why rejected |
|--------|--------------|
| Extend `hasVisibleRoute` to the remaining topbar icons | AI assistant / search / notifications / org switcher don't have backend page routes — nothing to match on |
| Add an optional `FeatureCheckContext` third argument on `hasFeature` / `hasAllFeatures` and pass `{ enabledModules, featureModuleMap }` at call sites | Every gate site (topbar, injection menus, notification handlers) has to opt in; missing ctx silently keeps the legacy bug. Pre-filtering the grant list at the payload + RBAC boundary delivers the same correctness with zero call-site migration |
| Expose `enabledModules` on the client via an ambient registry (`registerEnabledModules`) bootstrapped into the bundle, and have `hasFeature` consult it on the client | Added a parallel client-side module-list store that already exists server-side via `getModules()`, duplicating state and creating a cache-invalidation surface on scope changes. The client never actually needs the list — it only gates on features — so filtering the grant list server-side achieves the same result with no client registry at all |
| Filter silently at ACL storage / role-editing time | Lies to role editors and audit views that want the raw stored grants |

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ modules.ts                                                         │
│   registered modules (each with acl.ts features[{id,title,module}])│
└───────────────────────────┬───────────────────────────────────────┘
                            │ getModules()
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ enabledModulesRegistry.ts                                          │
│   getOwningModuleId(featureId)                                     │
│   getEnabledModuleIds()                                            │
│   filterGrantsByEnabledModules(grants)                             │
└────┬──────────────────────────────────────────┬────────────────────┘
     │                                          │
     ▼                                          ▼
┌──────────────────────┐              ┌──────────────────────────────┐
│ backendChrome.tsx    │              │ rbacService.userHasAllFeatures│
│ → payload.grantedFeatures (server)  │ → requireFeatures metadata    │
└──────────┬───────────┘              │   (pages / APIs)              │
           │                          └──────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ Client-side gate sites                                            │
│   topbar icons (BackendHeaderChrome)                              │
│   useInjectedMenuItems (menu injection)                           │
│   notification handlers (useNotificationsPoll / Sse)              │
│   → hasFeature(payload.grantedFeatures, 'module.action')          │
└──────────────────────────────────────────────────────────────────┘
```

Role / audit UIs intentionally bypass this pipeline by reading raw ACL rows via `/api/auth/roles/acl`.

## Data Models

No database changes. No stored ACL data changes. No feature id changes. Feature ids remain FROZEN per `BACKWARD_COMPATIBILITY.md` §10.

## API Contracts

No new API routes. No modified API routes.

- `BackendChromePayload.grantedFeatures` semantics tightened to "effective grants for this session" (filtered). Old consumers continue to call `hasFeature(granted, required)` and get correct answers automatically.
- `rbacService.userHasAllFeatures` keeps its signature. All declarative `requireFeatures` metadata inherits module-awareness.
- Role management / audit APIs (`/api/auth/roles/acl`, etc.) continue to return raw stored grants — unchanged.
- Custom routes that read raw granted feature arrays directly and don't route through `rbacService` keep legacy behavior. They should be migrated to `rbacService.userHasAllFeatures` or to a `filterGrantsByEnabledModules(grants)` pre-pass (catalogue during implementation).

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|------|----------|------|------------|----------|
| Client code expects `grantedFeatures` to contain raw `*` for superadmin | Low | Payload | `*` is expanded to `<module>.*` per enabled module; the existing wildcard-aware `matchFeature` handles both identically. Audited consumers: topbar, menu injection, notifications handlers — none of them special-case `*` | Negligible |
| Role editor / audit UI reads filtered grants instead of raw | Low | Admin UI | Those UIs use `/api/auth/roles/acl`, not `BackendChromePayload`. Verified during implementation | None |
| Superadmin (`grantedFeatures === ['*']`) loses access to disabled modules | Medium | RBAC | Intentional: a not-installed module has no functioning UI/API; showing icons that 404 is worse than hiding. Document in `auth/AGENTS.md` | Low |
| Reordering org-scope and superadmin checks in `userHasAllFeatures` accidentally scopes superadmin by organization | Medium | RBAC | Superadmin short-circuit MUST run before the org-scope check; invariant enforced by unit test | Low |
| Registry not populated (CLI / tests) causes mass fail-closed | Medium | Tooling | `safeGetEnabledModuleIds()` returns `null` and `filterGrantsByEnabledModules` passes grants through unchanged; superadmin branch in RBAC short-circuits when `enabledIds.length === 0` | Low |
| Custom (non-`makeCrudRoute`) write routes that read raw `acl.features` and call `hasFeature` directly still see the stale grant | Medium | Coverage | Free-standing call sites keep legacy behavior. Choke points (RBAC service + chrome payload) cover declarative guards and the default client flow. Catalogue residual direct callers during implementation; migrate opportunistically | Low |
| Cache staleness after `modules.ts` change | Low | Dev loop | `yarn generate` + `yarn mercato configs cache structural --all-tenants` already required per root `AGENTS.md` | Low |

## Implementation Plan

1. **Shared helper** — add `packages/shared/src/security/enabledModulesRegistry.ts` (`getOwningModuleId`, `getEnabledModuleIds`, `filterGrantsByEnabledModules`). Unit tests for wildcard expansion, unknown-module grants, empty / errored registry, superadmin `*`.
2. **Server payload** — update `packages/core/src/modules/auth/lib/backendChrome.tsx` to compute `grantedFeatures = filterGrantsByEnabledModules(rawGrantedFeatures)`.
3. **Server RBAC** — update `rbacService.userHasAllFeatures` so (a) the superadmin branch runs before the org-scope check and additionally requires each required feature's owning module to be in the enabled set, and (b) the non-superadmin branch passes `filterGrantsByEnabledModules(acl.features)` into the existing `hasAllFeatures` helper.
4. **Docs** — update `packages/core/src/modules/auth/AGENTS.md` RBAC section with the module-presence rule and the superadmin-loses-disabled-modules contract.
5. **Customer portal mirror** — follow-up PR: same filter on the portal-chrome payload and portal RBAC check.
6. **Integration tests** — per the test plan below.

## Test Plan

Unit:

- `getOwningModuleId('ai_assistant.view')` → `'ai_assistant'`; `getOwningModuleId('foo')` → `'foo'`.
- `filterGrantsByEnabledModules(['messages.view', 'ai_assistant.view'])` with only `messages` enabled → `['messages.view']`.
- `filterGrantsByEnabledModules(['*'])` with `['auth','messages']` enabled → `['auth.*','messages.*']`.
- `filterGrantsByEnabledModules(['*'])` with errored registry → `['*']` (pass-through).
- `rbacService.userHasAllFeatures` — matrix: `(superadmin, feature-from-enabled-module)` → true; `(superadmin, feature-from-disabled-module)` → false; `(superadmin, empty registry)` → true; `(non-superadmin, grant + module enabled)` → true; `(non-superadmin, grant for disabled module only)` → false; `(non-superadmin, org-scope mismatch)` → false.
- Regression: `userHasAllFeatures` with `required: []` → true without touching ACLs.
- Regression (invariant): superadmin with a concrete, non-matching `acl.organizations` list still returns `true` — the superadmin short-circuit must precede the org-scope check.

Integration (per `.ai/qa/AGENTS.md`):

- Disable `ai_assistant` in `modules.ts`, keep role feature `ai_assistant.view`: topbar AI icon absent; no `/api/ai/*` calls; a page gated on `ai_assistant.view` returns 403 (not 200). Same matrix for `search` (`search.global`) and `notifications` (`notifications.view`).
- Regression: all modules enabled, non-admin user with only the `.view` feature (no admin `.manage`) → icon renders, page accessible.
- Regression: messages icon path unchanged (still hidden via nav-visibility when `messages` disabled; still shown otherwise).
- Superadmin + `ai_assistant` disabled → icon hidden, page returns 403.
- Customer portal (after follow-up): disabled portal-owned module + customer role carrying its feature → portal UI hides the affected entry, portal API returns 403.

## Verification

- `yarn test` — unit tests for helper and RBAC service.
- `yarn test:integration` — scenarios above.
- Manual QA — walk through the four disable-module scenarios plus superadmin.
- `yarn lint`, `yarn typecheck`, `yarn build:packages`.
- `yarn generate` after any change that touches `modules.ts` or module `acl.ts` in the scenario setup, plus `yarn mercato configs cache structural --all-tenants` per root `AGENTS.md`.

## Migration & Backward Compatibility

- No helper signatures change. All existing callers keep compiling and keep their current semantics (`BACKWARD_COMPATIBILITY.md` §3).
- `BackendChromePayload.grantedFeatures` keeps its type (`string[]`). Its runtime contents become "effective grants" — a strictly narrower subset, which is what every client consumer actually wants (`BACKWARD_COMPATIBILITY.md` §2).
- No ACL storage changes; feature ids remain stable (`BACKWARD_COMPATIBILITY.md` §10).
- No CLI changes, no database migrations, no URL changes.
- Third-party modules inherit correct behavior as long as feature ids follow the `<module>.<action>` naming convention (already required by root `AGENTS.md`).

## Final Compliance Report

- Contract surfaces touched: (8) Payload field semantics narrowed (additive constraint — the field still type-checks as `string[]`); all other surfaces untouched.
- Backward compatibility protocol: no deprecations required, no bridges needed — the change preserves every public signature and only tightens the runtime meaning of a payload field.
- AGENTS.md updates: `packages/core/src/modules/auth/AGENTS.md` (RBAC section — module-presence rule + superadmin contract).
- Integration coverage declared in Test Plan, matching `.ai/qa/AGENTS.md` expectations for new features.

## Changelog

- 2026-04-21 — Initial draft (ctx-argument approach).
- 2026-04-22 — Revised to describe the implemented design: pre-filter at payload + RBAC boundary, no `hasFeature` / `hasAllFeatures` signature change. Removed `FeatureCheckContext` proposal. Added invariant that the superadmin short-circuit must run before the org-scope check in `userHasAllFeatures`.
- 2026-04-22 — Documented the ambient client-registry alternative (tried during implementation, rejected in favor of server-side filtering).
