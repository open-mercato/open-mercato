# CRM Code Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every Medium + Low finding from the tech-lead code review of `feat/crm-details-screens` so the PR flips from "Changes Requested" to "Approve".

**Architecture:** Work is split into 8 phases, ordered smallest-to-largest so early phases produce fast, independently-shippable commits (i18n, tests, small cleanups) before the bulk DS-token migration. Each file is one task (or one pair of tasks) so reviewers can follow the diff without getting lost in the 390+ DS violations.

**Tech Stack:** TypeScript, React, Tailwind (semantic DS tokens), MikroORM, Jest + `@testing-library/react`, Next.js App Router, `resolveTranslations()` helper from `@open-mercato/shared/lib/i18n/server`.

**Reference material (must-read before starting):**
- `AGENTS.md` → "Design System Rules" (status tokens, typography, radius, icons, status badge)
- `BACKWARD_COMPATIBILITY.md` → confirm no changes break contracts
- `packages/core/src/modules/customers/api/entity-roles-factory.ts:344` — canonical `translate()` usage
- `packages/core/src/modules/customers/i18n/en.json` — alphabetical key convention
- `packages/core/src/modules/customers/api/people/route.ts:224` — canonical `findWithDecryption` usage
- `packages/ui/src/backend/__tests__/CollapsibleZoneLayout.test.tsx` — test harness template

---

## DS Token Migration Cheat-Sheet (used by Tasks 10–22)

This table is authoritative for every DS rewrite. If a case isn't covered, read the surrounding code, infer semantic intent (status vs. decorative), and pick the closest token — never invent a new arbitrary value.

**Text size**

| Arbitrary | Token |
|-----------|-------|
| `text-[10px]`, `text-[11px]` on lowercase body | `text-xs` |
| `text-[11px]` on **UPPERCASE** / tracking-wide labels | `text-overline` |
| `text-[12px]` | `text-xs` |
| `text-[13px]`, `text-[14px]` | `text-sm` |
| `text-[15px]`, `text-[16px]` | `text-base` |
| `text-[18px]` | `text-lg` |
| `text-[20px]` | `text-xl` |
| `text-[22px]`, `text-[24px]` | `text-2xl` |

Do **not** migrate `text-[9px]` on the notification badge — that single exception is allowed.

**Border radius** (base `--radius` = 10px)

| Arbitrary | Token |
|-----------|-------|
| `rounded-[4px]` | `rounded-sm` |
| `rounded-[6px]`, `rounded-[8px]` | `rounded-md` |
| `rounded-[10px]`, `rounded-[12px]` | `rounded-lg` |
| `rounded-[14px]`, `rounded-[16px]` | `rounded-xl` |
| `rounded-[20px]+` | `rounded-2xl` |
| circular avatars / pills | `rounded-full` |

**Spacing / size** — keep `px-N`/`py-N`/`size-N` on the default 0.25rem grid. Only keep an arbitrary value if the number is **not** a multiple of 4 **and** the design intent really requires it; in that case replace with the nearest multiple (`px-[2px]` → `px-0.5`, `py-[3px]` → `py-1`, `size-[14px]` → `size-3.5`, `size-[22px]` → `size-5`).

**Colors** — map by semantic intent, not by hue:

| Raw value | Replacement | Context |
|-----------|-------------|---------|
| `#ffffff`, `#fff` | `bg-background` or `text-background` | surfaces/text |
| `#101828`, near-black hex | `text-foreground` | body text |
| `#94a3b8`, `text-slate-*`, `text-gray-*` | `text-muted-foreground` | secondary text |
| `bg-yellow-100`, `#fff2e0`, `#eb9426` | `bg-status-warning-bg` / `text-status-warning-text` / `text-status-warning-icon` | warning state |
| `text-yellow-800` | `text-status-warning-text` | warning label |
| `#22c55e`, `text-green-*`, `bg-green-*` | `bg-status-success-*` / `text-status-success-*` | success state |
| `#ef4444`, `text-red-*`, `bg-red-*` | `bg-status-error-*` / `text-status-error-*` | error state |
| `#2563eb`, `#3366ff`, `text-blue-*`, `bg-blue-*` | `bg-status-info-*` / `text-status-info-*` **or** `text-primary` / `bg-primary` | informational vs brand |
| `#c7eb54` (lime accent, deal adapter) | `bg-primary` / `text-primary-foreground` | decorative brand accent |

If in doubt, prefer `text-muted-foreground` / `bg-muted` over a brand color and raise the ambiguity in the commit message.

---

## Phase 1 — i18n error keys (quickest win)

### Task 1: Add new `customers.errors.*` keys to all 4 locale files

