import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerDeal,
  CustomerDealStageHistory,
  CustomerPipelineStage,
} from '../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const CLOSED_STATUSES = new Set(['win', 'won', 'lost', 'loose', 'closed'])

const bulkUpdateSchema = z.object({
  dealIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['reassign', 'change_stage', 'change_status']),
  payload: z.object({
    ownerUserId: z.string().uuid().optional(),
    pipelineStageId: z.string().uuid().optional(),
    status: z.string().max(50).optional(),
    closeReasonId: z.string().uuid().optional(),
  }),
})

type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>

type FailedDeal = {
  dealId: string
  error: string
}

async function resolvePipelineStageValue(
  em: EntityManager,
  stageId: string,
): Promise<{ label: string; pipelineId: string } | null> {
  const stage = await em.findOne(CustomerPipelineStage, { id: stageId })
  if (!stage) return null
  return { label: stage.label, pipelineId: stage.pipelineId }
}

async function processReassign(
  em: EntityManager,
  deal: CustomerDeal,
  payload: BulkUpdateInput['payload'],
): Promise<void> {
  if (!payload.ownerUserId) {
    throw new Error('ownerUserId is required for reassign action')
  }
  deal.ownerUserId = payload.ownerUserId
  await em.flush()
}

async function processChangeStage(
  em: EntityManager,
  deal: CustomerDeal,
  payload: BulkUpdateInput['payload'],
  changedByUserId: string | null,
): Promise<void> {
  if (!payload.pipelineStageId) {
    throw new Error('pipelineStageId is required for change_stage action')
  }
  const stageInfo = await resolvePipelineStageValue(em, payload.pipelineStageId)
  if (!stageInfo) {
    throw new Error('Pipeline stage not found')
  }

  const previousStageId = deal.pipelineStageId ?? null
  const previousPipelineId = deal.pipelineId ?? null
  const now = new Date()

  deal.pipelineStageId = payload.pipelineStageId
  deal.pipelineStage = stageInfo.label
  deal.pipelineId = stageInfo.pipelineId

  const durationSeconds = deal.stageEnteredAt
    ? Math.round((Date.now() - deal.stageEnteredAt.getTime()) / 1000)
    : null

  deal.stageEnteredAt = now

  const fromStageLabel = previousStageId
    ? (await em.findOne(CustomerPipelineStage, { id: previousStageId }))?.label ?? previousStageId
    : null

  const history = em.create(CustomerDealStageHistory, {
    organizationId: deal.organizationId,
    tenantId: deal.tenantId,
    dealId: deal.id,
    fromStageId: previousStageId,
    toStageId: payload.pipelineStageId,
    fromStageLabel: fromStageLabel ?? null,
    toStageLabel: stageInfo.label,
    fromPipelineId: previousPipelineId,
    toPipelineId: stageInfo.pipelineId,
    changedByUserId: changedByUserId ?? null,
    durationSeconds,
  })
  em.persist(history)

  await em.flush()
}

async function processChangeStatus(
  em: EntityManager,
  deal: CustomerDeal,
  payload: BulkUpdateInput['payload'],
): Promise<void> {
  if (!payload.status) {
    throw new Error('status is required for change_status action')
  }

  const previousStatus = deal.status
  deal.status = payload.status

  if (payload.closeReasonId !== undefined) {
    deal.closeReasonId = payload.closeReasonId ?? null
  }

  if (CLOSED_STATUSES.has(payload.status) && !CLOSED_STATUSES.has(previousStatus)) {
    deal.closedAt = new Date()
  } else if (!CLOSED_STATUSES.has(payload.status) && CLOSED_STATUSES.has(previousStatus)) {
    deal.closedAt = null
    deal.closeReasonId = null
    deal.closeReasonNotes = null
  }

  await em.flush()
}

export async function POST(request: Request) {
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
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.manage'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parseResult = bulkUpdateSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }

  const input = parseResult.data
  const em = container.resolve('em') as EntityManager
  const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }
  const changedByUserId = auth.isApiKey ? null : auth.sub ?? null

  let updated = 0
  const failed: FailedDeal[] = []

  for (const dealId of input.dealIds) {
    try {
      const deal = await findOneWithDecryption(
        em,
        CustomerDeal,
        { id: dealId, deletedAt: null },
        {},
        decryptionScope,
      )

      if (!deal) {
        failed.push({ dealId, error: 'Deal not found' })
        continue
      }

      if (auth.tenantId && deal.tenantId && auth.tenantId !== deal.tenantId) {
        failed.push({ dealId, error: 'Deal not found' })
        continue
      }

      if (auth.orgId && deal.organizationId && auth.orgId !== deal.organizationId) {
        failed.push({ dealId, error: 'Access denied' })
        continue
      }

      switch (input.action) {
        case 'reassign':
          await processReassign(em, deal, input.payload)
          break
        case 'change_stage':
          await processChangeStage(em, deal, input.payload, changedByUserId)
          break
        case 'change_status':
          await processChangeStatus(em, deal, input.payload)
          break
      }

      updated++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      failed.push({ dealId, error: message })
    }
  }

  return NextResponse.json({ updated, failed })
}

export const metadata = {
  methods: ['POST'],
  requireAuth: true,
  requireFeatures: ['customers.deals.manage'],
}

const bulkUpdateResponseSchema = z.object({
  updated: z.number(),
  failed: z.array(
    z.object({
      dealId: z.string().uuid(),
      error: z.string(),
    }),
  ),
})

const bulkUpdateErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Bulk update deals',
  methods: {
    POST: {
      summary: 'Bulk update deals',
      description:
        'Applies an action (reassign, change_stage, or change_status) to multiple deals. Partial success is allowed — individual deal failures are reported in the response.',
      tags: ['Customers'],
      requestBody: {
        schema: bulkUpdateSchema,
        description: 'The deal IDs to update and the action with its payload.',
      },
      responses: [
        {
          status: 200,
          description: 'Bulk update result with counts and per-deal errors',
          schema: bulkUpdateResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: bulkUpdateErrorSchema },
        { status: 401, description: 'Authentication required', schema: bulkUpdateErrorSchema },
        { status: 403, description: 'Access denied', schema: bulkUpdateErrorSchema },
      ],
    },
  },
}
