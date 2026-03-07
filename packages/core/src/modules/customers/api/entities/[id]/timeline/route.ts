import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDealStageHistory,
  CustomerComment,
  CustomerActivity,
  CustomerDealEmail,
} from '../../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TimelineEntryKind, TimelineEntry } from '../../../../lib/timeline/types'
import { ALL_TIMELINE_KINDS } from '../../../../lib/timeline/types'
import {
  normalizeAuditLogs,
  normalizeStageHistory,
  normalizeComments,
  normalizeActivities,
  normalizeAttachments,
  normalizeEmails,
} from '../../../../lib/timeline/normalizers'
import { aggregateTimeline } from '../../../../lib/timeline/aggregator'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().optional(),
  types: z.string().optional(),
  dealId: z.string().uuid().optional(),
})

function parseTypes(typesParam: string | undefined): Set<TimelineEntryKind> | null {
  if (!typesParam) return null
  const requested = typesParam.split(',').map((s) => s.trim()).filter(Boolean)
  const valid = requested.filter((t): t is TimelineEntryKind =>
    (ALL_TIMELINE_KINDS as readonly string[]).includes(t),
  )
  return valid.length > 0 ? new Set(valid) : null
}

const FETCH_MULTIPLIER = 3
const MAX_DEALS = 20