**Files:**
- Modify: `packages/core/src/modules/customers/i18n/en.json`
- Modify: `packages/core/src/modules/customers/i18n/de.json`
- Modify: `packages/core/src/modules/customers/i18n/es.json`
- Modify: `packages/core/src/modules/customers/i18n/pl.json`

**New keys (keep the `errors` object strictly alphabetical — existing convention):**

| Key | en | de | es | pl |
|-----|----|----|----|----|
| `assignable_staff_load_failed` | `Failed to load assignable staff` | same | same | same |
| `company_people_load_failed` | `Failed to load linked people` | same | same | same |
| `deal_companies_load_failed` | `Failed to load linked companies` | same | same | same |
| `deal_people_load_failed` | `Failed to load linked people` | same | same | same |
| `internal_server_error` | `Internal server error` | same | same | same |
| `kind_settings_load_failed` | `Failed to load kind settings` | same | same | same |
| `labels_load_failed` | `Failed to load labels` | same | same | same |
| `organization_context_required` | `Organization context is required` | same | same | same |
| `validation_failed` | `Validation failed` | same | same | same |

> Reuse existing `validationFailed` if it already exists instead of adding `validation_failed`. The exploration agent confirmed `validationFailed` is already a key — **use that one** for the "Validation failed" string in Task 2 and skip adding `validation_failed`.

