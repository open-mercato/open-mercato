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
import { createTimelineHandler } from '@open-mercato/shared/modules/timeline/createTimelineHandler'
import type { TimelineSourceDef } from '@open-mercato/shared/modules/timeline/createTimelineHandler'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().optional(),
  types: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Timeline source definitions for deals
// ---------------------------------------------------------------------------

type DealEntity = CustomerDeal & { id: string; tenantId: string; organizationId: string }

const dealTimelineSources: TimelineSourceDef<TimelineEntryKind>[] = [
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const actionLogs = (ctx.container as { resolve: (name: string) => unknown }).resolve('actionLogService') as ActionLogService
      const beforeDate = ctx.beforeFilter.$lt as Date | undefined
      return actionLogs.list({
        tenantId: deal.tenantId,
        organizationId: deal.organizationId,
        resourceKind: 'customers.deal',
        resourceId: deal.id,
        includeRelated: false,
        limit: ctx.fetchLimit,
        before: beforeDate,
      })
    },
    normalize: (records, displayUsers) => {
      const stageRecords = records as Array<{ id: string; commandId: string; actionLabel: string; executionState: string; actorUserId: string; resourceKind: string; resourceId: string; createdAt: Date; changesJson: Record<string, unknown> | null; snapshotBefore: unknown; snapshotAfter: unknown }>
      return normalizeAuditLogs(
        stageRecords.map((log) => ({
          id: log.id,
          commandId: log.commandId,
          actionLabel: log.actionLabel,
          executionState: log.executionState,
          actorUserId: log.actorUserId,
          resourceKind: log.resourceKind,
          resourceId: log.resourceId,
          createdAt: log.createdAt,
          changesJson: log.changesJson,
          snapshotBefore: log.snapshotBefore,
          snapshotAfter: log.snapshotAfter,
        })),
        displayUsers,
        true,
      )
    },
    collectUserIds: (records) => {
      const logs = records as Array<{ actorUserId?: string }>
      return logs.filter((r) => r.actorUserId).map((r) => r.actorUserId!)
    },
  },
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const em = ctx.em as EntityManager
      return findWithDecryption(
        em,
        CustomerDealStageHistory,
        {
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          ...(Object.keys(ctx.beforeFilter).length ? { createdAt: ctx.beforeFilter } : {}),
        },
        { orderBy: { createdAt: 'DESC' }, limit: ctx.fetchLimit },
        ctx.scope,
      )
    },
    normalize: (records, displayUsers) => {
      const entries = records as Array<{ id: string; fromStageLabel: string | null; toStageLabel: string; changedByUserId: string | null; durationSeconds: number | null; fromStageId: string | null; createdAt: Date }>
      return normalizeStageHistory(
        entries.map((entry) => ({
          id: entry.id,
          fromStageLabel: entry.fromStageLabel ?? null,
          toStageLabel: entry.toStageLabel,
          changedByUserId: entry.changedByUserId ?? null,
          durationSeconds: entry.durationSeconds ?? null,
          fromStageId: entry.fromStageId ?? null,
          createdAt: entry.createdAt,
        })),
        displayUsers,
      )
    },
    collectUserIds: (records) => {
      const entries = records as Array<{ changedByUserId?: string }>
      return entries.filter((r) => r.changedByUserId).map((r) => r.changedByUserId!)
    },
  },
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const em = ctx.em as EntityManager
      return findWithDecryption(
        em,
        CustomerComment,
        {
          deal: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          deletedAt: null,
          ...(Object.keys(ctx.beforeFilter).length ? { createdAt: ctx.beforeFilter } : {}),
        },
        { orderBy: { createdAt: 'DESC' }, limit: ctx.fetchLimit },
        ctx.scope,
      )
    },
    normalize: (records, displayUsers) => {
      const comments = records as Array<{ id: string; body: string; authorUserId: string | null; createdAt: Date }>
      return normalizeComments(
        comments.map((c) => ({ id: c.id, body: c.body, authorUserId: c.authorUserId ?? null, createdAt: c.createdAt })),
        displayUsers,
      )
    },
    collectUserIds: (records) => {
      const comments = records as Array<{ authorUserId?: string }>
      return comments.filter((r) => r.authorUserId).map((r) => r.authorUserId!)
    },
  },
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const em = ctx.em as EntityManager
      return findWithDecryption(
        em,
        CustomerActivity,
        {
          deal: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          ...(Object.keys(ctx.beforeFilter).length ? { occurredAt: ctx.beforeFilter } : {}),
        },
        { orderBy: { occurredAt: 'DESC' }, limit: ctx.fetchLimit },
        ctx.scope,
      )
    },
    normalize: (records, displayUsers) => {
      const activities = records as Array<{ id: string; activityType: string; subject: string | null; body: string | null; occurredAt: Date; createdAt: Date; authorUserId: string | null; assignedToUserId: string | null }>
      return normalizeActivities(
        activities.map((a) => ({
          id: a.id,
          activityType: a.activityType,
          subject: a.subject ?? null,
          body: a.body ?? null,
          occurredAt: a.occurredAt ?? a.createdAt,
          authorUserId: a.authorUserId ?? null,
          assignedToUserId: a.assignedToUserId ?? null,
        })),
        displayUsers,
      )
    },
    collectUserIds: (records) => {
      const activities = records as Array<{ authorUserId?: string }>
      return activities.filter((r) => r.authorUserId).map((r) => r.authorUserId!)
    },
  },
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const em = ctx.em as EntityManager
      return findWithDecryption(
        em,
        Attachment,
        {
          entityId: 'customers:customer_deal',
          recordId: deal.id,
          ...(Object.keys(ctx.beforeFilter).length ? { createdAt: ctx.beforeFilter } : {}),
        },
        { orderBy: { createdAt: 'DESC' }, limit: ctx.fetchLimit },
        ctx.scope,
      )
    },
    normalize: (records) => {
      const attachments = records as Array<{ id: string; fileName: string; fileSize: number; mimeType: string; createdAt: Date }>
      return normalizeAttachments(
        attachments.map((att) => ({ id: att.id, fileName: att.fileName, fileSize: att.fileSize, mimeType: att.mimeType, createdAt: att.createdAt })),
      )
    },
  },
  {
    fetch: async (ctx) => {
      const deal = ctx.entity as DealEntity
      const em = ctx.em as EntityManager
      return findWithDecryption(
        em,
        CustomerDealEmail,
        {
          dealId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          ...(Object.keys(ctx.beforeFilter).length ? { sentAt: ctx.beforeFilter } : {}),
        },
        { orderBy: { sentAt: 'DESC' }, limit: ctx.fetchLimit },
        ctx.scope,
      )
    },
    normalize: (records) => {
      const emails = records as Array<{ id: string; direction: string; fromAddress: string; fromName: string | null; toAddresses: Array<{ email: string; name?: string }>; subject: string; bodyText: string | null; sentAt: Date; hasAttachments: boolean }>
      return normalizeEmails(
        emails.map((email) => ({
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
      )
    },
  },
]

const dealTimelineHandler = createTimelineHandler<TimelineEntryKind>({
  allKinds: ALL_TIMELINE_KINDS,
  sources: dealTimelineSources,
  userResolver: async (userIds, ctx) => {
    const em = ctx.em as EntityManager
    const users = await em.find(User, { id: { $in: userIds as string[] }, deletedAt: null })
    const displayUsers: Record<string, string> = {}
    for (const user of users) {
      const display = typeof user.name === 'string' && user.name.length ? user.name : user.email
      displayUsers[String(user.id)] = display ?? String(user.id)
    }
    return displayUsers
  },
})

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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

  const result = await dealTimelineHandler(
    { entityId: deal.id, entity: deal, em, scope: decryptionScope, container },
    query,
  )

  return NextResponse.json(result)
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
