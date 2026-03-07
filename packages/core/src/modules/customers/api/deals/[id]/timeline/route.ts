import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerDeal,
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
import type { TimelineEntryKind } from '../../../../lib/timeline/types'
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

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
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

  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const em = container.resolve('em') as EntityManager
  const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    { id: parsedParams.data.id, deletedAt: null },
    {},
    decryptionScope,
  )
  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const query = querySchema.parse(Object.fromEntries(url.searchParams))
  const typesFilter = parseTypes(query.types)
  const fetchLimit = query.limit * FETCH_MULTIPLIER
  const beforeDate = query.before ? new Date(query.before) : undefined
  const beforeFilter: Record<string, unknown> = beforeDate && Number.isFinite(beforeDate.getTime())
    ? { $lt: beforeDate }
    : {}

  const dealScope = {
    dealId: deal.id,
    organizationId: deal.organizationId,
    tenantId: deal.tenantId,
  }

  const actionLogs = container.resolve('actionLogService') as ActionLogService

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
          deal: deal.id,
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
          deal: deal.id,
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

  const userIds = new Set<string>()
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

  const displayUsers: Record<string, string> = {}
  if (userIds.size > 0) {
    const users = await em.find(User, { id: { $in: [...userIds] as string[] }, deletedAt: null })
    for (const user of users) {
      const display = typeof user.name === 'string' && user.name.length ? user.name : user.email
      displayUsers[String(user.id)] = display ?? String(user.id)
    }
  }

  const hasStageEntries = stageHistoryResults.length > 0
  const normalizedSources = [
    normalizeAuditLogs(
      auditLogResults.map((log) => ({
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
      displayUsers,
      hasStageEntries,
    ),
    normalizeStageHistory(
      stageHistoryResults.map((entry) => ({
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
      commentResults.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorUserId: comment.authorUserId ?? null,
        createdAt: comment.createdAt,
      })),
      displayUsers,
    ),
    normalizeActivities(
      activityResults.map((activity) => ({
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
      attachmentResults.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        createdAt: att.createdAt,
      })),
    ),
    normalizeEmails(
      emailResults.map((email) => ({
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

  const { items, nextCursor } = aggregateTimeline(normalizedSources, {
    limit: query.limit,
    before: query.before ?? null,
    types: typesFilter,
  })

  return NextResponse.json({ items, nextCursor })
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
})

const timelineResponseSchema = z.object({
  items: z.array(timelineEntrySchema),
  nextCursor: z.string().nullable(),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deal timeline',
  methods: {
    GET: {
      summary: 'Get deal timeline',
      description: 'Returns a unified, paginated timeline of all deal events (stage changes, comments, activities, emails, file uploads, field changes).',
      pathParams: paramsSchema,
      query: querySchema,
      responses: [
        { status: 200, description: 'Timeline entries', schema: timelineResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Access denied', schema: errorSchema },
        { status: 404, description: 'Deal not found', schema: errorSchema },
      ],
    },
  },
}
