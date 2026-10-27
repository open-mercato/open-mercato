import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerActivity, CustomerInteraction } from '../data/entities'
import { listGrantsForViewer, listSharedChannelIds } from '../lib/conversationShares'
import { CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } from '../lib/interactionCompatibility'
import { resolveCustomerInteractionFeatureFlags } from '../lib/interactionFeatureFlags'
import { buildEmailVisibilityMikroFilter, isEmailHiddenFrom } from '../lib/visibilityFilter'
import type { CustomersToolContext } from './types'

export type ActivityRecord = {
  id: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: Date | null
  authorUserId: string | null
  entityId: string | null
  dealId: string | null
  organizationId: string
  tenantId: string
  createdAt: Date
  updatedAt: Date | null
  entityType: string
}

type ActivityListInput = {
  personId?: string
  companyId?: string
  dealId?: string
  activityType?: string
  limit: number
  offset: number
}

const activityOrder = { occurredAt: 'DESC NULLS LAST', createdAt: 'DESC', id: 'DESC' } as const

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return { tenantId, ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}) }
}

function isInScope(row: { tenantId: string; organizationId: string }, ctx: CustomersToolContext, tenantId: string) {
  return row.tenantId === tenantId && (!ctx.organizationId || row.organizationId === ctx.organizationId)
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return null
}

function copyDate(value: Date | null | undefined): Date | null {
  return value ? new Date(value) : null
}

function canonicalActivity(row: CustomerInteraction): ActivityRecord {
  return {
    id: row.id,
    activityType: row.interactionType,
    subject: row.title ?? null,
    body: row.body ?? null,
    occurredAt: copyDate(row.occurredAt),
    authorUserId: row.authorUserId ?? null,
    entityId: relationId(row.entity),
    dealId: row.dealId ?? null,
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    createdAt: new Date(row.createdAt),
    updatedAt: copyDate(row.updatedAt),
    entityType: 'customers.customer_interaction',
  }
}

function legacyActivity(row: CustomerActivity): ActivityRecord {
  return {
    id: row.id,
    activityType: row.activityType,
    subject: row.subject ?? null,
    body: row.body ?? null,
    occurredAt: copyDate(row.occurredAt),
    authorUserId: row.authorUserId ?? null,
    entityId: relationId(row.entity),
    dealId: relationId(row.deal),
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    createdAt: new Date(row.createdAt),
    updatedAt: copyDate(row.updatedAt),
    entityType: 'customers.customer_activity',
  }
}

async function resolveVisibility(em: EntityManager, ctx: CustomersToolContext, tenantId: string) {
  const currentUserId = ctx.userId?.startsWith('api_key:') ? null : ctx.userId
  const scope = { tenantId, organizationId: ctx.organizationId }
  const [sharedConversations, sharedChannelIds] = await Promise.all([
    listGrantsForViewer(em, scope, currentUserId),
    listSharedChannelIds(em, scope, currentUserId),
  ])
  return { currentUserId, userFeatures: ctx.userFeatures, sharedConversations, sharedChannelIds }
}

export async function loadActivityForScope(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  activityId: string,
): Promise<ActivityRecord | null> {
  const scope = buildScope(ctx, tenantId)
  const canonical = await findOneWithDecryption(
    em,
    CustomerInteraction,
    { ...scope, id: activityId },
    { refresh: true },
    scope,
  )
  if (canonical) {
    if (!isInScope(canonical, ctx, tenantId) || canonical.deletedAt || canonical.interactionType === 'task') return null
    const visibility = await resolveVisibility(em, ctx, tenantId)
    if (isEmailHiddenFrom({
      ...visibility,
      interactionType: canonical.interactionType,
      visibility: canonical.visibility,
      authorUserId: canonical.authorUserId,
      personEntityId: relationId(canonical.entity),
      channelId: canonical.channelId,
    })) return null
    return canonicalActivity(canonical)
  }
  const flags = await resolveCustomerInteractionFeatureFlags(ctx.container, tenantId)
  if (flags.unified || !flags.legacyAdapters) return null
  const legacy = await findOneWithDecryption(
    em,
    CustomerActivity,
    { ...scope, id: activityId },
    { refresh: true },
    scope,
  )
  return legacy && isInScope(legacy, ctx, tenantId) ? legacyActivity(legacy) : null
}