Existing i18n files repeat the English copy verbatim in de/es/pl (per the explorer's audit of current strings), so replicate that convention here — do **not** machine-translate.

- [ ] **Step 1:** Open each of the 4 JSON files, locate the `customers.errors` object, and insert the 8 new keys (skip `validation_failed` if `validationFailed` is already present) at the correct alphabetical position.

- [ ] **Step 2:** Verify alphabetical order with:

```bash
for f in packages/core/src/modules/customers/i18n/{en,de,es,pl}.json; do
  node -e "const j=require('./'+process.argv[1]); const k=Object.keys(j.customers.errors); const s=[...k].sort(); console.log(process.argv[1], JSON.stringify(k)===JSON.stringify(s)?'OK':'OUT OF ORDER');" "$f"
done
```

Expected: all 4 files report `OK`.

- [ ] **Step 3:** Commit:

```bash
git add packages/core/src/modules/customers/i18n/{en,de,es,pl}.json
git commit -m "i18n(customers): add error keys for load/validation failures"
```

### Task 2: Wrap hardcoded error strings in `translate()`

**Files to modify** (each uses the same pattern — add `const { translate } = await resolveTranslations()` if not already in scope, then wrap the string):

- `packages/core/src/modules/customers/api/assignable-staff/route.ts:220,223`
- `packages/core/src/modules/customers/api/companies/[id]/people/route.ts:203`
- `packages/core/src/modules/customers/api/deals/[id]/companies/route.ts:170`
- `packages/core/src/modules/customers/api/deals/[id]/people/route.ts:149`
- `packages/core/src/modules/customers/api/dictionaries/kind-settings/route.ts:84,99` (GET **and** PATCH catches)
- `packages/core/src/modules/customers/api/labels/route.ts:146`
- `packages/core/src/modules/customers/api/people/[id]/companies/enriched/route.ts:382`

**Canonical pattern (copy from `entity-roles-factory.ts:344`):**

```ts
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

// inside the handler, before the try/catch that returns the error:
const { translate } = await resolveTranslations()

// inside the catch:
return NextResponse.json(
  { error: translate('customers.errors.labels_load_failed', 'Failed to load labels') },
  { status: 500 },
)
```

**Per-file replacements:**

| File | Old string | New key |
|------|-----------|---------|
| `assignable-staff/route.ts:220` | `'Validation failed'` | `customers.errors.validationFailed` (reuse existing) |
| `assignable-staff/route.ts:223` | `'Failed to load assignable staff'` | `customers.errors.assignable_staff_load_failed` |
| `companies/[id]/people/route.ts:203` | `'Failed to load linked people'` | `customers.errors.company_people_load_failed` |
| `deals/[id]/companies/route.ts:170` | `'Failed to load linked companies'` | `customers.errors.deal_companies_load_failed` |
| `deals/[id]/people/route.ts:149` | `'Failed to load linked people'` | `customers.errors.deal_people_load_failed` |
| `dictionaries/kind-settings/route.ts:84` | `'Failed to load kind settings'` | `customers.errors.kind_settings_load_failed` |
| `dictionaries/kind-settings/route.ts:99` | `'Organization context is required'` | `customers.errors.organization_context_required` |
| `labels/route.ts:146` | `'Failed to load labels'` | `customers.errors.labels_load_failed` |
| `people/[id]/companies/enriched/route.ts:382` | `'Internal server error'` | `customers.errors.internal_server_error` |

- [ ] **Step 1:** Read each file, confirm `resolveTranslations` is imported (add the import if missing), and ensure `const { translate } = await resolveTranslations()` runs before the relevant catch block.

- [ ] **Step 2:** Replace each hardcoded string with the `translate(key, fallback)` call using the table above.

- [ ] **Step 3:** Type-check touched files:

```bash
yarn tsc --noEmit -p packages/core/tsconfig.json
```

Expected: no new TypeScript errors.

- [ ] **Step 4:** Grep to confirm no stragglers:

```bash
```

Use Grep tool:
- pattern: `(Failed to load|Validation failed|Internal server error|Organization context is required)`
- path: `packages/core/src/modules/customers/api`

Expected: zero matches inside NextResponse error bodies (matches in validator messages are fine — those are zod).

- [ ] **Step 5:** Commit:

```bash
git add packages/core/src/modules/customers/api
git commit -m "i18n(customers): wrap API catch-block errors in translate()"
```

---

## Phase 2 — Unit tests for persistence hooks (TDD)

All 4 hooks live in `packages/ui/src/backend/crud/`. Tests go in `packages/ui/src/backend/crud/__tests__/`. Every test file begins with the `/** @jest-environment jsdom */` pragma and clears `localStorage` between tests.

**Shared test skeleton (copy as starting point for each file):**

```tsx
/** @jest-environment jsdom */
import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
```

### Task 3: `usePersistedBooleanFlag` tests

**Files:**
- Test: `packages/ui/src/backend/crud/__tests__/usePersistedBooleanFlag.test.ts`

- [ ] **Step 1:** Write the failing test file:

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { usePersistedBooleanFlag } from '../usePersistedBooleanFlag'

describe('usePersistedBooleanFlag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the default value when storage is empty', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:a', true))
    expect(result.current.value).toBe(true)
  })

  it('hydrates from localStorage on mount when a value is saved', () => {
    localStorage.setItem('test:b', JSON.stringify('1'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:b', false))
    expect(result.current.value).toBe(true)
  })

  it('hydrates "0" as false regardless of default', () => {
    localStorage.setItem('test:c', JSON.stringify('0'))
    const { result } = renderHook(() => usePersistedBooleanFlag('test:c', true))
    expect(result.current.value).toBe(false)
  })

  it('persists toggled value to localStorage', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:d', false))
    act(() => { result.current.toggle() })
    expect(result.current.value).toBe(true)
    expect(localStorage.getItem('test:d')).toBe(JSON.stringify('1'))
  })

  it('persists setValue writes', () => {
    const { result } = renderHook(() => usePersistedBooleanFlag('test:e', false))
    act(() => { result.current.setValue(true) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('1'))
    act(() => { result.current.setValue(false) })
    expect(localStorage.getItem('test:e')).toBe(JSON.stringify('0'))
  })

  it('does not write on initial mount (only after changes)', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem')
    renderHook(() => usePersistedBooleanFlag('test:f', true))
    // mount-only render must not push through the "write" effect path
    expect(spy).not.toHaveBeenCalledWith('test:f', expect.anything())
    spy.mockRestore()
  })
})
```

- [ ] **Step 2:** Run to verify it fails **only** on missing coverage, not compilation:

```bash
yarn jest packages/ui/src/backend/crud/__tests__/usePersistedBooleanFlag.test.ts
```

Expected: all tests pass (hook already exists — this adds missing coverage). If any fail, read `packages/ui/src/backend/crud/usePersistedBooleanFlag.ts` and adjust the test expectation to match actual behavior (the test is a spec of current behavior, not a behavior change).

- [ ] **Step 3:** Commit:

```bash
git add packages/ui/src/backend/crud/__tests__/usePersistedBooleanFlag.test.ts
git commit -m "test(ui): cover usePersistedBooleanFlag hydrate/toggle/persist paths"
```

### Task 4: `useGroupCollapse` tests

**Files:**
- Test: `packages/ui/src/backend/crud/__tests__/useGroupCollapse.test.ts`

- [ ] **Step 1:** Write the test:

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useGroupCollapse } from '../useGroupCollapse'

describe('useGroupCollapse', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults to expanded=true', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp1'))
    expect(result.current.expanded).toBe(true)
  })

  it('honors explicit defaultExpanded=false', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp2', false))
    expect(result.current.expanded).toBe(false)
  })

  it('writes collapsed state to om:collapsible:<page>:<group>', () => {
    const { result } = renderHook(() => useGroupCollapse('people', 'basics'))
    act(() => { result.current.toggle() })
    expect(result.current.expanded).toBe(false)
    expect(localStorage.getItem('om:collapsible:people:basics')).toBe(JSON.stringify('0'))
  })

  it('accepts functional setExpanded', () => {
    const { result } = renderHook(() => useGroupCollapse('page', 'grp3'))
    act(() => { result.current.setExpanded((prev) => !prev) })
    expect(result.current.expanded).toBe(false)
  })

  it('scopes state per (pageType, groupId) pair', () => {
    localStorage.setItem('om:collapsible:p1:g', JSON.stringify('0'))
    const { result: a } = renderHook(() => useGroupCollapse('p1', 'g'))
    const { result: b } = renderHook(() => useGroupCollapse('p2', 'g'))
    expect(a.current.expanded).toBe(false)
    expect(b.current.expanded).toBe(true)
  })
})
```

