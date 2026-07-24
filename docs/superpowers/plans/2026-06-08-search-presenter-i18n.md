# Search Presenter i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cmd+K / global-search result strings (presenter title/subtitle/badge, link labels, and entity-type group headings) render in the requester's locale across all search strategies, and migrate the four un-translated modules off hard-coded English literals.

**Architecture:** Two independent fixes. (1) **Server-side**: flip the presenter-enrichment gate so any result whose entity has a registered `search.ts` config is re-rendered at request time (locale = requester's), instead of shipping the worker's frozen English presenter. Each module's `buildSource`/`formatResult` already calls `resolveTranslations()` internally, so the locale flows automatically once the gate runs. (2) **Client-side**: the entity-type group headings (`formatEntityId`, duplicated in 3 components) move to a shared helper that resolves `search.entityType.<module>.<entity>` keys with the humanized string as fallback. All new i18n keys land with real `en`/`pl`/`es`/`de` copy.

**Tech Stack:** TypeScript, MikroORM/Kysely (search), Jest, React (search dialog), the project i18n system (`resolveTranslations` server-side, `useT` client-side).

**Spec:** `.ai/specs/2026-05-20-search-presenter-i18n.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/search/src/lib/presenter-enricher.ts` | Owns the `shouldEnrich` decision (config-aware gate); re-renders presenters at request time. |
| `packages/search/src/service.ts` | Drops its pre-enrichment short-circuit; always delegates to the self-gating enricher. |
| `packages/shared/src/lib/i18n/server.ts` | Memoizes `loadDictionary(locale)` so the now-more-frequent `resolveTranslations()` calls don't re-flatten every module dictionary per result. |
| `packages/core/src/modules/{messages,inbox_ops}/search.ts`, `packages/checkout/src/modules/checkout/search.ts`, `packages/core/src/modules/customers/search.ts` | Replace hard-coded English literals with `t(key, fallback)` following the `sales/search.ts` pattern. |
| `…/{messages,inbox_ops,customers}/i18n/{en,pl,es,de}.json`, `packages/checkout/src/modules/checkout/i18n/{en,pl,es,de}.json` | New `<module>.search.*` keys with real copy. |
| `packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts` (new) | Shared `formatEntityId` + `resolveEntityTypeLabel(t, entityId)`; removes the 3× duplication. |
| `…/search/frontend/components/{GlobalSearchDialog,HybridSearchTable,TopbarSearchInline}.tsx` | Use the shared helper for the group heading. |
| `packages/search/src/modules/search/i18n/{en,pl,es,de}.json` | ~45 `search.entityType.*` keys with real copy. |
| `packages/search/src/__tests__/presenter-enricher.test.ts` | New cases for the config-aware gate. |
| `packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts` (new) | Helper unit tests. |

---

## Task 1: Config-aware enrichment gate

Today `needsSearchResultEnrichment` returns `false` when a result already has a stored presenter, so fulltext/vector results ship the worker's frozen English presenter. We add a `shouldEnrich` predicate that also returns `true` when the entity has a registered config, and we remove the service-level short-circuit that would otherwise skip the enricher entirely.

**Files:**
- Modify: `packages/search/src/lib/presenter-enricher.ts` (lines ~205-291)
- Modify: `packages/search/src/service.ts:144-156`
- Test: `packages/search/src/__tests__/presenter-enricher.test.ts`

- [ ] **Step 1: Write the failing test**

Read the existing test setup in `packages/search/src/__tests__/presenter-enricher.test.ts` (the `createPresenterEnricher` describe block, the in-memory `db` mock, and `entityConfigMap` fixtures already used by the first two cases). Add this case inside the existing `describe('createPresenterEnricher', …)`:

```typescript
it('re-renders a result that already has a stored presenter when the entity has a config', async () => {
  const formatResult = jest.fn(async () => ({ title: 'Fresh Title', badge: 'Fresh' }))
  const entityConfigMap = new Map<EntityId, SearchEntityConfig>([
    ['customers:customer_person_profile' as EntityId, { entityId: 'customers:customer_person_profile', enabled: true, formatResult } as any],
  ])
  const db = makeDbReturning([
    { entity_type: 'customers:customer_person_profile', entity_id: 'rec-1', doc: { id: 'rec-1', display_name: 'Ada' } },
  ])

  const enrich = createPresenterEnricher(db as any, entityConfigMap)
  const results: SearchResult[] = [{
    entityId: 'customers:customer_person_profile' as EntityId,
    recordId: 'rec-1',
    score: 1,
    source: 'fulltext',
    presenter: { title: 'Stale English Title' },
    url: '/x',
  }]

  const [enriched] = await enrich(results, 'tenant-1', null)

  expect(formatResult).toHaveBeenCalledTimes(1)
  expect(enriched.presenter?.title).toBe('Fresh Title')
})

it('keeps the stored presenter when the entity has no config', async () => {
  const db = makeDbReturning([])
  const enrich = createPresenterEnricher(db as any, new Map(), undefined)
  const results: SearchResult[] = [{
    entityId: 'unknown:thing' as EntityId,
    recordId: 'rec-9',
    score: 1,
    source: 'fulltext',
    presenter: { title: 'Stored' },
    url: '/y',
  }]

  const [enriched] = await enrich(results, 'tenant-1', null)
  expect(enriched.presenter?.title).toBe('Stored')
})
```

If a `makeDbReturning` helper does not already exist in the file, add this above the describe block (mirror the shape the existing tests build — a Kysely-like chainable mock whose `.execute()` resolves to the given rows):

```typescript
function makeDbReturning(rows: Array<{ entity_type: string; entity_id: string; doc: Record<string, unknown> }>) {
  const chain: any = {
    selectFrom: () => chain,
    select: () => chain,
    where: () => chain,
    execute: async () => rows,
  }
  return chain
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest packages/search/src/__tests__/presenter-enricher.test.ts -t "re-renders a result that already has a stored presenter"`
Expected: FAIL — `formatResult` is called 0 times (the stored presenter short-circuits the gate), so `enriched.presenter?.title` is still `'Stale English Title'`.

- [ ] **Step 3: Add the `shouldEnrich` predicate in the enricher**

In `packages/search/src/lib/presenter-enricher.ts`, inside the function returned by `createPresenterEnricher` (right after the `return async (results, tenantId, organizationId) => {` line), add:

```typescript
    const shouldEnrich = (result: SearchResult): boolean =>
      needsSearchResultEnrichment(result) || entityConfigMap.has(result.entityId as EntityId)
```

Then replace the two existing gate call sites:

```typescript
// line ~207 — was: const missingResults = results.filter(needsSearchResultEnrichment)
const missingResults = results.filter(shouldEnrich)
```

```typescript
// line ~288 — was: if (!needsSearchResultEnrichment(result)) return result
if (!shouldEnrich(result)) return result
```

Leave the rest of the function unchanged. The existing `enriched.presenter ?? result.presenter` line already preserves the stored presenter as the fallback when recompute returns null.

- [ ] **Step 4: Drop the service-level short-circuit**

In `packages/search/src/service.ts`, the `enrichResultsWithPresenter` method currently skips the enricher when no result "needs" enrichment by the old definition. The enricher now self-gates (it early-returns when `missingResults.length === 0`), so remove the stale gate. Replace lines 144-156:

```typescript
  private async enrichResultsWithPresenter(
    results: SearchResult[],
    tenantId: string,
    organizationId?: string | null,
  ): Promise<SearchResult[]> {
    // If no enricher configured, return as-is
    if (!this.presenterEnricher) return results

    // The enricher self-gates (config-aware) and early-returns when there is
    // nothing to enrich, so always delegate.
    try {
      return await this.presenterEnricher(results, tenantId, organizationId)
    } catch {
      // Enrichment failed, return results as-is
      return results
    }
  }
```

Then remove the now-unused import at the top of `service.ts`:

```typescript
// delete: import { needsSearchResultEnrichment } from './lib/search-result-enrichment'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn jest packages/search/src/__tests__/presenter-enricher.test.ts`
Expected: PASS — all cases, including the two new ones and the pre-existing two.

- [ ] **Step 6: Typecheck the search package**

Run: `yarn workspace @open-mercato/search typecheck` (or `yarn typecheck` if no per-package script)
Expected: no errors. In particular confirm `service.ts` has no unused-import error.

- [ ] **Step 7: Commit**

```bash
git add packages/search/src/lib/presenter-enricher.ts packages/search/src/service.ts packages/search/src/__tests__/presenter-enricher.test.ts
git commit -m "fix(search): re-render presenters at request time for configured entities (#327)"
```

---

## Task 2: Memoize dictionary loading

The gate flip means every matched result re-invokes its module's `buildSource`/`formatResult`, each of which calls `resolveTranslations()` → `loadDictionary(locale)`, which re-flattens **every** module's dictionary on every call. For a 20-result search that is 20-40 full dictionary flattens. Memoize per locale. Cache key includes the module count so dynamic registration in tests/boot busts it safely.

**Files:**
- Modify: `packages/shared/src/lib/i18n/server.ts`
- Test: `packages/shared/src/lib/i18n/__tests__/server-dictionary-cache.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/lib/i18n/__tests__/server-dictionary-cache.test.ts`:

```typescript
import { loadDictionary } from '../server'
import { registerModules } from '../../modules/registry'

describe('loadDictionary memoization', () => {
  it('returns a cached dictionary for repeated calls with the same locale', async () => {
    registerModules([
      { id: 'demo', translations: { en: { 'demo.hello': 'Hello' } } } as any,
    ])

    const first = await loadDictionary('en')
    const second = await loadDictionary('en')

    expect(second).toBe(first) // same object reference => cache hit
    expect(first['demo.hello']).toBe('Hello')
  })

  it('busts the cache when the registered module set changes', async () => {
    registerModules([{ id: 'a', translations: { en: { 'a.k': 'A' } } } as any])
    const before = await loadDictionary('en')

    registerModules([
      { id: 'a', translations: { en: { 'a.k': 'A' } } } as any,
      { id: 'b', translations: { en: { 'b.k': 'B' } } } as any,
    ])
    const after = await loadDictionary('en')

    expect(after).not.toBe(before)
    expect(after['b.k']).toBe('B')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest packages/shared/src/lib/i18n/__tests__/server-dictionary-cache.test.ts`
Expected: FAIL on `expect(second).toBe(first)` — each call currently builds a fresh object.

- [ ] **Step 3: Add the memo to `loadDictionary`**

In `packages/shared/src/lib/i18n/server.ts`, replace the existing `loadDictionary` with:

```typescript
const dictionaryCache = new Map<string, Dict>()

export async function loadDictionary(locale: Locale): Promise<Dict> {
  const modules = getModules()
  const cacheKey = `${locale}:${modules.length}`
  const cached = dictionaryCache.get(cacheKey)
  if (cached) return cached

  // Load from registry instead of @/ import (works in standalone packages)
  const baseRaw = await loadAppDictionary(locale)
  const merged: Dict = { ...flattenDictionary(baseRaw) }
  for (const m of modules) {
    const dict = m.translations?.[locale]
    if (dict) Object.assign(merged, flattenDictionary(dict))
  }
  dictionaryCache.set(cacheKey, merged)
  return merged
}
```

Note: keep the `getModules()` call before computing the key so the count is read once and reused. The cache key changing with `modules.length` means registering a different module set (boot, tests) produces a fresh dictionary; within a request the count is stable, so all per-result calls hit the cache.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn jest packages/shared/src/lib/i18n/__tests__/server-dictionary-cache.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run the broader i18n test suite to confirm no regression**

Run: `yarn jest packages/shared/src/lib/i18n`
Expected: PASS — no existing test depends on `loadDictionary` returning a fresh object each call.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/lib/i18n/server.ts packages/shared/src/lib/i18n/__tests__/server-dictionary-cache.test.ts
git commit -m "perf(i18n): memoize loadDictionary per locale (#327)"
```

---

## Task 3: Migrate `messages/search.ts`

Smallest delta. Follow the `sales/search.ts` pattern: helper takes a `translate` arg; `buildSource`/`formatResult` call `resolveTranslations()` and pass `t`.

**Files:**
- Modify: `packages/core/src/modules/messages/search.ts`
- Modify: `packages/core/src/modules/messages/i18n/{en,pl,es,de}.json`

- [ ] **Step 1: Add imports and thread the translator**

At the top of `packages/core/src/modules/messages/search.ts` add (matching `sales/search.ts:2-3`):

```typescript
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
```

Change `buildMessagePresenter` (around line 34) to accept the translator and use keys:

```typescript
function buildMessagePresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title = pickString(record.subject) ?? translate('messages.search.fallback.title', 'Message')
  const body = snippet(record.body)
  const externalName = pickString(record.external_name, record.externalName)
  const subtitle = [externalName, body].filter(Boolean).join(' · ') || undefined
  return {
    title: String(title),
    subtitle,
    icon: 'mail',
    badge: translate('messages.search.badge.message', 'Message'),
  }
}
```

- [ ] **Step 2: Update the call site(s)**

Find every call to `buildMessagePresenter(` in the file (it is invoked from the entity's `formatResult` and/or `buildSource`). At each, resolve translations first and pass `t`:

```typescript
formatResult: async (ctx) => {
  const { t } = await resolveTranslations()
  return buildMessagePresenter(t, ctx.record)
},
```

If `buildSource` also embeds the presenter, do the same there. (Confirm by reading the `messages:message` entity block; apply the `const { t } = await resolveTranslations()` + pass-through to every `buildMessagePresenter` call.)

- [ ] **Step 3: Add i18n keys (all four locales)**

`packages/core/src/modules/messages/i18n/en.json` — add:

```json
"messages.search.badge.message": "Message",
"messages.search.fallback.title": "Message"
```

`pl.json`:

```json
"messages.search.badge.message": "Wiadomość",
"messages.search.fallback.title": "Wiadomość"
```

`es.json`:

```json
"messages.search.badge.message": "Mensaje",
"messages.search.fallback.title": "Mensaje"
```

`de.json`:

```json
"messages.search.badge.message": "Nachricht",
"messages.search.fallback.title": "Nachricht"
```

(Insert in alphabetical position; keep the existing JSON valid — watch trailing commas.)

- [ ] **Step 4: Regenerate and typecheck**

Run: `yarn generate && yarn workspace @open-mercato/core typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/messages/search.ts packages/core/src/modules/messages/i18n
git commit -m "i18n(messages): translate search presenter strings (#327)"
```

---

## Task 4: Migrate `checkout/search.ts`

Two occurrences of `subtitle: 'Link Template'` (in `buildSource` and `formatResult`).

**Files:**
- Modify: `packages/checkout/src/modules/checkout/search.ts`
- Modify/Create: `packages/checkout/src/modules/checkout/i18n/{en,pl,es,de}.json`

- [ ] **Step 1: Add the import**

At the top of `packages/checkout/src/modules/checkout/search.ts`:

```typescript
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
```

- [ ] **Step 2: Replace both literals**

Update the `buildSource` and `formatResult` for `CHECKOUT_ENTITY_IDS.template` (around lines 37-46):

```typescript
buildSource: async (ctx) => {
  const { t } = await resolveTranslations()
  const linkTemplate = t('checkout.search.subtitle.linkTemplate', 'Link Template')
  return {
    text: [`${asSearchText(ctx.record.name)}: ${asSearchText(ctx.record.title)}`],
    presenter: { title: asSearchText(ctx.record.name), subtitle: linkTemplate },
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
},
formatResult: async (ctx) => {
  const { t } = await resolveTranslations()
  return {
    title: asSearchText(ctx.record.name),
    subtitle: t('checkout.search.subtitle.linkTemplate', 'Link Template'),
    icon: 'lucide:file-text',
  }
},
```

- [ ] **Step 3: Add i18n keys (all four locales)**

If `packages/checkout/src/modules/checkout/i18n/{en,pl,es,de}.json` do not exist, create each as a JSON object `{}` first, then add the key. Use the existing checkout i18n files if present.

- en: `"checkout.search.subtitle.linkTemplate": "Link Template"`
- pl: `"checkout.search.subtitle.linkTemplate": "Szablon linku"`
- es: `"checkout.search.subtitle.linkTemplate": "Plantilla de enlace"`
- de: `"checkout.search.subtitle.linkTemplate": "Link-Vorlage"`

- [ ] **Step 4: Regenerate and typecheck**

Run: `yarn generate && yarn workspace @open-mercato/checkout typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/checkout/src/modules/checkout/search.ts packages/checkout/src/modules/checkout/i18n
git commit -m "i18n(checkout): translate search subtitle (#327)"
```

---

## Task 5: Migrate `inbox_ops/search.ts`

Title fallback `'Inbox Proposal'` plus a `Confidence: … - Status: … - Category: …` subtitle template, duplicated across `buildSource` and `formatResult`. Use interpolation params; pick the with/without-category key based on presence.

**Files:**
- Modify: `packages/core/src/modules/inbox_ops/search.ts`
- Modify/Create: `packages/core/src/modules/inbox_ops/i18n/{en,pl,es,de}.json`

- [ ] **Step 1: Add the import**

```typescript
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
```

- [ ] **Step 2: Replace the literals in `buildSource`**

Update the presenter block (around lines 40-44):

```typescript
const { t } = await resolveTranslations()
const confidence = String(record.confidence ?? '')
const status = String(record.status ?? '')
const category = record.category ? String(record.category) : ''
const subtitle = category
  ? t('inbox_ops.search.subtitle.templateWithCategory', 'Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}', { confidence, status, category })
  : t('inbox_ops.search.subtitle.template', 'Confidence: {{confidence}} · Status: {{status}}', { confidence, status })

return {
  text: String(record.summary || ''),
  fields: {
    status: record.status,
    confidence: record.confidence,
    category: record.category,
    detected_language: record.detected_language,
  },
  presenter: {
    title: String(record.summary || t('inbox_ops.search.fallback.title', 'Inbox Proposal')).slice(0, 80),
    subtitle,
    icon: 'inbox',
  },
  checksumSource: {
    summary: record.summary,
    status: record.status,
    confidence: record.confidence,
    category: record.category,
    detectedLanguage: record.detected_language,
  },
}
```

- [ ] **Step 3: Replace the literals in `formatResult`**

```typescript
formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
  const { t } = await resolveTranslations()
  const confidence = String(ctx.record.confidence ?? '')
  const status = String(ctx.record.status ?? '')
  const category = ctx.record.category ? String(ctx.record.category) : ''
  const subtitle = category
    ? t('inbox_ops.search.subtitle.templateWithCategory', 'Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}', { confidence, status, category })
    : t('inbox_ops.search.subtitle.template', 'Confidence: {{confidence}} · Status: {{status}}', { confidence, status })
  return {
    title: String(ctx.record.summary || t('inbox_ops.search.fallback.title', 'Inbox Proposal')).slice(0, 80),
    subtitle,
    icon: 'inbox',
  }
},
```

- [ ] **Step 4: Add i18n keys (all four locales)**

en:
```json
"inbox_ops.search.fallback.title": "Inbox Proposal",
"inbox_ops.search.subtitle.template": "Confidence: {{confidence}} · Status: {{status}}",
"inbox_ops.search.subtitle.templateWithCategory": "Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}"
```
pl:
```json
"inbox_ops.search.fallback.title": "Propozycja skrzynki",
"inbox_ops.search.subtitle.template": "Pewność: {{confidence}} · Status: {{status}}",
"inbox_ops.search.subtitle.templateWithCategory": "Pewność: {{confidence}} · Status: {{status}} · Kategoria: {{category}}"
```
es:
```json
"inbox_ops.search.fallback.title": "Propuesta de bandeja",
"inbox_ops.search.subtitle.template": "Confianza: {{confidence}} · Estado: {{status}}",
"inbox_ops.search.subtitle.templateWithCategory": "Confianza: {{confidence}} · Estado: {{status}} · Categoría: {{category}}"
```
de:
```json
"inbox_ops.search.fallback.title": "Posteingang-Vorschlag",
"inbox_ops.search.subtitle.template": "Konfidenz: {{confidence}} · Status: {{status}}",
"inbox_ops.search.subtitle.templateWithCategory": "Konfidenz: {{confidence}} · Status: {{status}} · Kategorie: {{category}}"
```

- [ ] **Step 5: Regenerate and typecheck**

Run: `yarn generate && yarn workspace @open-mercato/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/inbox_ops/search.ts packages/core/src/modules/inbox_ops/i18n
git commit -m "i18n(inbox_ops): translate search presenter strings (#327)"
```

---

## Task 6: Migrate `customers/search.ts`

Largest surface (~15 literals). Pattern: at the top of each `buildSource`/`formatResult` that emits a literal, add `const { t } = await resolveTranslations()` and replace per the table below. Where literals live in shared helper functions, add a `translate: TranslateFn` parameter (as `sales/search.ts` does) and pass `t` from each call site.

**Files:**
- Modify: `packages/core/src/modules/customers/search.ts`
- Modify: `packages/core/src/modules/customers/i18n/{en,pl,es,de}.json`

- [ ] **Step 1: Add imports**

```typescript
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
```

- [ ] **Step 2: Replace every literal per this mapping**

Use the line references from the spec's "Customers — literal inventory". Each row: replace the bare string with `t(key, fallback)` (the fallback is the current English literal). For badges/titles set inside a `buildSource`/`formatResult`, resolve `t` once at the top of that function. For the link-label literals that are emitted in `resolveLinks`/`buildSource`, resolve `t` in that same function.

| Current literal (site) | Replace with |
|---|---|
| `badge: … ? 'Person' : undefined` (`:514`) | `… ? t('customers.search.badge.person', 'Person') : undefined` |
| `badge: … ? 'Company' : undefined` (`:565`) | `… ? t('customers.search.badge.company', 'Company') : undefined` |
| `badge: 'Deal'` (`:893, :920`) | `badge: t('customers.search.badge.deal', 'Deal')` |
| `badge: 'Activity'` (`:991`) | `badge: t('customers.search.badge.activity', 'Activity')` |
| `'Open person'` (`:640`) | `t('customers.search.link.openPerson', 'Open person')` |
| `'Edit'` (`:678, :768, :936`) | `t('customers.search.link.edit', 'Edit')` |
| `'Open company'` (`:730`) | `t('customers.search.link.openCompany', 'Open company')` |
| `'View customer'` (`:847`) | `t('customers.search.link.viewCustomer', 'View customer')` |
| `'Open deal'` (`:851, :1007`) | `t('customers.search.link.openDeal', 'Open deal')` |
| `'Open todo'` (`:1075`) | `t('customers.search.link.openTodo', 'Open todo')` |
| `'Person'` title fallback (`:494`) | `t('customers.search.fallback.person', 'Person')` |
| `'Company'` title fallback (`:536`) | `t('customers.search.fallback.company', 'Company')` |
| `'Deal'` title fallback (`:890, :917`) | `t('customers.search.fallback.deal', 'Deal')` |
| `'Customer task'` title fallback (`:1057`) | `t('customers.search.fallback.customerTask', 'Customer task')` |

For the `:847` site, the existing logic falls back to the related customer's `display_name` before `'View customer'`; preserve that ordering — only the final literal becomes `t(...)`.

Line numbers will drift as you edit; treat them as anchors, and rely on the literal text + surrounding context to find each site. After editing, grep to confirm none remain (Step 4).

- [ ] **Step 3: Add i18n keys (all four locales)**

`en.json`:
```json
"customers.search.badge.person": "Person",
"customers.search.badge.company": "Company",
"customers.search.badge.deal": "Deal",
"customers.search.badge.activity": "Activity",
"customers.search.link.openPerson": "Open person",
"customers.search.link.openCompany": "Open company",
"customers.search.link.openDeal": "Open deal",
"customers.search.link.openTodo": "Open todo",
"customers.search.link.viewCustomer": "View customer",
"customers.search.link.edit": "Edit",
"customers.search.fallback.person": "Person",
"customers.search.fallback.company": "Company",
"customers.search.fallback.deal": "Deal",
"customers.search.fallback.customerTask": "Customer task"
```
`pl.json`:
```json
"customers.search.badge.person": "Osoba",
"customers.search.badge.company": "Firma",
"customers.search.badge.deal": "Szansa sprzedaży",
"customers.search.badge.activity": "Aktywność",
"customers.search.link.openPerson": "Otwórz osobę",
"customers.search.link.openCompany": "Otwórz firmę",
"customers.search.link.openDeal": "Otwórz szansę",
"customers.search.link.openTodo": "Otwórz zadanie",
"customers.search.link.viewCustomer": "Zobacz klienta",
"customers.search.link.edit": "Edytuj",
"customers.search.fallback.person": "Osoba",
"customers.search.fallback.company": "Firma",
"customers.search.fallback.deal": "Szansa sprzedaży",
"customers.search.fallback.customerTask": "Zadanie klienta"
```
`es.json`:
```json
"customers.search.badge.person": "Persona",
"customers.search.badge.company": "Empresa",
"customers.search.badge.deal": "Oportunidad",
"customers.search.badge.activity": "Actividad",
"customers.search.link.openPerson": "Abrir persona",
"customers.search.link.openCompany": "Abrir empresa",
"customers.search.link.openDeal": "Abrir oportunidad",
"customers.search.link.openTodo": "Abrir tarea",
"customers.search.link.viewCustomer": "Ver cliente",
"customers.search.link.edit": "Editar",
"customers.search.fallback.person": "Persona",
"customers.search.fallback.company": "Empresa",
"customers.search.fallback.deal": "Oportunidad",
"customers.search.fallback.customerTask": "Tarea del cliente"
```
`de.json`:
```json
"customers.search.badge.person": "Person",
"customers.search.badge.company": "Unternehmen",
"customers.search.badge.deal": "Deal",
"customers.search.badge.activity": "Aktivität",
"customers.search.link.openPerson": "Person öffnen",
"customers.search.link.openCompany": "Unternehmen öffnen",
"customers.search.link.openDeal": "Deal öffnen",
"customers.search.link.openTodo": "Aufgabe öffnen",
"customers.search.link.viewCustomer": "Kunde anzeigen",
"customers.search.link.edit": "Bearbeiten",
"customers.search.fallback.person": "Person",
"customers.search.fallback.company": "Unternehmen",
"customers.search.fallback.deal": "Deal",
"customers.search.fallback.customerTask": "Kundenaufgabe"
```

- [ ] **Step 4: Verify no literals remain**

Run: `grep -nE "'(Person|Company|Deal|Activity|Open person|Open company|Open deal|Open todo|View customer|Edit|Customer task)'" packages/core/src/modules/customers/search.ts`
Expected: no output (all migrated). If the icon-map or unrelated strings match, confirm they are not presenter/link literals.

- [ ] **Step 5: Regenerate and typecheck**

Run: `yarn generate && yarn workspace @open-mercato/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/customers/search.ts packages/core/src/modules/customers/i18n
git commit -m "i18n(customers): translate search presenter and link strings (#327)"
```

---

## Task 7: Shared entity-type label helper

`formatEntityId` + `humanizeSegment` are copy-pasted into three components. Extract a shared helper that also resolves the i18n key, then have all three components use it.

**Files:**
- Create: `packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts`
- Create: `packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts`
- Modify: `…/frontend/components/GlobalSearchDialog.tsx`, `HybridSearchTable.tsx`, `TopbarSearchInline.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts`:

```typescript
import { formatEntityId, resolveEntityTypeLabel } from '../entityTypeLabel'

describe('formatEntityId', () => {
  it('humanizes module · entity', () => {
    expect(formatEntityId('customers:customer_person_profile')).toBe('Customers · Customer Person Profile')
  })
  it('humanizes a bare segment', () => {
    expect(formatEntityId('messages')).toBe('Messages')
  })
})

describe('resolveEntityTypeLabel', () => {
  const t = (key: string, fallback?: string) =>
    key === 'search.entityType.sales.sales_order' ? 'Order' : (fallback as string)

  it('returns the translated label when a key exists', () => {
    expect(resolveEntityTypeLabel(t as any, 'sales:sales_order')).toBe('Order')
  })
  it('falls back to the humanized string for unknown entity types', () => {
    expect(resolveEntityTypeLabel(t as any, 'thirdparty:widget_thing')).toBe('Thirdparty · Widget Thing')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts`
Expected: FAIL — module `../entityTypeLabel` does not exist.

- [ ] **Step 3: Create the helper**

Create `packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts`:

```typescript
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

function humanizeSegment(segment: string): string {
  return segment
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatEntityId(entityId: string): string {
  if (!entityId.includes(':')) return humanizeSegment(entityId)
  const [module, entity] = entityId.split(':')
  return `${humanizeSegment(module)} · ${humanizeSegment(entity)}`
}

export function resolveEntityTypeLabel(t: TranslateFn, entityId: string): string {
  const fallback = formatEntityId(entityId)
  if (!entityId.includes(':')) return fallback
  const [module, entity] = entityId.split(':')
  return t(`search.entityType.${module}.${entity}`, fallback)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn jest packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in `GlobalSearchDialog.tsx`**

Delete the local `formatEntityId` (lines ~143-147) and the local `humanizeSegment` (lines ~90-96) **if they are not used elsewhere in the file** (grep first; `humanizeSegment` may back other call sites — only remove if unused). Add the import near the other lib imports:

```typescript
import { resolveEntityTypeLabel } from '../lib/entityTypeLabel'
```

The component already has `const t = useT()` (line ~173). Replace the heading render (line ~426) `{formatEntityId(result.entityId)}` with:

```typescript
{resolveEntityTypeLabel(t, result.entityId)}
```

- [ ] **Step 6: Use the helper in `HybridSearchTable.tsx`**

This component has `const t = useT()` at line ~239 and uses `formatEntityId(item.entityId)` at line ~63. The `t` is currently scoped inside the component function; ensure the render that calls `formatEntityId` is within that scope (it is, since it renders rows). Add the import, delete the local `formatEntityId`/`humanizeSegment` (line ~171, if unused elsewhere), and replace `formatEntityId(item.entityId)` with `resolveEntityTypeLabel(t, item.entityId)`.

```typescript
import { resolveEntityTypeLabel } from '../lib/entityTypeLabel'
// …
const typeLabel = resolveEntityTypeLabel(t, item.entityId)
```

- [ ] **Step 7: Use the helper in `TopbarSearchInline.tsx`**

Same: `const t = useT()` exists at line ~157; `formatEntityId(result.entityId)` at line ~498. Add the import, delete the local copies (line ~139, if unused), replace with `resolveEntityTypeLabel(t, result.entityId)`.

- [ ] **Step 8: Typecheck**

Run: `yarn workspace @open-mercato/search typecheck`
Expected: no errors (no orphaned `formatEntityId`/`humanizeSegment` references).

- [ ] **Step 9: Commit**

```bash
git add packages/search/src/modules/search/frontend/lib/entityTypeLabel.ts packages/search/src/modules/search/frontend/lib/__tests__/entityTypeLabel.test.ts packages/search/src/modules/search/frontend/components/GlobalSearchDialog.tsx packages/search/src/modules/search/frontend/components/HybridSearchTable.tsx packages/search/src/modules/search/frontend/components/TopbarSearchInline.tsx
git commit -m "refactor(search): shared entity-type heading helper with i18n (#327)"
```

---

## Task 8: `search.entityType.*` i18n keys

Add one key per indexed entity type to the search module's four locale files. Full enumerated set below (45 keys; `lucide:link` excluded).

**Files:**
- Modify: `packages/search/src/modules/search/i18n/{en,pl,es,de}.json`

- [ ] **Step 1: Add the keys to `en.json`**

Insert these keys (flat dotted form, matching the file's existing style; place in alphabetical position):

```json
"search.entityType.catalog.catalog_offer": "Offer",
"search.entityType.catalog.catalog_option_schema_template": "Option Template",
"search.entityType.catalog.catalog_price_kind": "Price Type",
"search.entityType.catalog.catalog_product": "Product",
"search.entityType.catalog.catalog_product_category": "Category",
"search.entityType.catalog.catalog_product_tag": "Tag",
"search.entityType.catalog.catalog_product_unit_conversion": "Unit Conversion",
"search.entityType.catalog.catalog_product_variant": "Variant",
"search.entityType.customer_accounts.customer_role": "Customer Role",
"search.entityType.customer_accounts.customer_user": "Customer User",
"search.entityType.customers.customer_activity": "Activity",
"search.entityType.customers.customer_comment": "Comment",
"search.entityType.customers.customer_company_profile": "Company",
"search.entityType.customers.customer_deal": "Deal",
"search.entityType.customers.customer_entity": "Customer",
"search.entityType.customers.customer_person_profile": "Person",
"search.entityType.customers.customer_todo_link": "Task",
"search.entityType.inbox_ops.inbox_proposal": "Inbox Proposal",
"search.entityType.messages.message": "Message",
"search.entityType.planner.planner_availability_rule_set": "Availability Rules",
"search.entityType.resources.resources_resource": "Resource",
"search.entityType.resources.resources_resource_type": "Resource Type",
"search.entityType.sales.sales_channel": "Channel",
"search.entityType.sales.sales_credit_memo": "Credit Memo",
"search.entityType.sales.sales_credit_memo_line": "Credit Memo Line",
"search.entityType.sales.sales_delivery_window": "Delivery Window",
"search.entityType.sales.sales_document_address": "Document Address",
"search.entityType.sales.sales_document_tag": "Document Tag",
"search.entityType.sales.sales_invoice": "Invoice",
"search.entityType.sales.sales_invoice_line": "Invoice Line",
"search.entityType.sales.sales_note": "Note",
"search.entityType.sales.sales_order": "Order",
"search.entityType.sales.sales_order_adjustment": "Order Adjustment",
"search.entityType.sales.sales_order_line": "Order Line",
"search.entityType.sales.sales_payment": "Payment",
"search.entityType.sales.sales_payment_allocation": "Payment Allocation",
"search.entityType.sales.sales_payment_method": "Payment Method",
"search.entityType.sales.sales_quote": "Quote",
"search.entityType.sales.sales_quote_adjustment": "Quote Adjustment",
"search.entityType.sales.sales_quote_line": "Quote Line",
"search.entityType.sales.sales_shipment": "Shipment",
"search.entityType.sales.sales_shipment_item": "Shipment Item",
"search.entityType.sales.sales_shipping_method": "Shipping Method",
"search.entityType.sales.sales_tax_rate": "Tax Rate",
"search.entityType.staff.staff_team": "Team",
"search.entityType.staff.staff_team_member": "Team Member",
"search.entityType.staff.staff_team_role": "Team Role"
```

- [ ] **Step 2: Add the keys to `pl.json`**

```json
"search.entityType.catalog.catalog_offer": "Oferta",
"search.entityType.catalog.catalog_option_schema_template": "Szablon opcji",
"search.entityType.catalog.catalog_price_kind": "Typ ceny",
"search.entityType.catalog.catalog_product": "Produkt",
"search.entityType.catalog.catalog_product_category": "Kategoria",
"search.entityType.catalog.catalog_product_tag": "Tag",
"search.entityType.catalog.catalog_product_unit_conversion": "Przelicznik jednostek",
"search.entityType.catalog.catalog_product_variant": "Wariant",
"search.entityType.customer_accounts.customer_role": "Rola klienta",
"search.entityType.customer_accounts.customer_user": "Użytkownik klienta",
"search.entityType.customers.customer_activity": "Aktywność",
"search.entityType.customers.customer_comment": "Komentarz",
"search.entityType.customers.customer_company_profile": "Firma",
"search.entityType.customers.customer_deal": "Szansa sprzedaży",
"search.entityType.customers.customer_entity": "Klient",
"search.entityType.customers.customer_person_profile": "Osoba",
"search.entityType.customers.customer_todo_link": "Zadanie",
"search.entityType.inbox_ops.inbox_proposal": "Propozycja skrzynki",
"search.entityType.messages.message": "Wiadomość",
"search.entityType.planner.planner_availability_rule_set": "Reguły dostępności",
"search.entityType.resources.resources_resource": "Zasób",
"search.entityType.resources.resources_resource_type": "Typ zasobu",
"search.entityType.sales.sales_channel": "Kanał",
"search.entityType.sales.sales_credit_memo": "Nota kredytowa",
"search.entityType.sales.sales_credit_memo_line": "Pozycja noty kredytowej",
"search.entityType.sales.sales_delivery_window": "Okno dostawy",
"search.entityType.sales.sales_document_address": "Adres dokumentu",
"search.entityType.sales.sales_document_tag": "Tag dokumentu",
"search.entityType.sales.sales_invoice": "Faktura",
"search.entityType.sales.sales_invoice_line": "Pozycja faktury",
"search.entityType.sales.sales_note": "Notatka",
"search.entityType.sales.sales_order": "Zamówienie",
"search.entityType.sales.sales_order_adjustment": "Korekta zamówienia",
"search.entityType.sales.sales_order_line": "Pozycja zamówienia",
"search.entityType.sales.sales_payment": "Płatność",
"search.entityType.sales.sales_payment_allocation": "Przypisanie płatności",
"search.entityType.sales.sales_payment_method": "Metoda płatności",
"search.entityType.sales.sales_quote": "Oferta",
"search.entityType.sales.sales_quote_adjustment": "Korekta oferty",
"search.entityType.sales.sales_quote_line": "Pozycja oferty",
"search.entityType.sales.sales_shipment": "Wysyłka",
"search.entityType.sales.sales_shipment_item": "Pozycja wysyłki",
"search.entityType.sales.sales_shipping_method": "Metoda wysyłki",
"search.entityType.sales.sales_tax_rate": "Stawka podatku",
"search.entityType.staff.staff_team": "Zespół",
"search.entityType.staff.staff_team_member": "Członek zespołu",
"search.entityType.staff.staff_team_role": "Rola w zespole"
```

- [ ] **Step 3: Add the keys to `es.json`**

```json
"search.entityType.catalog.catalog_offer": "Oferta",
"search.entityType.catalog.catalog_option_schema_template": "Plantilla de opciones",
"search.entityType.catalog.catalog_price_kind": "Tipo de precio",
"search.entityType.catalog.catalog_product": "Producto",
"search.entityType.catalog.catalog_product_category": "Categoría",
"search.entityType.catalog.catalog_product_tag": "Etiqueta",
"search.entityType.catalog.catalog_product_unit_conversion": "Conversión de unidades",
"search.entityType.catalog.catalog_product_variant": "Variante",
"search.entityType.customer_accounts.customer_role": "Rol de cliente",
"search.entityType.customer_accounts.customer_user": "Usuario de cliente",
"search.entityType.customers.customer_activity": "Actividad",
"search.entityType.customers.customer_comment": "Comentario",
"search.entityType.customers.customer_company_profile": "Empresa",
"search.entityType.customers.customer_deal": "Oportunidad",
"search.entityType.customers.customer_entity": "Cliente",
"search.entityType.customers.customer_person_profile": "Persona",
"search.entityType.customers.customer_todo_link": "Tarea",
"search.entityType.inbox_ops.inbox_proposal": "Propuesta de bandeja",
"search.entityType.messages.message": "Mensaje",
"search.entityType.planner.planner_availability_rule_set": "Reglas de disponibilidad",
"search.entityType.resources.resources_resource": "Recurso",
"search.entityType.resources.resources_resource_type": "Tipo de recurso",
"search.entityType.sales.sales_channel": "Canal",
"search.entityType.sales.sales_credit_memo": "Nota de crédito",
"search.entityType.sales.sales_credit_memo_line": "Línea de nota de crédito",
"search.entityType.sales.sales_delivery_window": "Ventana de entrega",
"search.entityType.sales.sales_document_address": "Dirección del documento",
"search.entityType.sales.sales_document_tag": "Etiqueta de documento",
"search.entityType.sales.sales_invoice": "Factura",
"search.entityType.sales.sales_invoice_line": "Línea de factura",
"search.entityType.sales.sales_note": "Nota",
"search.entityType.sales.sales_order": "Pedido",
"search.entityType.sales.sales_order_adjustment": "Ajuste de pedido",
"search.entityType.sales.sales_order_line": "Línea de pedido",
"search.entityType.sales.sales_payment": "Pago",
"search.entityType.sales.sales_payment_allocation": "Asignación de pago",
"search.entityType.sales.sales_payment_method": "Método de pago",
"search.entityType.sales.sales_quote": "Presupuesto",
"search.entityType.sales.sales_quote_adjustment": "Ajuste de presupuesto",
"search.entityType.sales.sales_quote_line": "Línea de presupuesto",
"search.entityType.sales.sales_shipment": "Envío",
"search.entityType.sales.sales_shipment_item": "Artículo de envío",
"search.entityType.sales.sales_shipping_method": "Método de envío",
"search.entityType.sales.sales_tax_rate": "Tasa de impuesto",
"search.entityType.staff.staff_team": "Equipo",
"search.entityType.staff.staff_team_member": "Miembro del equipo",
"search.entityType.staff.staff_team_role": "Rol del equipo"
```

- [ ] **Step 4: Add the keys to `de.json`**

```json
"search.entityType.catalog.catalog_offer": "Angebot",
"search.entityType.catalog.catalog_option_schema_template": "Optionsvorlage",
"search.entityType.catalog.catalog_price_kind": "Preistyp",
"search.entityType.catalog.catalog_product": "Produkt",
"search.entityType.catalog.catalog_product_category": "Kategorie",
"search.entityType.catalog.catalog_product_tag": "Tag",
"search.entityType.catalog.catalog_product_unit_conversion": "Einheitenumrechnung",
"search.entityType.catalog.catalog_product_variant": "Variante",
"search.entityType.customer_accounts.customer_role": "Kundenrolle",
"search.entityType.customer_accounts.customer_user": "Kundenbenutzer",
"search.entityType.customers.customer_activity": "Aktivität",
"search.entityType.customers.customer_comment": "Kommentar",
"search.entityType.customers.customer_company_profile": "Unternehmen",
"search.entityType.customers.customer_deal": "Deal",
"search.entityType.customers.customer_entity": "Kunde",
"search.entityType.customers.customer_person_profile": "Person",
"search.entityType.customers.customer_todo_link": "Aufgabe",
"search.entityType.inbox_ops.inbox_proposal": "Posteingang-Vorschlag",
"search.entityType.messages.message": "Nachricht",
"search.entityType.planner.planner_availability_rule_set": "Verfügbarkeitsregeln",
"search.entityType.resources.resources_resource": "Ressource",
"search.entityType.resources.resources_resource_type": "Ressourcentyp",
"search.entityType.sales.sales_channel": "Kanal",
"search.entityType.sales.sales_credit_memo": "Gutschrift",
"search.entityType.sales.sales_credit_memo_line": "Gutschriftsposition",
"search.entityType.sales.sales_delivery_window": "Lieferfenster",
"search.entityType.sales.sales_document_address": "Dokumentadresse",
"search.entityType.sales.sales_document_tag": "Dokument-Tag",
"search.entityType.sales.sales_invoice": "Rechnung",
"search.entityType.sales.sales_invoice_line": "Rechnungsposition",
"search.entityType.sales.sales_note": "Notiz",
"search.entityType.sales.sales_order": "Bestellung",
"search.entityType.sales.sales_order_adjustment": "Bestellanpassung",
"search.entityType.sales.sales_order_line": "Bestellposition",
"search.entityType.sales.sales_payment": "Zahlung",
"search.entityType.sales.sales_payment_allocation": "Zahlungszuordnung",
"search.entityType.sales.sales_payment_method": "Zahlungsmethode",
"search.entityType.sales.sales_quote": "Angebot",
"search.entityType.sales.sales_quote_adjustment": "Angebotsanpassung",
"search.entityType.sales.sales_quote_line": "Angebotsposition",
"search.entityType.sales.sales_shipment": "Sendung",
"search.entityType.sales.sales_shipment_item": "Sendungsposition",
"search.entityType.sales.sales_shipping_method": "Versandart",
"search.entityType.sales.sales_tax_rate": "Steuersatz",
"search.entityType.staff.staff_team": "Team",
"search.entityType.staff.staff_team_member": "Teammitglied",
"search.entityType.staff.staff_team_role": "Teamrolle"
```

- [ ] **Step 5: Validate JSON + regenerate**

Run: `node -e "for (const l of ['en','pl','es','de']) require('./packages/search/src/modules/search/i18n/'+l+'.json')" && yarn generate`
Expected: no JSON parse error; generation succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/search/src/modules/search/i18n
git commit -m "i18n(search): add entity-type heading translations (#327)"
```

---

## Task 9: Integration test + final verification

**Files:**
- Create/Modify: `packages/search/src/modules/search/api/__tests__/global-search.routes.test.ts`

- [ ] **Step 1: Write the integration test**

Check whether `packages/search/src/modules/search/api/__tests__/global-search.routes.test.ts` exists. If yes, extend it; if not, create it following the structure of the nearest existing API route test in the search module (look in `packages/search/src/modules/search/api/__tests__/` and `__integration__/`). The test must: seed one fulltext (or vector) result whose entity has a config, issue the global search with `Accept-Language: pl-PL`, and assert the returned `presenter.badge`/`title` is the Polish value (not English). Use the existing test harness's request helper rather than calling the route handler directly. Key assertion:

```typescript
const res = await callGlobalSearch({ query: 'ada', acceptLanguage: 'pl-PL' })
const personResult = res.results.find(r => r.entityId === 'customers:customer_person_profile')
expect(personResult?.presenter?.badge).toBe('Osoba')
```

If a request-locale harness does not exist in this package, document that gap in the PR description and rely on the Task 1 unit tests plus the manual smoke (Step 4) for locale propagation coverage — do not fabricate a passing test.

- [ ] **Step 2: Run the search package test suite**

Run: `yarn jest packages/search`
Expected: PASS.

- [ ] **Step 3: Run the i18n guards and full validation**

Run:
```bash
yarn i18n:check-hardcoded
yarn i18n:check-values
yarn generate
yarn build:packages
yarn lint
yarn test
```
Expected: `i18n:check-hardcoded` reports no new hardcoded search strings; `i18n:check-values` shows the new keys populated for pl/es/de; build, lint, and test all pass.

- [ ] **Step 4: Manual smoke (per `.ai/qa/AGENTS.md`)**

Switch operator locale to `pl` (and `de`), open Cmd+K, search seeded customers/sales/catalog data. Confirm across fulltext + vector + tokens strategies:
- Presenter badges and link labels render in the chosen locale.
- Entity-type group headings render the localized label (e.g. "Zamówienie", "Klient") in the dialog, the hybrid search table, and the topbar inline results.

- [ ] **Step 5: Commit any test additions**

```bash
git add packages/search/src/modules/search/api/__tests__/global-search.routes.test.ts
git commit -m "test(search): assert request-locale presenters in global search (#327)"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 → gate flip (`search-result-enrichment`/`presenter-enricher`/`service`). Task 2 → performance (`resolveTranslations`/`loadDictionary`). Tasks 3-6 → the four un-translated modules + real copy. Tasks 7-8 → entity-type headings (3 components + helper + `search.entityType.*`). Task 9 → testing strategy. All spec File-Manifest entries map to a task.
- **`needsSearchResultEnrichment` left unchanged:** the config-awareness is added as a local `shouldEnrich` in the enricher, and `service.ts` drops its short-circuit — both needed, or configured-but-stored results never re-render.
- **Fallback preserved:** `enriched.presenter ?? result.presenter` keeps the stored presenter when recompute throws/returns null (matches the spec's last-resort-fallback decision).
- **Naming consistency:** `resolveEntityTypeLabel(t, entityId)` and `formatEntityId(entityId)` are used identically across Tasks 7-9. i18n key shape `search.entityType.<module>.<entity>` matches the component split on `:` and the JSON in Task 8.