function compareActivities(left: ActivityRecord, right: ActivityRecord): number {
  const leftOccurredAt = left.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY
  const rightOccurredAt = right.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY
  if (leftOccurredAt !== rightOccurredAt) return rightOccurredAt - leftOccurredAt
  const createdAtDifference = right.createdAt.getTime() - left.createdAt.getTime()
  return createdAtDifference || right.id.localeCompare(left.id)
}

export async function listActivitiesForScope(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  input: ActivityListInput,
): Promise<{ items: ActivityRecord[]; total: number }> {
  const scope = buildScope(ctx, tenantId)
  const [flags, visibility] = await Promise.all([
    resolveCustomerInteractionFeatureFlags(ctx.container, tenantId),
    resolveVisibility(em, ctx, tenantId),
  ])
  const includeLegacy = !flags.unified && flags.legacyAdapters
  const entityId = input.personId ?? input.companyId
  const canonicalWhere: FilterQuery<CustomerInteraction> = {
    ...scope,
    ...buildEmailVisibilityMikroFilter(visibility),
    deletedAt: null,
    interactionType: input.activityType ?? { $ne: 'task' },
    ...(entityId ? { entity: entityId } : {}),
    ...(input.dealId ? { dealId: input.dealId } : {}),
    ...(includeLegacy ? { source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } : {}),
  }
  const loadCanonical = async (offset: number, limit: number): Promise<ActivityRecord[]> => {
    if (input.activityType === 'task') return []
    const rows = await findWithDecryption(
      em, CustomerInteraction, canonicalWhere, { limit, offset, orderBy: activityOrder, refresh: true }, scope,
    )
    return rows.filter((row) => isInScope(row, ctx, tenantId)).map(canonicalActivity)
  }
  const countCanonical = () => input.activityType === 'task' ? Promise.resolve(0) : em.count(CustomerInteraction, canonicalWhere)
  if (!includeLegacy) {
    const [items, total] = await Promise.all([
      loadCanonical(input.offset, input.limit),
      countCanonical(),
    ])
    return { items, total }
  }
  const canonicalIds = em.createQueryBuilder(CustomerInteraction).select('id').where(scope)
  const legacyWhere: FilterQuery<CustomerActivity> = {
    ...scope,
    id: { $nin: canonicalIds },
    ...(entityId ? { entity: entityId } : {}),
    ...(input.dealId ? { deal: input.dealId } : {}),
    ...(input.activityType ? { activityType: input.activityType } : {}),
  }
  const loadLegacy = async (offset: number, limit: number): Promise<ActivityRecord[]> => {
    const rows = await findWithDecryption(
      em, CustomerActivity, legacyWhere, { limit, offset, orderBy: activityOrder, refresh: true }, scope,
    )
    return rows.filter((row) => isInScope(row, ctx, tenantId)).map(legacyActivity)
  }
  const [canonicalTotal, legacyTotal] = await Promise.all([
    countCanonical(),
    em.count(CustomerActivity, legacyWhere),
  ])
  const total = canonicalTotal + legacyTotal
  if (input.offset >= total) return { items: [], total }
  let lowerCanonicalOffset = Math.max(0, input.offset - legacyTotal)
  let upperCanonicalOffset = Math.min(input.offset, canonicalTotal)
  while (lowerCanonicalOffset < upperCanonicalOffset) {
    const canonicalOffset = Math.floor((lowerCanonicalOffset + upperCanonicalOffset) / 2)
    const legacyOffset = input.offset - canonicalOffset
    const [canonicalNext, legacyPrevious] = await Promise.all([
      loadCanonical(canonicalOffset, 1),
      loadLegacy(legacyOffset - 1, 1),
    ])
    if (canonicalNext[0] && legacyPrevious[0] && compareActivities(canonicalNext[0], legacyPrevious[0]) < 0) {
      lowerCanonicalOffset = canonicalOffset + 1
    } else {
      upperCanonicalOffset = canonicalOffset
    }
  }
  const [canonicalItems, legacyItems] = await Promise.all([
    loadCanonical(lowerCanonicalOffset, input.limit),
    loadLegacy(input.offset - lowerCanonicalOffset, input.limit),
  ])
  return {
    items: [...canonicalItems, ...legacyItems].sort(compareActivities).slice(0, input.limit),
    total,
  }
}