- [ ] **Step 2:** Run:

```bash
yarn jest packages/ui/src/backend/crud/__tests__/useGroupCollapse.test.ts
```

Expected: PASS.

- [ ] **Step 3:** Commit:

```bash
git add packages/ui/src/backend/crud/__tests__/useGroupCollapse.test.ts
git commit -m "test(ui): cover useGroupCollapse per-group storage scoping"
```

### Task 5: `useZoneCollapse` tests

**Files:**
- Test: `packages/ui/src/backend/crud/__tests__/useZoneCollapse.test.ts`

- [ ] **Step 1:** Write the test:

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useZoneCollapse } from '../useZoneCollapse'

describe('useZoneCollapse', () => {
  beforeEach(() => { localStorage.clear() })

  it('defaults to collapsed=false', () => {
    const { result } = renderHook(() => useZoneCollapse('person'))
    expect(result.current.collapsed).toBe(false)
  })

  it('writes to om:zone1-collapsed:<pageType> on toggle', () => {
    const { result } = renderHook(() => useZoneCollapse('deal'))
    act(() => { result.current.toggle() })
    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem('om:zone1-collapsed:deal')).toBe(JSON.stringify('1'))
  })

  it('hydrates collapsed=true from storage on mount', () => {
    localStorage.setItem('om:zone1-collapsed:company', JSON.stringify('1'))
    const { result } = renderHook(() => useZoneCollapse('company'))
    expect(result.current.collapsed).toBe(true)
  })

  it('accepts functional setCollapsed', () => {
    const { result } = renderHook(() => useZoneCollapse('person'))
    act(() => { result.current.setCollapsed((prev) => !prev) })
    expect(result.current.collapsed).toBe(true)
  })
})
```

- [ ] **Step 2:** Run:

```bash
yarn jest packages/ui/src/backend/crud/__tests__/useZoneCollapse.test.ts
```

Expected: PASS.

- [ ] **Step 3:** Commit:

```bash
git add packages/ui/src/backend/crud/__tests__/useZoneCollapse.test.ts
git commit -m "test(ui): cover useZoneCollapse storage key + hydration"
```

### Task 6: `useGroupOrder` tests (non-trivial ordering logic)

**Files:**
- Test: `packages/ui/src/backend/crud/__tests__/useGroupOrder.test.ts`

- [ ] **Step 1:** Write the test covering: initial defaults, reorder persistence, storage hydration, new-id insertion, stale-id filtering, `arraysEqual` short-circuit (no unnecessary state updates).

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useGroupOrder } from '../useGroupOrder'

describe('useGroupOrder', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns defaults when storage is empty', () => {
    const defaults = ['a', 'b', 'c']
    const { result } = renderHook(() => useGroupOrder('people', defaults))
    expect(result.current.orderedIds).toEqual(defaults)
  })

  it('hydrates saved order from om:group-order:<pageType>', () => {
    localStorage.setItem('om:group-order:people', JSON.stringify(['c', 'a', 'b']))
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    expect(result.current.orderedIds).toEqual(['c', 'a', 'b'])
  })

  it('filters out stale IDs no longer in defaults and appends new IDs', () => {
    localStorage.setItem('om:group-order:people', JSON.stringify(['x', 'a', 'y', 'b']))
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    expect(result.current.orderedIds).toEqual(['a', 'b', 'c'])
  })

  it('reorder() moves items and persists the result', () => {
    const { result } = renderHook(() => useGroupOrder('people', ['a', 'b', 'c']))
    act(() => { result.current.reorder(0, 2) })
    expect(result.current.orderedIds).toEqual(['b', 'c', 'a'])
    expect(JSON.parse(localStorage.getItem('om:group-order:people')!)).toEqual(['b', 'c', 'a'])
  })

  it('reorder() handles insertion in the middle', () => {
    const { result } = renderHook(() => useGroupOrder('p', ['a', 'b', 'c', 'd']))
    act(() => { result.current.reorder(3, 1) })
    expect(result.current.orderedIds).toEqual(['a', 'd', 'b', 'c'])
  })

  it('updates ordering when defaults change to include a new id', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useGroupOrder('p', ids),
      { initialProps: { ids: ['a', 'b'] } },
    )
    rerender({ ids: ['a', 'b', 'c'] })
    expect(result.current.orderedIds).toEqual(['a', 'b', 'c'])
  })

  it('removes ids from state when they disappear from defaults', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useGroupOrder('p', ids),
      { initialProps: { ids: ['a', 'b', 'c'] } },
    )
    rerender({ ids: ['a', 'c'] })
    expect(result.current.orderedIds).toEqual(['a', 'c'])
  })

  it('does not rewrite storage on initial mount', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem')
    renderHook(() => useGroupOrder('p', ['a', 'b']))
    expect(spy).not.toHaveBeenCalledWith('om:group-order:p', expect.anything())
    spy.mockRestore()
  })
})
```

