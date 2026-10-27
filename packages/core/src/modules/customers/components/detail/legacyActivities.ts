import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { ActivitySummary, InteractionSummary } from './types'

export const LEGACY_ACTIVITIES_PAGE_SIZE = 100
export const LEGACY_ACTIVITIES_MAX_PAGES = 1000

function mapActivityToInteraction(activity: ActivitySummary): InteractionSummary {
  return {
    id: activity.id,
    interactionType: activity.activityType,
    title: activity.subject ?? null,
    body: activity.body ?? null,
    status: 'done',
    scheduledAt: null,
    occurredAt: activity.occurredAt ?? null,
    priority: null,
    authorUserId: activity.authorUserId ?? null,
    ownerUserId: null,
    appearanceIcon: activity.appearanceIcon ?? null,
    appearanceColor: activity.appearanceColor ?? null,
    source: 'legacy-activity',
    entityId: activity.entityId ?? null,
    dealId: activity.dealId ?? null,
    organizationId: null,
    tenantId: null,
    authorName: activity.authorName ?? null,
    authorEmail: activity.authorEmail ?? null,
    dealTitle: activity.dealTitle ?? null,
    customValues: null,
    createdAt: activity.createdAt,
    updatedAt: activity.createdAt,
  }
}

export async function loadLegacyActivitiesInRange({
  entityId,
  rangeStart,
  isWithinRange,
  signal,
}: {
  entityId: string
  rangeStart: Date
  isWithinRange: (item: InteractionSummary) => boolean
  signal?: AbortSignal
}): Promise<InteractionSummary[]> {
  const items: InteractionSummary[] = []
  let page = 1
  // Short-page termination: server-reported `totalPages` is a display value, not a loop
  // bound — it can under-report (capped counts) or drift mid-enumeration. Pages are sorted
  // by `occurredAt` desc, so the scan also stops once a page reaches past the requested
  // range. Fail closed at the page ceiling rather than rendering a partial week silently.
  for (;;) {
    const payload = await readApiResultOrThrow<{
      items?: ActivitySummary[]
      totalPages?: number
    }>(
      `/api/customers/activities?entityId=${encodeURIComponent(entityId)}&page=${page}&pageSize=${LEGACY_ACTIVITIES_PAGE_SIZE}&sortField=occurredAt&sortDir=desc`,
      { signal },
    )
    const pageItems = Array.isArray(payload?.items) ? payload.items : []
    items.push(...pageItems.map(mapActivityToInteraction).filter(isWithinRange))
    if (!pageItems.length) break
    const oldestPageTimestamp = pageItems.reduce<number>((oldest, activity) => {
      const rawDate = activity.occurredAt ?? activity.createdAt
      const timestamp = rawDate ? new Date(rawDate).getTime() : Number.NaN
      if (!Number.isFinite(timestamp)) return oldest
      return Math.min(oldest, timestamp)
    }, Number.POSITIVE_INFINITY)
    if (Number.isFinite(oldestPageTimestamp) && oldestPageTimestamp < rangeStart.getTime()) {
      break
    }
    if (pageItems.length < LEGACY_ACTIVITIES_PAGE_SIZE) break
    if (page >= LEGACY_ACTIVITIES_MAX_PAGES) {
      throw new Error(`[internal] legacy activity enumeration exceeded ${LEGACY_ACTIVITIES_MAX_PAGES} pages; refusing to render a partial set`)
    }
    page += 1
  }
  return items
}
