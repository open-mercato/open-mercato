import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  getCurrentOpenMercatoEndpointOptions,
  listOpenMercatoApiKeyOptions,
} from '../../lib/openmercato-call-options'

const roleOptionSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
})

const endpointOptionSchema = z.object({
  id: z.string(),
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  label: z.string(),
  summary: z.string().nullable(),
  operationId: z.string().nullable(),
})

const apiKeyOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  roles: z.array(roleOptionSchema),
})

const optionsResponseSchema = z.object({
  endpoints: z.array(endpointOptionSchema),
  apiKeys: z.array(apiKeyOptionSchema),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.manage', 'api_keys.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!auth.tenantId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const [endpoints, apiKeys] = await Promise.all([
    getCurrentOpenMercatoEndpointOptions(),
    listOpenMercatoApiKeyOptions(em, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    }),
  ])

  return NextResponse.json({ endpoints, apiKeys })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'List OpenMercato call action options',
  methods: {
    GET: {
      summary: 'List OpenMercato call action options',
      description:
        'Returns executable Open Mercato API endpoint options and safe API key profile metadata for business-rule actions.',
      responses: [
        {
          status: 200,
          description: 'OpenMercato call options',
          schema: optionsResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Missing required features', schema: errorResponseSchema },
      ],
    },
  },
}
