import type { EntityManager } from '@mikro-orm/postgresql'
import { refreshCoverageSnapshot } from '../lib/coverage'

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

function scopeKey(input: Payload): string {
  const entity = String(input.entityType || '')
  const tenant = input.tenantId ?? '__null__'
  const org = input.organizationId ?? '__null__'
  const deleted = input.withDeleted ? '1' : '0'
  return `${entity}|${tenant}|${org}|${deleted}`
}

export default async function handle(payload: Payload, ctx: { resolve: <T = any>(name: string) => T }) {
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  const tenantId = payload?.tenantId ?? null
  const organizationId = payload?.organizationId ?? null
  const withDeleted = payload?.withDeleted === true
  const delayMs = typeof payload?.delayMs === 'number' && payload.delayMs >= 0 ? payload.delayMs : DEFAULT_DELAY_MS

  const em = ctx.resolve<EntityManager>('em')
  const key = scopeKey({ entityType, tenantId, organizationId, withDeleted })

  const existing = pending.get(key)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pending.delete(key)
    Promise.resolve()
      .then(() => refreshCoverageSnapshot(em, { entityType, tenantId, organizationId, withDeleted }))
      .catch((err) => {
        console.warn('[query_index] Failed to refresh coverage snapshot', {
          entityType,
          tenantId,
          organizationId,
          withDeleted,
          error: err instanceof Error ? err.message : err,
        })
      })
  }, delayMs)

  if (typeof timer.unref === 'function') timer.unref()
  pending.set(key, timer)
}
