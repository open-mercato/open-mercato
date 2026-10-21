import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerLeadLostReason } from '../../data/entities'
import {
  leadLostReasonCreateSchema,
  leadLostReasonDeleteSchema,
  leadLostReasonUpdateSchema,
} from '../../data/validators'
import { buildLeadActionContext, runLeadCommand } from '../leads/runLeadAction'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.leads.reasons.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.leads.reasons.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.leads.reasons.manage'] },
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId } = await buildLeadActionContext(req, { requireEnabled: false })
    const orgFilter = resolveOrganizationScopeFilter(ctx.organizationScope, ctx.auth)
    const url = new URL(req.url)
    const pipelineId = url.searchParams.get('pipelineId')
    const em = ctx.container.resolve('em') as EntityManager
    const where: Record<string, unknown> = { tenantId, ...orgFilter.where }
    if (pipelineId) {
      where.$or = [{ pipelineId }, { pipelineId: null }]
    }
    const reasons = await em.find(CustomerLeadLostReason, where, { orderBy: { sortOrder: 'asc' } })
    return NextResponse.json({
      items: reasons.map((reason) => ({
        id: reason.id,
        pipelineId: reason.pipelineId ?? null,
        name: reason.name,
        code: reason.code,
        isActive: reason.isActive,
        sortOrder: reason.sortOrder,
        organizationId: reason.organizationId,
        tenantId: reason.tenantId,
        createdAt: reason.createdAt,
        updatedAt: reason.updatedAt,
      })),
      total: reasons.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.lead-lost-reasons GET failed', { err })
    return NextResponse.json({ error: 'Failed to load lead lost reasons' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_lost_reasons.create',
    schema: leadLostReasonCreateSchema,
    resourceKind: 'customers.lead_lost_reason',
    operation: 'create',
    status: 201,
    requireEnabled: false,
  })
}

export async function PUT(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_lost_reasons.update',
    schema: leadLostReasonUpdateSchema,
    resourceKind: 'customers.lead_lost_reason',
    resourceId: (input) => input.id,
    requireEnabled: false,
  })
}

export async function DELETE(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_lost_reasons.delete',
    schema: leadLostReasonDeleteSchema,
    resourceKind: 'customers.lead_lost_reason',
    resourceId: (input) => input.id,
    operation: 'delete',
    requireEnabled: false,
  })
}

const itemSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid().nullable(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number(),
})

export const openApi = {
  tag: 'Customers',
  summary: 'Manage lead lost reasons',
  methods: {
    GET: {
      summary: 'List lead lost reasons',
      query: z.object({ pipelineId: z.string().uuid().optional() }),
      responses: [{ status: 200, description: 'Lost reasons', schema: z.object({ items: z.array(itemSchema), total: z.number() }) }],
    },
    POST: {
      summary: 'Create a lead lost reason',
      requestBody: { contentType: 'application/json', schema: leadLostReasonCreateSchema },
      responses: [{ status: 201, description: 'Created', schema: z.object({ ok: z.boolean(), lostReasonId: z.string().uuid() }) }],
    },
    PUT: {
      summary: 'Update a lead lost reason',
      requestBody: { contentType: 'application/json', schema: leadLostReasonUpdateSchema },
      responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Delete a lead lost reason',
      requestBody: { contentType: 'application/json', schema: leadLostReasonDeleteSchema },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
