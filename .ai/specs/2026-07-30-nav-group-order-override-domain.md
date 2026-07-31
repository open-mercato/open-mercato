# Sidebar Nav Group Ordering as an Override Domain

## TL;DR

`normalizeGroupWeights` ranks a hard-coded list of nav group ids ahead of every group not in it,
regardless of the app's own page `priority`/`order`. Wire sidebar group ordering as the `nav` override
domain — `overrides.nav.groupOrder` in `modules.ts` — so an app can place its own group first without
editing core. Prepend semantics, applied beneath role and user preferences. With no override configured
ordering is unchanged for every existing install.

## Overview

- **Touched code**: `packages/shared/src/modules/overrides.ts`,
  `packages/core/src/modules/auth/lib/backendChrome.tsx`,
  `apps/docs/docs/framework/modules/overrides.mdx`
- **Not touched**: `SidebarPreferencesSettings`, the sidebar preferences API, `RoleSidebarPreference`,
  the customization editor, persistence

## Problem Statement

`packages/core/src/modules/auth/lib/backendChrome.tsx` sorts groups against a literal list:

```ts
const defaultGroupOrder = [
  'customers.nav.group', 'catalog.nav.group', 'customers~sales.nav.group',
  'wms.nav.group', 'resources.nav.group', 'staff.nav.group',
  'entities.nav.group', 'directory.nav.group', 'attachments.nav.group',
]
```

Any group present in that list outranks any group absent from it, and the weight arithmetic that
follows preserves that partition. A downstream app therefore cannot put its own primary module above the
shipped groups through any documented mechanism, no matter what `priority`/`order` its pages declare.

That the list is maintenance state rather than product policy is visible in its own history: between
`main` and `develop` it gained `wms.nav.group` and swapped `customers.storage.nav.group` for
`attachments.nav.group`. It is edited whenever a module ships.

The only existing escape hatch is seeding a per-role `SidebarPreferencesSettings.groupOrder` row via
`RoleSidebarPreference`. That works, but it is documented nowhere near the override mechanism and is
discoverable only by reading `auth`'s internals.

## Why This Is Additive, Not A Deviation

`BACKWARD_COMPATIBILITY.md` §2 already reserves the space:

> `ModuleOverrides`: `overrides.ai.agents`, `overrides.ai.tools`, and `overrides.ai.extensions` shapes
> are STABLE; **other domain keys are reserved by the unified override contract and may be wired
> additively**

Wiring a `nav` domain is that contract's own extension path.

## Proposed Solution

Add `nav` to the override domain set with a single key:

```ts
export interface NavOverridesShape {
  groupOrder?: string[]
}
```

### Prepend, not replace

The ids listed rank first, in the order given; every group not named keeps the ordering it has today.

Chosen over replace because an app that only cares about its own group then lists exactly one id. Under
replace semantics the app would have to enumerate every shipped group it wanted to keep in place, and
any group it forgot would silently fall to the tail — a large behavioural surprise for a small
configuration mistake. Prepend has no such failure mode. Only one of the two is supported, deliberately.

### Precedence

Ordering resolves lowest to highest precedence:

1. `defaultGroupOrder` (shipped)
2. `overrides.nav.groupOrder` (app-wide default)
3. `RoleSidebarPreference.groupOrder` (per role)
4. per-user sidebar preference

A module override is a *default*, so it sits beneath both preference layers — an operator's own
arrangement must keep winning. The existing chain already applies role then user preferences over the
base via `applySidebarPreference`, so this requires no change to that code.

### Collision

Nav ordering is one app-wide decision. If more than one module entry declares `groupOrder`, the later
one in load order wins and a warning names both. Not merged: merging two independent orderings has no
well-defined answer.

## Architecture

### Applier and state

`navOverridesApplier` follows the existing built-in applier pattern (compare `setupOverridesApplier`),
storing into state exposed by an accessor:

```ts
export function getNavGroupOrderOverride(): readonly string[] | null
export function applyNavGroupOrderOverrides(groupOrder: string[] | null): void
```

Two tiers, matching every other domain and the documented resolution order: the programmatic call wins
over the `modules.ts` declaration, and passing `null` clears it and falls back to the declaration.

