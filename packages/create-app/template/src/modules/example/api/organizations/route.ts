import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { id, name } from '@/.mercato/generated/entities/organization'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  exampleErrorSchema,
  exampleOrganizationResponseSchema,
  exampleTag,
  organizationQuerySchema,
} from '../openapi'

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['example.todos.view']
  },
  POST: {
    requireAuth: true,
    requireFeatures: ['example.todos.manage']
  },
  PUT: {
    requireAuth: true,
    requireFeatures: ['example.todos.manage']
  },
  DELETE: {
    requireAuth: true,
    requireFeatures: ['example.todos.manage']
  }
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = (container.resolve('queryEngine') as QueryEngine)
    const auth = await getAuthFromCookies()

    if (!auth?.tenantId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    const url = new URL(request.url)
    const organizationIds = url.searchParams.get('ids')?.split(',') || []

    if (organizationIds.length === 0) {
      return new Response(JSON.stringify({ items: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }

    // Query organizations
    const res = await queryEngine.query(E.directory.organization, {
      tenantId: auth.tenantId!,
      organizationId: auth.orgId || undefined, // optional filter
      fields: [id, name],
      filters: [
        { field: 'id', op: 'in', value: organizationIds }
      ]
    })

    const organizations = res.items.map((org: any) => ({
      id: org.id,
      name: org.name,
    }))

    return new Response(JSON.stringify({ items: organizations }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching organizations:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

const organizationsGetDoc: OpenApiMethodDoc = {
  summary: 'Resolve organization labels',
  description: 'Fetches organization names for the provided identifiers within the current tenant scope.',
  tags: [exampleTag],
  query: organizationQuerySchema,
  responses: [
    { status: 200, description: 'Resolved organizations.', schema: exampleOrganizationResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
    { status: 500, description: 'Unexpected server error', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example organizations lookup',
  methods: {
    GET: organizationsGetDoc,
  },
}