- [ ] **Step 2:** Run:

```bash
yarn jest packages/ui/src/backend/crud/__tests__/useGroupOrder.test.ts
```

Expected: PASS. If the "does not rewrite storage on initial mount" test fails, confirm the current hook behavior before relaxing the assertion (the hook guards writes behind a `mounted.current` ref; the test reflects that intent).

- [ ] **Step 3:** Commit:

```bash
git add packages/ui/src/backend/crud/__tests__/useGroupOrder.test.ts
git commit -m "test(ui): cover useGroupOrder hydration, reorder, and default drift"
```

---

## Phase 3 — Attachments route: `findWithDecryption`

### Task 7: Migrate `attachments/api/route.ts` off raw `em.find(... as any)`

**Files:**
- Modify: `packages/core/src/modules/attachments/api/route.ts:195-218` (add import, swap call, drop `as any`)

- [ ] **Step 1:** Add the import near the existing imports:

```ts
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
```

- [ ] **Step 2:** Replace the `em.find(Attachment, filter, { orderBy, ... })` call with `findWithDecryption`. Canonical pattern (from `packages/core/src/modules/customers/api/people/route.ts:224`):

```ts
const items = await findWithDecryption(
  em,
  Attachment,
  filter,
  {
    orderBy,
    ...(usePaging
      ? { limit: currentPageSize, offset: pageOffset }
      : {}),
  },
  {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  },
)
```

> Verify the context variable name (`ctx.auth`, `ctx.selectedOrganizationId`) against the actual handler signature at the top of the file before substituting — if the route resolves tenant/org differently, pass through the matching locals.

- [ ] **Step 3:** Drop `as any` on the resolve and `orderBy` — if the compiler complains, type `em` as `EntityManager` (`import type { EntityManager } from '@mikro-orm/core'`) and type the `orderBy` object with MikroORM's generic, or leave `em` resolved through the standard DI accessor instead of raw `resolve('em') as any`.

- [ ] **Step 4:** Type-check and run any attachments tests:

```bash
yarn tsc --noEmit -p packages/core/tsconfig.json
yarn jest packages/core/src/modules/attachments
```

Expected: no TS errors, existing tests still pass.

- [ ] **Step 5:** Commit:

```bash
git add packages/core/src/modules/attachments/api/route.ts
git commit -m "fix(attachments): use findWithDecryption + drop as any on orderBy"
```

---

## Phase 4 — Low-hanging cleanups

### Task 8: `console.warn` → structured logger in `entity-roles-factory.ts`

**Files:**
- Modify: `packages/core/src/modules/customers/api/entity-roles-factory.ts:129`

- [ ] **Step 1:** Replace:

```ts
console.warn('[customers.entity-roles-factory] rbacService resolve failed', err)
```

with:

```ts
console.error('[customers.entity-roles-factory] rbacService resolve failed', err)
```

Rationale: missing DI registration is a configuration bug that should surface in production error dashboards, not get silently filtered with warnings. Use `console.error` unless the module already resolves a structured logger; if it does, switch to that instead.

- [ ] **Step 2:** Run the file's unit tests:

```bash
yarn jest packages/core/src/modules/customers/api/__tests__
```

Expected: existing tests still pass.

- [ ] **Step 3:** Commit:

```bash
git add packages/core/src/modules/customers/api/entity-roles-factory.ts
git commit -m "fix(customers): surface missing rbacService as console.error"
```

### Task 9: aria-label audit on icon-only trigger buttons

**Files to audit:**
- `packages/core/src/modules/customers/components/detail/DealDetailHeader.tsx` (reviewer flagged lines ~127-139 stage/workflow selector)
- `packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx`
- `packages/core/src/modules/customers/components/detail/ScheduleActivityDialog.tsx`