type DealRawData = {
  deal: InstanceType<typeof CustomerDeal>
  auditLogs: Array<Record<string, unknown>>
  stageHistory: Array<InstanceType<typeof CustomerDealStageHistory>>
  comments: Array<InstanceType<typeof CustomerComment>>
  activities: Array<InstanceType<typeof CustomerActivity>>
  attachments: Array<InstanceType<typeof Attachment>>
  emails: Array<InstanceType<typeof CustomerDealEmail>>
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = container.resolve('rbacService') as RbacService
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const em = container.resolve('em') as EntityManager
  const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: parsedParams.data.id, deletedAt: null },
    {},
    decryptionScope,
  )
  if (!entity) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
  }

  if (auth.tenantId && entity.tenantId && auth.tenantId !== entity.tenantId) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
  }

  const entityKind = entity.kind
  const requiredViewFeature = entityKind === 'company'
    ? 'customers.companies.view'
    : 'customers.people.view'

  const hasFeature = await rbac.userHasAllFeatures(auth.sub, [requiredViewFeature, 'customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const url = new URL(request.url)
  const query = querySchema.parse(Object.fromEntries(url.searchParams))
  const typesFilter = parseTypes(query.types)
  const fetchLimit = query.limit * FETCH_MULTIPLIER
  const beforeDate = query.before ? new Date(query.before) : undefined
  const beforeFilter: Record<string, unknown> = beforeDate && Number.isFinite(beforeDate.getTime())
    ? { $lt: beforeDate }
    : {}

  const linkEntity = entityKind === 'company' ? CustomerDealCompanyLink : CustomerDealPersonLink
  const linkField = entityKind === 'company' ? 'company' : 'person'

  const dealLinks = await findWithDecryption(
    em,
    linkEntity,
    { [linkField]: entity.id },
    { limit: MAX_DEALS },
    decryptionScope,
  )

  const dealIds = dealLinks.map((link) => (link as Record<string, unknown>).deal as string).filter(Boolean)

  if (query.dealId) {
    if (!dealIds.includes(query.dealId)) {
      return NextResponse.json({ items: [], nextCursor: null, deals: [] })
    }
  }

  const filteredDealIds = query.dealId ? [query.dealId] : dealIds

  const deals = filteredDealIds.length > 0
    ? await findWithDecryption(
        em,
        CustomerDeal,
        { id: { $in: filteredDealIds }, deletedAt: null },
        {},
        decryptionScope,
      )
    : []

  const actionLogs = container.resolve('actionLogService') as ActionLogService

  // Phase 1: Fetch all raw data and collect user IDs
  const userIds = new Set<string>()
  const dealRawDataList: DealRawData[] = []

  for (const deal of deals) {
    const dealScope = {
      dealId: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
    }

    const [auditLogResults, stageHistoryResults, commentResults, activityResults, attachmentResults, emailResults] =
      await Promise.all([
        actionLogs.list({
          tenantId: deal.tenantId,
          organizationId: deal.organizationId,
          resourceKind: 'customers.deal',
          resourceId: deal.id,
          includeRelated: false,
          limit: fetchLimit,
          before: beforeDate,
        }).catch(() => []),

        findWithDecryption(
          em,
          CustomerDealStageHistory,
          {
            ...dealScope,
            ...(Object.keys(beforeFilter).length ? { createdAt: beforeFilter } : {}),
          },
          { orderBy: { createdAt: 'DESC' }, limit: fetchLimit },
          decryptionScope,
        ).catch(() => []),

        findWithDecryption(
          em,
          CustomerComment,
          {
            dealId: deal.id,
            organizationId: deal.organizationId,
            tenantId: deal.tenantId,
            deletedAt: null,
            ...(Object.keys(beforeFilter).length ? { createdAt: beforeFilter } : {}),
          },
          { orderBy: { createdAt: 'DESC' }, limit: fetchLimit },
          decryptionScope,
        ).catch(() => []),

        findWithDecryption(
          em,
          CustomerActivity,
          {
            dealId: deal.id,
            organizationId: deal.organizationId,
            tenantId: deal.tenantId,
            ...(Object.keys(beforeFilter).length ? { occurredAt: beforeFilter } : {}),
          },
          { orderBy: { occurredAt: 'DESC' }, limit: fetchLimit },
          decryptionScope,
        ).catch(() => []),

        findWithDecryption(
          em,
          Attachment,
          {
            entityId: 'customers:customer_deal',
            recordId: deal.id,
            ...(Object.keys(beforeFilter).length ? { createdAt: beforeFilter } : {}),
          },
          { orderBy: { createdAt: 'DESC' }, limit: fetchLimit },
          decryptionScope,
        ).catch(() => []),

        findWithDecryption(
          em,
          CustomerDealEmail,
          {
            ...dealScope,
            ...(Object.keys(beforeFilter).length ? { sentAt: beforeFilter } : {}),
          },
          { orderBy: { sentAt: 'DESC' }, limit: fetchLimit },
          decryptionScope,
        ).catch(() => []),
      ])

    for (const log of auditLogResults) {
      if (log.actorUserId) userIds.add(log.actorUserId)
    }
    for (const entry of stageHistoryResults) {
      if (entry.changedByUserId) userIds.add(entry.changedByUserId)
    }
    for (const comment of commentResults) {
      if (comment.authorUserId) userIds.add(comment.authorUserId)
    }
    for (const activity of activityResults) {
      if (activity.authorUserId) userIds.add(activity.authorUserId)
    }

    dealRawDataList.push({
      deal,
      auditLogs: auditLogResults.map((log) => ({
        id: log.id,
        commandId: log.commandId,
        actionLabel: log.actionLabel,
        executionState: log.executionState,
        actorUserId: log.actorUserId,
        resourceKind: log.resourceKind,
        resourceId: log.resourceId,
        createdAt: log.createdAt,
        changesJson: log.changesJson as Record<string, unknown> | null,
        snapshotBefore: log.snapshotBefore,
        snapshotAfter: log.snapshotAfter,
      })),
      stageHistory: stageHistoryResults,
      comments: commentResults,
      activities: activityResults,
      attachments: attachmentResults,
      emails: emailResults,
    })
  }

  // Entity-level comments/activities (not tied to any deal)
  const [entityComments, entityActivities] = await Promise.all([
    findWithDecryption(
      em,
      CustomerComment,
      {
        entityId: entity.id,
        dealId: null,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
        deletedAt: null,
        ...(Object.keys(beforeFilter).length ? { createdAt: beforeFilter } : {}),
      },
      { orderBy: { createdAt: 'DESC' }, limit: fetchLimit },
      decryptionScope,
    ).catch(() => []),
    findWithDecryption(
      em,
      CustomerActivity,
      {
        entityId: entity.id,
        dealId: null,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
        ...(Object.keys(beforeFilter).length ? { occurredAt: beforeFilter } : {}),
      },
      { orderBy: { occurredAt: 'DESC' }, limit: fetchLimit },
      decryptionScope,
    ).catch(() => []),
  ])

  for (const comment of entityComments) {
    if (comment.authorUserId) userIds.add(comment.authorUserId)
  }
  for (const activity of entityActivities) {
    if (activity.authorUserId) userIds.add(activity.authorUserId)
  }

  // Phase 2: Resolve all user display names
  const displayUsers: Record<string, string> = {}
  if (userIds.size > 0) {
    const users = await em.find(User, { id: { $in: [...userIds] as string[] }, deletedAt: null })
    for (const user of users) {
      const display = typeof user.name === 'string' && user.name.length ? user.name : user.email
      displayUsers[String(user.id)] = display ?? String(user.id)
    }
  }

  // Phase 3: Normalize with resolved display names and annotate with deal context
  const allNormalizedSources: TimelineEntry[][] = []

  for (const rawData of dealRawDataList) {
    const { deal } = rawData
    const dealTitle = deal.title ?? 'Untitled deal'
    const dealContext = { dealId: deal.id, dealTitle }
    const hasStageEntries = rawData.stageHistory.length > 0

    const sources = [
      normalizeAuditLogs(
        rawData.auditLogs as Parameters<typeof normalizeAuditLogs>[0],
        displayUsers,
        hasStageEntries,
      ),
      normalizeStageHistory(
        rawData.stageHistory.map((entry) => ({
          id: entry.id,
          fromStageLabel: entry.fromStageLabel ?? null,
          toStageLabel: entry.toStageLabel,
          changedByUserId: entry.changedByUserId ?? null,
          durationSeconds: entry.durationSeconds ?? null,
          fromStageId: entry.fromStageId ?? null,
          createdAt: entry.createdAt,
        })),
        displayUsers,
      ),
      normalizeComments(
        rawData.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          authorUserId: comment.authorUserId ?? null,
          createdAt: comment.createdAt,
        })),
        displayUsers,
      ),
      normalizeActivities(
        rawData.activities.map((activity) => ({
          id: activity.id,
          activityType: activity.activityType,
          subject: activity.subject ?? null,
          body: activity.body ?? null,
          occurredAt: activity.occurredAt ?? activity.createdAt,
          authorUserId: activity.authorUserId ?? null,
          assignedToUserId: activity.assignedToUserId ?? null,
        })),
        displayUsers,
      ),
      normalizeAttachments(
        rawData.attachments.map((att) => ({
          id: att.id,
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          createdAt: att.createdAt,
        })),
      ),
      normalizeEmails(
        rawData.emails.map((email) => ({
          id: email.id,
          direction: email.direction,
          fromAddress: email.fromAddress,
          fromName: email.fromName ?? null,
          toAddresses: (email.toAddresses ?? []) as Array<{ email: string; name?: string }>,
          subject: email.subject,
          bodyText: email.bodyText ?? null,
          sentAt: email.sentAt,
          hasAttachments: email.hasAttachments,
        })),
      ),
    ]

    for (const source of sources) {
      for (const entry of source) {
        entry.dealContext = dealContext
        entry.href = `/backend/customers/deals/${deal.id}`
      }
    }

    allNormalizedSources.push(...sources)
  }

  // Entity-level entries (no deal context)
  allNormalizedSources.push(
    normalizeComments(
      entityComments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorUserId: comment.authorUserId ?? null,
        createdAt: comment.createdAt,
      })),
      displayUsers,
    ),
    normalizeActivities(
      entityActivities.map((activity) => ({
        id: activity.id,
        activityType: activity.activityType,
        subject: activity.subject ?? null,
        body: activity.body ?? null,
        occurredAt: activity.occurredAt ?? activity.createdAt,
        authorUserId: activity.authorUserId ?? null,
        assignedToUserId: activity.assignedToUserId ?? null,
      })),
      displayUsers,
    ),
  )

  const { items, nextCursor } = aggregateTimeline(allNormalizedSources, {
    limit: query.limit,
    before: query.before ?? null,
    types: typesFilter,
  })

  const dealsList = deals.map((deal) => ({ id: deal.id, title: deal.title ?? 'Untitled deal' }))

  return NextResponse.json({ items, nextCursor, deals: dealsList })
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.deals.view'],
}

const timelineEntrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  occurredAt: z.string(),
  actor: z.object({ id: z.string().nullable(), label: z.string() }),
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  changes: z.array(z.object({
    field: z.string(),
    label: z.string(),
    from: z.unknown(),
    to: z.unknown(),
  })).nullable(),
  dealContext: z.object({
    dealId: z.string(),
    dealTitle: z.string(),
  }).nullable().optional(),
  href: z.string().nullable().optional(),
})

const dealSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
})

const timelineResponseSchema = z.object({
  items: z.array(timelineEntrySchema),
  nextCursor: z.string().nullable(),
  deals: z.array(dealSummarySchema),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer entity timeline',
  methods: {
    GET: {
      summary: 'Get customer entity timeline',
      description: 'Returns a unified, paginated timeline aggregating all deal activity for a customer entity (company or person), plus entity-level comments and activities.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 30, minimum: 1, maximum: 100 } },
        { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Cursor: return entries older than this timestamp' },
        { name: 'types', in: 'query', schema: { type: 'string' }, description: 'Comma-separated list of event types to include' },
        { name: 'dealId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter to a specific deal' },
      ],
      responses: [
        { status: 200, description: 'Timeline entries with deal context', schema: timelineResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Entity not found', schema: errorSchema },
      ],
    },
  },
}
