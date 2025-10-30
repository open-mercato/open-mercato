import { E as AllEntities } from '@/generated/entities.ids.generated'
import type { EventBus } from '@open-mercato/events/types'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'

export const metadata = { event: 'query_index.coverage.warmup', persistent: false }

type Payload = {
  tenantId?: string | null
}

const WARMUP_THROTTLE_MS = 5 * 60 * 1000
const lastWarmupAt = new Map<string, number>()

function scopeKey(entityType: string, tenantId: string | null): string {
  return `${entityType}|${tenantId ?? '__null__'}`
}

const entityIds = flattenSystemEntityIds(AllEntities as Record<string, Record<string, string>>)

export default async function handle(payload: Payload, ctx: { resolve: <T = any>(name: string) => T }) {
  if (!entityIds.length) return
  const tenantId = payload?.tenantId ?? null
  let eventBus: EventBus | null = null
  try {
    eventBus = ctx.resolve<EventBus>('eventBus')
  } catch {
    eventBus = null
  }
  if (!eventBus) return

  const now = Date.now()
  const scheduled: Promise<unknown>[] = []
  for (const entityType of entityIds) {
    const key = scopeKey(entityType, tenantId)
    const last = lastWarmupAt.get(key) ?? 0
    if (now - last < WARMUP_THROTTLE_MS) continue
    lastWarmupAt.set(key, now)
    scheduled.push(
      eventBus.emitEvent('query_index.coverage.refresh', {
        entityType,
        tenantId,
        organizationId: null,
        delayMs: 0,
      }).catch(() => undefined)
    )
  }
  if (scheduled.length) {
    await Promise.allSettled(scheduled)
  }
}
