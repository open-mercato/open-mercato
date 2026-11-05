'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { registerResponseEnrichers, getEnrichersForEntity } from '@open-mercato/shared/lib/crud/enricher-registry'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { registerSyncSubscribers } from '@open-mercato/shared/lib/crud/sync-subscriber-store'
import type { SyncSubscriberEntry } from '@open-mercato/shared/lib/crud/sync-subscriber-store'
import { entityIdToEventEntity, collectQuerySubscribers, reapplyScopeGuards } from '@open-mercato/shared/lib/query/query-extension-runner'
import type { QueryOptions } from '@open-mercato/shared/lib/query/types'

type PhaseStatus = 'idle' | 'pending' | 'ok' | 'error'

const hintClassName = 'rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-400/10 p-2 text-xs text-amber-800 dark:text-amber-100/90'

function print(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// Test enrichers for registry probing
// ---------------------------------------------------------------------------

const PROBE_ENTITY = 'example.todo'

function makeApiOnlyEnricher(): ResponseEnricher {
  return {
    id: 'example.query-probe.api-only',
    targetEntity: PROBE_ENTITY,
    priority: 10,
    enrichOne: async (record) => record,
    enrichMany: async (records) => records,
  }
}

function makeQueryEnabledEnricher(engines?: Array<'basic' | 'hybrid'>, applyOn?: Array<'list' | 'detail'>): ResponseEnricher {
  return {
    id: 'example.query-probe.query-enabled',
    targetEntity: PROBE_ENTITY,
    priority: 5,
    queryEngine: {
      enabled: true,
      ...(engines ? { engines } : {}),
      ...(applyOn ? { applyOn } : {}),
    },
    enrichOne: async (record) => ({ ...record, _example_enriched: true }),
    enrichMany: async (records) => records.map((r) => ({ ...r, _example_enriched: true })),
  }
}

function makeBasicOnlyEnricher(): ResponseEnricher {
  return {
    id: 'example.query-probe.basic-only',
    targetEntity: PROBE_ENTITY,
    priority: 1,
    queryEngine: {
      enabled: true,
      engines: ['basic'],
    },
    enrichOne: async (record) => record,
    enrichMany: async (records) => records,
  }
}

// ---------------------------------------------------------------------------
// Test subscribers for collection probing
// ---------------------------------------------------------------------------

function makeQueryingSubscriber(): SyncSubscriberEntry {
  return {
    metadata: {
      event: 'example.todo.querying',
      sync: true,
      priority: 10,
      id: 'example.query-probe.querying-subscriber',
    },
    handler: async (payload) => {
      return { ok: true, modifiedQuery: { withDeleted: true } }
    },
  }
}

function makeQueriedSubscriber(): SyncSubscriberEntry {
  return {
    metadata: {
      event: 'example.todo.queried',
      sync: true,
      priority: 20,
      id: 'example.query-probe.queried-subscriber',
    },
    handler: async () => {
      return { ok: true }
    },
  }
}

function makeWildcardSubscriber(): SyncSubscriberEntry {
  return {
    metadata: {
      event: 'example.*.querying',
      sync: true,
      priority: 50,
      id: 'example.query-probe.wildcard-subscriber',
    },
    handler: async () => {
      return { ok: true }
    },
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UmesQueryExtensionsPage() {
  const t = useT()

  const [enricherStatus, setEnricherStatus] = React.useState<PhaseStatus>('idle')
  const [enricherResult, setEnricherResult] = React.useState<unknown>(null)

  const [subscriberStatus, setSubscriberStatus] = React.useState<PhaseStatus>('idle')
  const [subscriberResult, setSubscriberResult] = React.useState<unknown>(null)

  const [scopeGuardStatus, setScopeGuardStatus] = React.useState<PhaseStatus>('idle')
  const [scopeGuardResult, setScopeGuardResult] = React.useState<unknown>(null)

  const [entityIdStatus, setEntityIdStatus] = React.useState<PhaseStatus>('idle')
  const [entityIdResult, setEntityIdResult] = React.useState<unknown>(null)

  // -------------------------------------------------------------------------
  // N.1 — Enricher registry with surface-aware filtering
  // -------------------------------------------------------------------------

  const runEnricherProbe = React.useCallback(() => {
    setEnricherStatus('pending')
    try {
      registerResponseEnrichers([
        { moduleId: 'example', enrichers: [makeApiOnlyEnricher(), makeQueryEnabledEnricher(), makeBasicOnlyEnricher()] },
      ])

      const noSelector = getEnrichersForEntity(PROBE_ENTITY)
      const apiSurface = getEnrichersForEntity(PROBE_ENTITY, { surface: 'api-response' })
      const queryAll = getEnrichersForEntity(PROBE_ENTITY, { surface: 'query-engine' })
      const queryBasic = getEnrichersForEntity(PROBE_ENTITY, { surface: 'query-engine', engine: 'basic' })
      const queryHybrid = getEnrichersForEntity(PROBE_ENTITY, { surface: 'query-engine', engine: 'hybrid' })

      const results = {
        noSelector: { count: noSelector.length, ids: noSelector.map((e) => e.enricher.id) },
        apiResponse: { count: apiSurface.length, ids: apiSurface.map((e) => e.enricher.id) },
        queryEngineAll: { count: queryAll.length, ids: queryAll.map((e) => e.enricher.id) },
        queryEngineBasic: { count: queryBasic.length, ids: queryBasic.map((e) => e.enricher.id) },
        queryEngineHybrid: { count: queryHybrid.length, ids: queryHybrid.map((e) => e.enricher.id) },
      }

      const allOk =
        results.noSelector.count === 3 &&
        results.apiResponse.count === 3 &&
        results.queryEngineAll.count === 2 &&
        results.queryEngineBasic.count === 2 &&
        results.queryEngineHybrid.count === 1

      setEnricherResult(results)
      setEnricherStatus(allOk ? 'ok' : 'error')
    } catch (error) {
      setEnricherStatus('error')
      setEnricherResult({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // -------------------------------------------------------------------------
  // N.2 — Sync subscriber collection for query events
  // -------------------------------------------------------------------------

  const runSubscriberProbe = React.useCallback(() => {
    setSubscriberStatus('pending')
    try {
      registerSyncSubscribers([
        makeQueryingSubscriber(),
        makeQueriedSubscriber(),
        makeWildcardSubscriber(),
      ])

      const queryingMatches = collectQuerySubscribers('example.todo.querying')
      const queriedMatches = collectQuerySubscribers('example.todo.queried')
      const unrelatedMatches = collectQuerySubscribers('customers.person.querying')

      const results = {
        querying: {
          count: queryingMatches.length,
          ids: queryingMatches.map((s) => s.metadata.id),
        },
        queried: {
          count: queriedMatches.length,
          ids: queriedMatches.map((s) => s.metadata.id),
        },
        unrelated: {
          count: unrelatedMatches.length,
          ids: unrelatedMatches.map((s) => s.metadata.id),
        },
      }

      const allOk =
        results.querying.count === 2 &&
        results.queried.count === 1 &&
        results.unrelated.count === 0

      setSubscriberResult(results)
      setSubscriberStatus(allOk ? 'ok' : 'error')
    } catch (error) {
      setSubscriberStatus('error')
      setSubscriberResult({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // -------------------------------------------------------------------------
  // N.3 — Scope guard re-application
  // -------------------------------------------------------------------------

  const runScopeGuardProbe = React.useCallback(() => {
    setScopeGuardStatus('pending')
    try {
      const baseQuery: QueryOptions = {
        tenantId: 'tenant-original',
        organizationId: 'org-original',
        filters: [{ field: 'status', op: 'eq', value: 'active' }],
        withDeleted: true,
      }

      const tampered: QueryOptions = {
        ...baseQuery,
        tenantId: 'tenant-tampered',
        organizationId: 'org-tampered',
      }

      const restored = reapplyScopeGuards(tampered, 'tenant-original', 'org-original')

      const results = {
        before: { tenantId: tampered.tenantId, organizationId: tampered.organizationId },
        after: { tenantId: restored.tenantId, organizationId: restored.organizationId },
        filtersPreserved: JSON.stringify(restored.filters) === JSON.stringify(baseQuery.filters),
        withDeletedPreserved: restored.withDeleted === true,
      }

      const allOk =
        restored.tenantId === 'tenant-original' &&
        restored.organizationId === 'org-original' &&
        results.filtersPreserved &&
        results.withDeletedPreserved

      setScopeGuardResult(results)
      setScopeGuardStatus(allOk ? 'ok' : 'error')
    } catch (error) {
      setScopeGuardStatus('error')
      setScopeGuardResult({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // -------------------------------------------------------------------------
  // N.4 — Entity ID conversion
  // -------------------------------------------------------------------------

  const runEntityIdProbe = React.useCallback(() => {
    setEntityIdStatus('pending')
    try {
      const conversions = [
        { input: 'customers:person', expected: 'customers.person' },
        { input: 'sales:order', expected: 'sales.order' },
        { input: 'example:todo', expected: 'example.todo' },
        { input: 'catalog:product:variant', expected: 'catalog.product.variant' },
      ]

      const results = conversions.map(({ input, expected }) => {
        const actual = entityIdToEventEntity(input)
        return { input, expected, actual, ok: actual === expected }
      })

      const allOk = results.every((r) => r.ok)

      setEntityIdResult(results)
      setEntityIdStatus(allOk ? 'ok' : 'error')
    } catch (error) {
      setEntityIdStatus('error')
      setEntityIdResult({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.queryExtensions.title', 'UMES Phase N — Query Engine Extensibility')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('example.umes.queryExtensions.description', 'Validation page for Phase N query engine extensions: enricher opt-in, surface-aware registry, sync query events, and scope guard re-application.')}
          </p>
        </div>

        <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted-foreground">
          <div data-testid="phase-n-status-enrichers">phaseN_enrichers={enricherStatus}</div>
          <div data-testid="phase-n-status-subscribers">phaseN_subscribers={subscriberStatus}</div>
          <div data-testid="phase-n-status-scope-guards">phaseN_scopeGuards={scopeGuardStatus}</div>
          <div data-testid="phase-n-status-entity-ids">phaseN_entityIds={entityIdStatus}</div>
        </div>

        {/* N.1 — Surface-Aware Enricher Registry */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.queryExtensions.enrichers.title', 'N.1 Surface-Aware Enricher Registry')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.queryExtensions.enrichers.description', 'Registers three enrichers (API-only, query-enabled for all engines, basic-only) and probes `getEnrichersForEntity` with different surface selectors.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.queryExtensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.queryExtensions.enrichers.hint1', '1. No selector / `api-response` surface: returns all 3 enrichers (backward compatible).')}</div>
            <div>{t('example.umes.queryExtensions.enrichers.hint2', '2. `query-engine` surface (no engine filter): returns 2 enrichers (query-enabled + basic-only).')}</div>
            <div>{t('example.umes.queryExtensions.enrichers.hint3', '3. `query-engine` + `basic` engine: returns 2 enrichers (query-enabled defaults to both, basic-only matches).')}</div>
            <div>{t('example.umes.queryExtensions.enrichers.hint4', '4. `query-engine` + `hybrid` engine: returns 1 enricher (only query-enabled, basic-only excluded).')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-n-run-enrichers" type="button" onClick={runEnricherProbe}>
              {t('example.umes.queryExtensions.enrichers.run', 'Run enricher registry probe')}
            </Button>
            <span data-testid="phase-n-enricher-status" className="text-xs text-muted-foreground">status={enricherStatus}</span>
          </div>
          <div data-testid="phase-n-enricher-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap">
            result={print(enricherResult)}
          </div>
        </div>

        {/* N.2 — Sync Query Event Subscribers */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.queryExtensions.subscribers.title', 'N.2 Sync Query Event Subscribers')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.queryExtensions.subscribers.description', 'Registers three sync subscribers (querying, queried, wildcard) and probes `collectQuerySubscribers` with different event IDs.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.queryExtensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.queryExtensions.subscribers.hint1', '1. `example.todo.querying` should match 2 subscribers (exact + wildcard `example.*.querying`).')}</div>
            <div>{t('example.umes.queryExtensions.subscribers.hint2', '2. `example.todo.queried` should match 1 subscriber (exact match only).')}</div>
            <div>{t('example.umes.queryExtensions.subscribers.hint3', '3. `customers.person.querying` should match 0 subscribers (no cross-entity leakage).')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-n-run-subscribers" type="button" onClick={runSubscriberProbe}>
              {t('example.umes.queryExtensions.subscribers.run', 'Run subscriber collection probe')}
            </Button>
            <span data-testid="phase-n-subscriber-status" className="text-xs text-muted-foreground">status={subscriberStatus}</span>
          </div>
          <div data-testid="phase-n-subscriber-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap">
            result={print(subscriberResult)}
          </div>
        </div>

        {/* N.3 — Scope Guard Re-application */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.queryExtensions.scopeGuards.title', 'N.3 Scope Guard Re-application')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.queryExtensions.scopeGuards.description', 'Demonstrates that `reapplyScopeGuards` restores tenant/org constraints after subscriber modifications while preserving other query options.')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.queryExtensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.queryExtensions.scopeGuards.hint1', '1. Tampered tenantId/organizationId should be restored to original values.')}</div>
            <div>{t('example.umes.queryExtensions.scopeGuards.hint2', '2. Non-scope fields (filters, withDeleted) should remain unchanged.')}</div>
            <div>{t('example.umes.queryExtensions.scopeGuards.hint3', '3. This ensures subscribers cannot bypass multi-tenant isolation.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-n-run-scope-guards" type="button" onClick={runScopeGuardProbe}>
              {t('example.umes.queryExtensions.scopeGuards.run', 'Run scope guard probe')}
            </Button>
            <span data-testid="phase-n-scope-guard-status" className="text-xs text-muted-foreground">status={scopeGuardStatus}</span>
          </div>
          <div data-testid="phase-n-scope-guard-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap">
            result={print(scopeGuardResult)}
          </div>
        </div>

        {/* N.4 — Entity ID Conversion */}
        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-base font-semibold">{t('example.umes.queryExtensions.entityIds.title', 'N.4 Entity ID Conversion')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('example.umes.queryExtensions.entityIds.description', 'Validates `entityIdToEventEntity` which converts query engine format (`module:entity`) to event format (`module.entity`).')}
            </p>
          </div>
          <div className={`grid gap-1 ${hintClassName}`}>
            <div className="font-medium text-amber-900 dark:text-amber-50">{t('example.umes.queryExtensions.hintHeading', 'What should be visible and how it should work')}</div>
            <div>{t('example.umes.queryExtensions.entityIds.hint1', '1. `customers:person` should convert to `customers.person`.')}</div>
            <div>{t('example.umes.queryExtensions.entityIds.hint2', '2. `catalog:product:variant` should convert to `catalog.product.variant` (multiple colons).')}</div>
            <div>{t('example.umes.queryExtensions.entityIds.hint3', '3. All conversions should show `ok: true`.')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="phase-n-run-entity-ids" type="button" onClick={runEntityIdProbe}>
              {t('example.umes.queryExtensions.entityIds.run', 'Run entity ID conversion probe')}
            </Button>
            <span data-testid="phase-n-entity-id-status" className="text-xs text-muted-foreground">status={entityIdStatus}</span>
          </div>
          <div data-testid="phase-n-entity-id-result" className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground whitespace-pre-wrap">
            result={print(entityIdResult)}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
