import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromCookies } from '@/lib/auth/server'
import { E } from '@open-mercato/core/datamodel/entities'
import { id, name } from '@open-mercato/core/datamodel/entities/organization'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

export const metadata = {
  GET: {
    requireAuth: true,
    requireRoles: ['admin']
  },
  POST: {
    requireAuth: true,
    requireRoles: ['admin', 'superuser']
  },
  PUT: {
    requireAuth: true,
    requireRoles: ['admin']
  },
  DELETE: {
    requireAuth: true,
    requireRoles: ['admin', 'superuser']
  }
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    const auth = await getAuthFromCookies()
    
    if (!auth?.orgId) {
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
      organizationId: auth.orgId,
      fields: [id, name],
      filters: {
        id: { $in: organizationIds }
      }
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