> The exploration pass suggested all three files already carry `aria-label` on the icon-only buttons it found, but the reviewer specifically flagged the stage/workflow selector trigger in `DealDetailHeader.tsx:127-139`. **Do a fresh manual pass** on those exact line ranges — the reviewer is right and the explorer missed something, or the reviewer is wrong and the file is clean. Don't short-circuit the check.

- [ ] **Step 1:** Read each file and list every `<button>`, `<IconButton>`, or `<PopoverTrigger asChild><Button>` whose children are only a lucide icon (no visible text). For each, confirm `aria-label` is present.

- [ ] **Step 2:** For every button missing `aria-label`, add one wrapped with `t(...)`:

```tsx
<IconButton
  aria-label={t('customers.deal.changeStage', 'Change stage')}
  ...
>
  <ChevronDown className="size-4" />
</IconButton>
```

Add a matching i18n key per locale if the chosen key does not yet exist (follow Phase 1 alphabetical-order rule). Scope the key under an existing sub-namespace (`customers.deal.*`, `customers.company.*`, `customers.schedule.*`) that already lives in the four locale files.

- [ ] **Step 3:** Run existing component tests:

```bash
yarn jest packages/core/src/modules/customers/components/detail/__tests__
```

Expected: PASS (no new failures).

- [ ] **Step 4:** Commit:

```bash
git add packages/core/src/modules/customers/components/detail packages/core/src/modules/customers/i18n
git commit -m "a11y(customers): add aria-label to icon-only trigger buttons"
```

If no changes were needed, skip the commit and add a single-line note in the PR review reply.

---

## Phase 5 — Design System migration (bulk of the work)

Every task in this phase follows the **same sub-steps**, so they are spelled out once here and referenced by each task:

**Per-file sub-steps (applies to Tasks 10–22):**

- [ ] **Sub-step A:** Open the file and run `rg "text-\[|rounded-\[|size-\[|py?-\[|px-\[|#[0-9a-fA-F]{3,6}|text-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-|bg-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-" path/to/file.tsx` via the Grep tool (multi-regex OK, or split). Expect the count from the table at the top of this plan.

- [ ] **Sub-step B:** For each match, apply the mapping cheat-sheet. When a class encodes status semantics (error, success, warning, info), use status tokens; when it's decorative, use `muted`/`primary`/`foreground`/`background`.

- [ ] **Sub-step C:** If any hex becomes ambiguous (neither obviously status nor obviously foreground/background), leave a one-line `// TODO(ds-review): ...` comment on that line and surface it in the PR description so review can make the call. **Do not silently invent tokens.**

- [ ] **Sub-step D:** If the file displays status semantically (e.g. status pills, activity chips), migrate to `<StatusBadge>` with a `StatusMap<…>` per the AGENTS.md "Status Display" section instead of re-rendering with status tokens inline.

- [ ] **Sub-step E:** Re-run the grep from Sub-step A. Expect **zero matches** (except `text-[9px]` on the notification badge, if the file contains it).

- [ ] **Sub-step F:** Run the component's unit tests (or the closest shared test) and verify visually where possible:

```bash
yarn jest <path/to/component/__tests__>
```

- [ ] **Sub-step G:** Commit the file as its own commit:

```bash
git add <file>
git commit -m "style(customers): migrate <ComponentName> to DS tokens"
```

### Task 10: `packages/ui/src/primitives/avatar.tsx` (1 violation — warm-up)

**Files:** `packages/ui/src/primitives/avatar.tsx`

Follow sub-steps A–G.

### Task 11: `CompanyDetailHeader.tsx` (5 violations)

**Files:** `packages/core/src/modules/customers/components/detail/CompanyDetailHeader.tsx`

Follow sub-steps A–G.

### Task 12: `DealDetailHeader.tsx` (7 violations)

**Files:** `packages/core/src/modules/customers/components/detail/DealDetailHeader.tsx`

Follow sub-steps A–G. If this file also needs aria-labels from Task 9, batch them into this same commit.

### Task 13: `DealLinkedEntitiesTab.tsx` (7 violations)

**Files:** `packages/core/src/modules/customers/components/detail/DealLinkedEntitiesTab.tsx`

Follow sub-steps A–G.

### Task 14: `PersonDetailHeader.tsx` (10 violations, incl. `bg-yellow-100`/`text-yellow-800`)

**Files:** `packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx`

The yellow pair **must** become `bg-status-warning-bg` / `text-status-warning-text` — that's the whole reason status tokens exist. Follow sub-steps A–G.

### Task 15: `AssignRoleDialog.tsx` (14 violations)

**Files:** `packages/core/src/modules/customers/components/detail/AssignRoleDialog.tsx`

Follow sub-steps A–G.

### Task 16: `ScheduleActivityDialog.tsx` (19 violations)

