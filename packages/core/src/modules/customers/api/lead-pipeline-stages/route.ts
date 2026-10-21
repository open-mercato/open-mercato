import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerLeadPipelineStage } from '../../data/entities'
import {
  leadPipelineStageCreateSchema,
  leadPipelineStageDeleteSchema,
  leadPipelineStageUpdateSchema,
} from '../../data/validators'
import { buildLeadActionContext, runLeadCommand } from '../leads/runLeadAction'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.leads.pipeline.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.leads.pipeline.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.leads.pipeline.manage'] },
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId } = await buildLeadActionContext(req, { requireEnabled: false })
    const orgFilter = resolveOrganizationScopeFilter(ctx.organizationScope, ctx.auth)
    const url = new URL(req.url)
    const pipelineId = url.searchParams.get('pipelineId')
    const em = ctx.container.resolve('em') as EntityManager
    const where: Record<string, unknown> = { tenantId, ...orgFilter.where }
    if (pipelineId) where.pipelineId = pipelineId
    const stages = await em.find(CustomerLeadPipelineStage, where, { orderBy: { position: 'asc' } })
    return NextResponse.json({
      items: stages.map((stage) => ({
        id: stage.id,
        pipelineId: stage.pipelineId,
        name: stage.name,
        code: stage.code,
        position: stage.position,
        kind: stage.kind,
        isActive: stage.isActive,
        organizationId: stage.organizationId,
        tenantId: stage.tenantId,
        createdAt: stage.createdAt,
        updatedAt: stage.updatedAt,
      })),
      total: stages.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.lead-pipeline-stages GET failed', { err })
    return NextResponse.json({ error: 'Failed to load lead stages' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipeline_stages.create',
    schema: leadPipelineStageCreateSchema,
    resourceKind: 'customers.lead_pipeline_stage',
    operation: 'create',
    status: 201,
    requireEnabled: false,
  })
}

export async function PUT(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipeline_stages.update',
    schema: leadPipelineStageUpdateSchema,
    resourceKind: 'customers.lead_pipeline_stage',
    resourceId: (input) => input.id,
    requireEnabled: false,
  })
}

export async function DELETE(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipeline_stages.delete',
    schema: leadPipelineStageDeleteSchema,
    resourceKind: 'customers.lead_pipeline_stage',
    resourceId: (input) => input.id,
    operation: 'delete',
    requireEnabled: false,
  })
}

const itemSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  position: z.number(),
  kind: z.string(),
  isActive: z.boolean(),
})

export const openApi = {
  tag: 'Customers',
  summary: 'Manage lead pipeline stages',
  methods: {
    GET: {
      summary: 'List lead pipeline stages',
      query: z.object({ pipelineId: z.string().uuid().optional() }),
      responses: [{ status: 200, description: 'Lead stages', schema: z.object({ items: z.array(itemSchema), total: z.number() }) }],
    },
    POST: {
      summary: 'Create a lead pipeline stage',
      requestBody: { contentType: 'application/json', schema: leadPipelineStageCreateSchema },
      responses: [{ status: 201, description: 'Created', schema: z.object({ ok: z.boolean(), stageId: z.string().uuid() }) }],
    },
    PUT: {
      summary: 'Update a lead pipeline stage',
      requestBody: { contentType: 'application/json', schema: leadPipelineStageUpdateSchema },
      responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Delete a lead pipeline stage',
      requestBody: { contentType: 'application/json', schema: leadPipelineStageDeleteSchema },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
