import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { leadConvertBodySchema, type LeadConvertInput } from '../../../../data/validators'
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerLead } from '../../../../data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const convertBodySchema = leadConvertBodySchema

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.manage'] },
}

export async function POST(req: Request, context: { params?: Record<string, unknown> }): Promise<Response> {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      throw new CrudHttpError(404, { error: 'Lead not found' })
    }

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const selectedOrganizationId = scope?.selectedId ?? auth.orgId ?? null
    const organizationIds = scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null)

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId,
      organizationIds,
      request: req,
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsedBody = convertBodySchema.parse(body)

    const em = (container.resolve('em') as EntityManager)
    const lead = await findOneWithDecryption(
      em,
      CustomerLead,
      { id: parsedParams.data.id, deletedAt: null },
      undefined,
      { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
    )
    if (!lead) {
      throw new CrudHttpError(404, { error: 'Lead not found' })
    }
    if (selectedOrganizationId && lead.organizationId !== selectedOrganizationId) {
      throw new CrudHttpError(403, { error: 'Access denied' })
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<LeadConvertInput, {
      leadId: string
      createdDealId?: string
      createdPersonEntityId?: string
      createdCompanyEntityId?: string
    }>('customers.leads.convert', {
      input: {
        id: parsedParams.data.id,
        tenantId: lead.tenantId,
        organizationId: lead.organizationId,
        ...parsedBody,
      },
      ctx,
    })

    return NextResponse.json({
      id: result.leadId,
      status: 'qualified',
      createdDealId: result.createdDealId ?? null,
      createdPersonEntityId: result.createdPersonEntityId ?? null,
      createdCompanyEntityId: result.createdCompanyEntityId ?? null,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    }
    console.error('customers.leads.convert failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const convertResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('qualified'),
  createdDealId: z.string().uuid().nullable().optional(),
  createdPersonEntityId: z.string().uuid().nullable().optional(),
  createdCompanyEntityId: z.string().uuid().nullable().optional(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Convert a lead',
  methods: {
    POST: {
      summary: 'Convert a lead',
      description: 'Qualifies a lead by creating selected downstream records (deal, person, company) and marking the lead as qualified.',
      requestBody: { contentType: 'application/json', schema: convertBodySchema },
      responses: [
        { status: 200, description: 'Lead converted', schema: convertResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed or missing required target data', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 404, description: 'Lead not found', schema: errorSchema },
        { status: 409, description: 'Lead already converted', schema: errorSchema },
      ],
    },
  },
}