State persists on `globalThis` under a stable key, not in a module-local variable. This domain is the
one whose **reader lives in a different package** from its writer — `@open-mercato/core`'s backend chrome
reads what the app's bootstrap wrote — and standalone builds can evaluate `@open-mercato/shared` through
more than one server chunk, which would leave the reader looking at an empty instance. Required by
`.ai/lessons.md`, "Global registries in publishable packages must use `globalThis`", and covered by an
isolated-module regression test that loads a second copy of the module and asserts it observes the
bootstrap value. That test was verified to fail when the state is module-local.

Input is normalised on the way in: non-arrays ignored, non-string and blank entries dropped, values
trimmed, duplicates removed keeping first position. An empty result is treated as no override.

State is cleared by `resetModuleContractOverridesForTests`, alongside the other override stores.

### Consumer

`resolveGroupOrder()` in `backendChrome.tsx`:

```ts
function resolveGroupOrder(): string[] {
  const override = getNavGroupOrderOverride()
  if (!override || override.length === 0) return defaultGroupOrder
  const overridden = new Set(override)
  return [...override, ...defaultGroupOrder.filter((id) => !overridden.has(id))]
}
```

`defaultGroupOrder` moves to module scope (it was rebuilt per call inside `normalizeGroupWeights`), and
the weight arithmetic reads `groupOrder.length` in place of `defaultGroupOrder.length`.

**Hard requirement**: with no override configured, `resolveGroupOrder()` returns `defaultGroupOrder`
itself, so the sort, the rank lookup and the weight arithmetic are all bit-for-bit what they are today.
This is the difference between an additive extension and a breaking change to every existing install's
sidebar, and it is covered by an explicit test.

## Data Model

No database or entity change. No new persisted state.

## API Contracts

`ModuleOverrides` gains an optional `nav?: NavOverridesShape`; `ModuleOverrideDomain` and `DOMAIN_KEYS`
gain `'nav'`. Both additive. Apps that declare nothing are unaffected.

Note that adding `'nav'` to the domain set also *stops* a previously-emitted "domain not yet wired"
warning for any app that had already speculatively written `overrides.nav`.

## Phases

### Phase 1: domain
Type, union entry, dispatch key, applier, accessor, test-reset wiring.

### Phase 2: consumer
`resolveGroupOrder()` in `backendChrome.tsx`, with unchanged behaviour when no override exists.

### Phase 3: docs and coverage
Domain table row and a worked example in the overrides doc, including the distinction from role
preferences. Tests per the coverage list below.

## Integration Coverage

Override plumbing (`packages/shared`):
- unset when no module declares it
- ids captured in order, and no "not yet wired" warning — proving the domain is dispatched
- empty list treated as no override
- blanks dropped, duplicates removed, values trimmed, first position preserved
- non-array value ignored rather than throwing
- two declaring modules → later wins, one warning naming both
- same module twice → later value, no warning
- cleared by the store reset hook

Route-level (`packages/core/src/modules/auth/__integration__/TC-AUTH-NAV-OVERRIDE-001.spec.ts`) —
proves a real declaration survives a real bootstrap, following the pattern already used for the
API-route domain (`TC-UMES-022`), where the example app applies a genuine override so a test can
observe it. `apps/mercato/src/modules.ts` therefore applies `nav: { groupOrder: ['example.nav.group'] }`
on the `example` entry:

- the app-declared group leads the sidebar, outranking `customers.nav.group` (first in the shipped list)
- a personal sidebar preference still wins over the app default, and clearing it falls back to the
  app-declared order

Ordering (`packages/core`):
- **no override → ordering identical to today** (the safety property)
- empty override → same
- a named app group ranks ahead of shipped groups
- unnamed shipped groups keep their relative order (prepend, not replace)
- order within the override is honoured
- shipped groups can be reordered against each other
- unknown ids ignored, group count unchanged

## Risks & Impact Review

### Risk 1: changing ordering for existing installs
- Severity: High if mishandled
- Impact: every existing app's sidebar reorders on upgrade
- Mitigation: `resolveGroupOrder()` returns the shipped list unchanged when no override is configured;
  a test asserts the full resolved order for that case
