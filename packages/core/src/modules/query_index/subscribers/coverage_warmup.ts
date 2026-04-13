import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { EventBus } from '@open-mercato/events/types'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'

export const metadata = { event: 'query_index.coverage.warmup', persistent: false }

type Payload = {
  tenantId?: string | null
}

const WARMUP_THROTTLE_MS = 5 * 60 * 1000
const WARMUP_REFRESH_CONCURRENCY = 10
const lastWarmupAt = new Map<string, number>()

function scopeKey(entityType: string, tenantId: string | null): string {
  return `${entityType}|${tenantId ?? '__null__'}`
}

function getEntityIdList(): string[] {
  return flattenSystemEntityIds(getEntityIds() as Record<string, Record<string, string>>)
}

export default async function handle(payload: Payload, ctx: { resolve: <T = any>(name: string) => T }) {
  const entityIds = getEntityIdList()
  if (!entityIds.length) {
    return
  }

  const tenantId = payload?.tenantId ?? null
  let eventBus: EventBus | null = null
  try {
    eventBus = ctx.resolve<EventBus>('eventBus')
  } catch {
    eventBus = null
  }

  if (!eventBus) {
    return
  }

  const now = Date.now()
  const staleEntityTypes: string[] = []
  for (const entityType of entityIds) {
    const key = scopeKey(entityType, tenantId)
    const last = lastWarmupAt.get(key) ?? 0
    if (now - last < WARMUP_THROTTLE_MS) {
      continue
    }

    lastWarmupAt.set(key, now)
    staleEntityTypes.push(entityType)
  }

  for (let i = 0; i < staleEntityTypes.length; i += WARMUP_REFRESH_CONCURRENCY) {
    const chunk = staleEntityTypes.slice(i, i + WARMUP_REFRESH_CONCURRENCY)
    await Promise.allSettled(
      chunk.map((entityType) =>
        eventBus.emit('query_index.coverage.refresh', {
          entityType,
          tenantId,
          organizationId: null,
          delayMs: 0,
        }).catch(() => undefined)
      )
    )
  }
}
