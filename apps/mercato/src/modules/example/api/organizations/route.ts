import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { id, name } from '@/.mercato/generated/entities/organization'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  exampleErrorSchema,
  exampleOrganizationResponseSchema,
  exampleTag,
  organizationQuerySchema,
} from '../openapi'

const logger = createLogger('example').child({ component: 'organizations-route' })

type OrganizationRow = {
  id: string
  name: string | null
}

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
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()

    if (!auth?.tenantId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const organizationIds = parseCommaSeparatedList(url.searchParams.get('ids'))

    if (organizationIds.length === 0) {
      return Response.json({ items: [] })
    }

    // Query organizations. Typing the result parameter keeps the projection honest:
    // adding a field to `fields` without adding it to `OrganizationRow` fails to compile.
    const res = await queryEngine.query<OrganizationRow>(E.directory.organization, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId || undefined, // optional filter
      fields: [id, name],
      filters: [
        { field: 'id', op: 'in', value: organizationIds }
      ]
    })

    const organizations = res.items.map((org) => ({
      id: org.id,
      name: org.name,
    }))

    return Response.json({ items: organizations })
  } catch (error) {
    logger.error('Failed to resolve organization labels', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
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