**Files:** `packages/core/src/modules/customers/components/detail/ScheduleActivityDialog.tsx`

Follow sub-steps A–G.

### Task 17: `companyAdapter.tsx` (24 violations)

**Files:** `packages/core/src/modules/customers/components/linking/adapters/companyAdapter.tsx`

Follow sub-steps A–G.

### Task 18: `personAdapter.tsx` (26 violations, incl. `#c7eb54`/`#101828`)

**Files:** `packages/core/src/modules/customers/components/linking/adapters/personAdapter.tsx`

Follow sub-steps A–G. For `#c7eb54` (lime brand chip) use `bg-primary` + `text-primary-foreground`. For `#101828` use `text-foreground`.

### Task 19: `dealAdapter.tsx` (29 violations)

**Files:** `packages/core/src/modules/customers/components/linking/adapters/dealAdapter.tsx`

Follow sub-steps A–G.

### Task 20: `EntityTagsDialog.tsx` (30 violations)

**Files:** `packages/core/src/modules/customers/components/detail/EntityTagsDialog.tsx`

Follow sub-steps A–G.

### Task 21: `LinkEntityDialog.tsx` (36 violations)

**Files:** `packages/core/src/modules/customers/components/linking/LinkEntityDialog.tsx`

Follow sub-steps A–G.

### Task 22: `ManageTagsDialog.tsx` (62 violations — biggest)

**Files:** `packages/core/src/modules/customers/components/detail/ManageTagsDialog.tsx`

Follow sub-steps A–G. Given the size, split this into two commits if helpful: one for radius/spacing, one for colors/typography — but still land both before the next phase.

### Task 23: Repository-wide DS sweep (safety net)

- [ ] **Step 1:** Re-run the master grep over **all** files this PR touches to confirm nothing was missed:

```bash
```

Use Grep tool on the diff scope:
- pattern: `text-\[\d+px\]|rounded-\[\d+px\]|size-\[\d+px\]|#[0-9a-fA-F]{6}\b|text-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-\d+|bg-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-\d+`
- path: `packages/core/src/modules/customers/components packages/ui/src/primitives/avatar.tsx`

Expected: zero hits (except `text-[9px]` on notification badge).

- [ ] **Step 2:** If there are stragglers outside the 13 flagged files but inside the PR diff (Boy Scout rule), migrate them too and append to the most recent DS commit.

- [ ] **Step 3:** Run the full customers component test suite:

```bash
yarn jest packages/core/src/modules/customers/components
```

Expected: PASS.

---

## Phase 6 — Docs

### Task 24: Expand `RELEASE_NOTES.md`

**Files:**
- Modify: `RELEASE_NOTES.md` (prepend new section above the current v0.4.3 entry, or append to it if this branch targets the same release)

Reviewer asks for 2–3 bullets covering the branch's scope. Required bullets (use as-is or reword tightly):

```markdown
### CRM detail screens revamp

- **New detail pages for people, companies, and deals** with collapsible and reorderable CrudForm groups, per-user group/zone persistence, and inline activity composer (SPEC-072).
- **Entity roles, per-user labels, and person–company links** now first-class: new CRUD APIs, RBAC features (`customers.roles.view`, `customers.roles.manage`), and injection spots; defaults seeded in `setup.ts`.
- **NotesSection pagination** plus backfill of `actionLog` projections — existing public API signatures unchanged, all additions are additive.
```

- [ ] **Step 1:** Pick the correct release header. If v0.4.3 is the current in-flight release and this branch ships inside it, add the bullets under v0.4.3. Otherwise start a new `# Release Notes - Open Mercato v0.4.4` section above it with today's date `2026-04-21`.

- [ ] **Step 2:** Commit:

```bash
git add RELEASE_NOTES.md
git commit -m "docs: expand release notes with CRM detail screens entry"
```

### Task 25: Spec revision history

**Files:**
- Modify: `.ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md`

> **Important nuance:** the exploration agent found that **no other spec in `.ai/specs/` uses a "Revision History" block** — the repo convention is a metadata table at the top. Despite that, the reviewer explicitly asked for "a top-of-file Revision History block listing version/date/summary so downstream readers can see what changed across the CR iterations." Satisfy the reviewer. Adding one doesn't break the metadata-table convention (it lives alongside it), and it earns the Low finding sign-off.

- [ ] **Step 1:** Directly under the existing metadata block (before the TLDR), insert:

