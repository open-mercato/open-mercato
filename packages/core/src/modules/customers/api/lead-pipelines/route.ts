import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerLeadPipeline } from '../../data/entities'
import {
  leadPipelineCreateSchema,
  leadPipelineDeleteSchema,
  leadPipelineUpdateSchema,
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
    const em = ctx.container.resolve('em') as EntityManager
    const pipelines = await em.find(
      CustomerLeadPipeline,
      { tenantId, ...orgFilter.where },
      { orderBy: { isDefault: 'desc', name: 'asc' } },
    )
    return NextResponse.json({
      items: pipelines.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        code: pipeline.code,
        isDefault: pipeline.isDefault,
        isActive: pipeline.isActive,
        organizationId: pipeline.organizationId,
        tenantId: pipeline.tenantId,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
      })),
      total: pipelines.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.lead-pipelines GET failed', { err })
    return NextResponse.json({ error: 'Failed to load lead pipelines' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipelines.create',
    schema: leadPipelineCreateSchema,
    resourceKind: 'customers.lead_pipeline',
    operation: 'create',
    status: 201,
    requireEnabled: false,
  })
}

export async function PUT(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipelines.update',
    schema: leadPipelineUpdateSchema,
    resourceKind: 'customers.lead_pipeline',
    resourceId: (input) => input.id,
    requireEnabled: false,
  })
}

export async function DELETE(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_pipelines.delete',
    schema: leadPipelineDeleteSchema,
    resourceKind: 'customers.lead_pipeline',
    resourceId: (input) => input.id,
    operation: 'delete',
    requireEnabled: false,
  })
}

const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export const openApi = {
  tag: 'Customers',
  summary: 'Manage lead pipelines',
  methods: {
    GET: {
      summary: 'List lead pipelines',
      responses: [{ status: 200, description: 'Lead pipelines', schema: z.object({ items: z.array(itemSchema), total: z.number() }) }],
    },
    POST: {
      summary: 'Create a lead pipeline',
      requestBody: { contentType: 'application/json', schema: leadPipelineCreateSchema },
      responses: [{ status: 201, description: 'Created', schema: z.object({ ok: z.boolean(), pipelineId: z.string().uuid() }) }],
    },
    PUT: {
      summary: 'Update a lead pipeline',
      requestBody: { contentType: 'application/json', schema: leadPipelineUpdateSchema },
      responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Delete a lead pipeline',
      requestBody: { contentType: 'application/json', schema: leadPipelineDeleteSchema },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
