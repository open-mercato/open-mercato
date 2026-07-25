import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { refreshCoverageSnapshot } from '../lib/coverage'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('query_index').child({ component: 'coverage-refresh' })

export const metadata = { event: 'query_index.coverage.refresh', persistent: false }

type Payload = {
  entityType?: string
  tenantId?: string | null
  organizationId?: string | null
  withDeleted?: boolean
  delayMs?: number
}

const DEFAULT_DELAY_MS = 0
const pending = new Map<string, NodeJS.Timeout>()

function forkRefreshEntityManager(em: EntityManager): EntityManager {
  const fork = (em as unknown as { fork?: (options?: Record<string, unknown>) => EntityManager }).fork
  if (typeof fork !== 'function') return em
  return fork.call(em, { clear: true, freshEventManager: true, useContext: false })
}

function scopeKey(input: Payload): string {
  const entity = String(input.entityType || '')
  const tenant = input.tenantId ?? '__null__'
  const org = input.organizationId ?? '__null__'
  const deleted = input.withDeleted ? '1' : '0'

  return `${entity}|${tenant}|${org}|${deleted}`
}

export default async function handle(payload: Payload, ctx: { resolve: <T = any>(name: string) => T }) {
  const entityType = String(payload?.entityType || '')
  if (!entityType) {
    return
  }

  const tenantId = payload?.tenantId ?? null
  const organizationId = payload?.organizationId ?? null
  const withDeleted = payload?.withDeleted === true
  const delayMs = typeof payload?.delayMs === 'number' && payload.delayMs >= 0 ? payload.delayMs : DEFAULT_DELAY_MS

  const key = scopeKey({ entityType, tenantId, organizationId, withDeleted })

  const handleRefresh = async () => {
    const em = forkRefreshEntityManager(ctx.resolve<EntityManager>('em'))
    try {
      await refreshCoverageSnapshot(em, { entityType, tenantId, organizationId, withDeleted })
    } catch (err) {
      logger.warn('Failed to refresh coverage snapshot', {
        entityType,
        tenantId,
        organizationId,
        withDeleted,
        error: err instanceof Error ? err.message : err,
      })
      await recordIndexerError(
        { em },
        {
          source: 'query_index',
          handler: 'event:query_index.coverage.refresh',
          error: err,
          entityType,
          tenantId,
          organizationId,
          payload,
        },
      )
    }
  }

  if (delayMs === 0) {
    await handleRefresh()
    return
  }

  const existing = pending.get(key)
  if (existing) {
    clearTimeout(existing)
  }

  const timer = setTimeout(() => {
    pending.delete(key)
    void handleRefresh()
  }, delayMs)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
  pending.set(key, timer)
}