- Residual risk: low

### Risk 2: a module override outranking an operator's own preference
- Severity: Medium
- Impact: a user's saved arrangement appears to be ignored
- Mitigation: the override feeds the *base* ordering only; role and user preferences continue to apply
  afterwards through the untouched `applySidebarPreference` chain
- Residual risk: low

### Risk 3: two modules fighting over ordering
- Severity: Low
- Impact: non-obvious which order wins
- Mitigation: deterministic last-in-load-order rule plus a warning naming both modules; documented
- Residual risk: low

### Risk 4: replace-vs-prepend confusion
- Severity: Low
- Impact: an app lists a partial order expecting replace semantics
- Mitigation: prepend is stated in the type's doc comment, the docs example, and this spec; the
  behaviour is also the forgiving one if the reader assumes wrong
- Residual risk: low

## Final Compliance Report

### Architecture
- [x] Uses the unified override contract's documented extension path
- [x] Applier follows the existing built-in pattern
- [x] No new module boundary

### Data & Security
- [x] No schema change
- [x] No new persisted state
- [x] No ACL or scope implications — ordering is presentation only

### API & UI
- [x] `ModuleOverrides` extended additively
- [x] Behaviour identical when no override is configured
- [x] Preference precedence preserved

### Testing
- [x] Unchanged-ordering safety property covered
- [x] Normalisation and collision covered
- [x] Prepend semantics covered

## Migration & Backward Compatibility

No migration is required, and no existing installation changes behaviour.

- **`ModuleOverrides.nav`** is a new **optional** domain key, wired under the clause in
  `BACKWARD_COMPATIBILITY.md` §2 that reserves non-AI domain keys for additive wiring.
  `ModuleOverrideDomain` and `DOMAIN_KEYS` gain `'nav'` additively; no existing domain is renamed,
  removed, or reordered in a way that changes behaviour.
- **Ordering is unchanged when no override is configured.** `resolveGroupOrder()` returns
  `defaultGroupOrder` itself, so the sort comparator, the rank lookup, and the weight arithmetic are
  identical to the previous implementation. Verified empirically rather than by inspection: the ordering
  test suite was run against the *unmodified* implementation, where the no-override and empty-override
  cases pass unchanged and only the override-specific cases fail.
- **One narrow behaviour does change, intentionally.** An app that had already written `overrides.nav`
  was previously ignored with a "domain not yet wired" warning, and now takes effect. That is the point
  of wiring the domain; such an app was relying on a documented no-op.
- **Preference precedence is preserved.** The override feeds the base ordering only; role and per-user
  sidebar preferences still apply on top through the untouched `applySidebarPreference` chain, so an
  operator's saved arrangement continues to win.
- **No other contract surface is touched**: no route URL or method, no response schema, no event name or
  payload, no CLI command, no DI key, no ACL feature, no database change, and no change to
  `SidebarPreferencesSettings` or the sidebar preferences API.
- **Forward constraint for future changes**: the no-override-configured path MUST stay byte-identical.
  Any later change to this domain has to preserve that property, because it is what keeps the domain
  additive rather than a silent reorder of every existing sidebar.

## Changelog

- 2026-07-30: Drafted and implemented. Reported from a downstream app that could not rank its own
  primary module above the shipped nav groups, and that spent recon time discovering the
  role-preference workaround by reading `auth` internals — now documented alongside the override.

- 2026-07-31: Review follow-up, complying with all findings. Nav ordering state moved to `globalThis`
  with an isolated-module regression test (verified to fail on module-local state), since this domain's
  reader sits in another package. Added the programmatic tier `applyNavGroupOrderOverrides` with
  precedence over the `modules.ts` declaration, matching every other wired domain. Registered the
  domain in the umbrella spec's status table (phase 19), `packages/shared/AGENTS.md`, the overrides
  docs page, and the `moduleOverrideExamples` catalogue in both the app and the create-app template.
  Added `TC-AUTH-NAV-OVERRIDE-001` for route-level proof through a real bootstrap.