```markdown
## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | 2026-04-06 | Initial spec: collapsible groups, zone collapse, inline composer, roles, pipeline stepper, closure flow, WCAG 2.1 AA. |
| 1.1 | 2026-04-12 | Added Enhancements 6–8 (dashboard widgets, AI action chips, per-user labels, dictionary kind settings, person-company roles UI, decision-makers footer, mini week calendar, entity-scoped tag dialogs, activity log tab, changelog tab) during implementation. |
| 1.2 | 2026-04-21 | Addressed CR 5 feedback: DS token migration, hook unit tests, i18n wrapping in new API errors, `findWithDecryption` on attachments route. |
```

Confirm the dates against git history for the spec file (`git log -- .ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md`) and correct any mismatches before committing.

- [ ] **Step 2:** Commit:

```bash
git add .ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md
git commit -m "docs(spec): add revision history to SPEC-072"
```

### Task 26: Boy-Scout scan of `customers/cli.ts`

**Files:**
- `packages/core/src/modules/customers/cli.ts`

Reviewer flagged raw `em.findOne`/`em.find` use for seeding (Low #8 style). The findings note: "No isolation issue — flag only for consistency with encryption helpers if any of those entities gain encrypted fields later."

- [ ] **Step 1:** Read the file. If **none** of the entities seeded there currently have encrypted fields, leave a single-line comment at the top of each seeding section:

```ts
// Uses raw em.find/em.findOne — entities below have no encrypted fields as of this commit.
// Migrate to findWithDecryption when any of them gain an @Encrypted column.
```

- [ ] **Step 2:** If any of the entities already have encrypted fields (check `packages/core/src/modules/customers/data/entities.ts` for `@Encrypted` or equivalent decorators), switch those specific lookups to `findOneWithDecryption`/`findWithDecryption` using the same pattern as Phase 3.

- [ ] **Step 3:** Commit (only if something changed):

```bash
git add packages/core/src/modules/customers/cli.ts
git commit -m "chore(customers): document raw em.find in cli seeder"
```

---

## Phase 7 — Validation gate

### Task 27: Full validation sweep before re-review request

- [ ] **Step 1:** Typecheck:

```bash
yarn build:packages
```

Expected: success.

- [ ] **Step 2:** Lint:

```bash
yarn lint
```

Expected: zero new warnings or errors on touched files.

- [ ] **Step 3:** Unit tests:

```bash
yarn test
```

Expected: all suites green.

- [ ] **Step 4:** Re-run the master DS grep over the customers module to confirm **zero** regressions:

Use Grep tool:
- pattern: `text-\[(?!9px)\d+px\]|rounded-\[\d+px\]|size-\[\d+px\]|#[0-9a-fA-F]{6}\b|text-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-\d+|bg-(red|green|blue|amber|emerald|yellow|orange|purple|pink|rose|slate|gray|zinc|neutral|stone)-\d+`
- path: `packages/core/src/modules/customers/components`

Expected: zero results (except `text-[9px]` in notification badge).

- [ ] **Step 5:** Re-run the hardcoded-English grep:

Use Grep tool:
- pattern: `NextResponse\.json\(\s*\{\s*error:\s*['\"\`](Failed to|Validation failed|Internal server error|Organization context)`
- path: `packages/core/src/modules/customers/api`

Expected: zero matches.

- [ ] **Step 6:** Push and re-request review:

```bash
git push
gh pr comment --body "Addressed all Medium/Low findings from CR 5. Summary of changes in the commits above. Ready for re-review."
```

---

## Phase 8 — Self-review checklist (run before Step 6 of Task 27)

Run through this list yourself. Do not ask the user to do it.

- [ ] Medium #1 (DS tokens): every one of the 13 flagged files shows zero matches under the Task 27 master grep.
- [ ] Medium #2 (hook tests): 4 new test files exist under `packages/ui/src/backend/crud/__tests__/` and all pass.
- [ ] Medium #3 (i18n): every catch-block string listed in Task 2 now goes through `translate()`, and 8 new keys live in all 4 locale JSON files in alphabetical order.
- [ ] Medium #4 (attachments): `em.find(Attachment, ... as any)` is gone; `findWithDecryption` is in; `orderBy` is typed (no `as any`).
- [ ] Low #5 (logger): `entity-roles-factory.ts:129` uses `console.error` (or the structured logger), not `console.warn`.
- [ ] Low #6 (aria-label): every icon-only trigger in the three flagged files has `aria-label`.
- [ ] Low #7 (release notes): 2–3 bullets on CRM detail screens, entity roles/labels/links, and NotesSection pagination / actionLog backfill.
- [ ] Low #8 (revision history): SPEC-072 has a `## Revision History` table with at least 3 rows.
- [ ] Full lint + test + build gates green.
- [ ] BC contract: no removed exports, no renamed events/features/spots, no dropped columns in any new migration `up()` method. (All changes in this PR are additive — plan modifies code/docs only, not schema.)

When every box is ticked, the PR is ready for re-review.
