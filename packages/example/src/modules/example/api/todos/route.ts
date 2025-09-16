import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromCookies } from '@/lib/auth/server'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { z } from 'zod'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional().default('id'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  title: z.string().optional(),
  severity: z.string().optional(),
  isDone: z.coerce.boolean().optional(),
  isBlocked: z.coerce.boolean().optional(),
  organizationId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
})

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
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const validatedQuery = querySchema.parse(queryParams)

    // Build sort configuration
    const sortField = validatedQuery.sortField === 'id' ? id : validatedQuery.sortField
    const sortDir = validatedQuery.sortDir === 'desc' ? SortDir.Desc : SortDir.Asc

    // Build filter conditions
    const filters: any = {}
    if (validatedQuery.title) {
      filters.title = { $ilike: `%${validatedQuery.title}%` }
    }
    if (validatedQuery.isDone !== undefined) {
      filters.is_done = validatedQuery.isDone
    }
    if (validatedQuery.organizationId) {
      filters.organization_id = validatedQuery.organizationId
    }
    if (validatedQuery.tenantId) {
      filters.tenant_id = validatedQuery.tenantId
    }

    // Query todos with custom fields
    const res = await queryEngine.query(E.example.todo, {
      organizationId: auth.orgId,
      fields: [id, title, tenant_id, organization_id, is_done, 'cf:priority', 'cf:severity', 'cf:blocked'],
      sort: [{ field: sortField, dir: sortDir }],
      page: { page: validatedQuery.page, pageSize: validatedQuery.pageSize },
      filters,
    })

    // Apply custom field filters after query (since query engine doesn't support CF filters yet)
    let filteredItems = res.items as any[]
    
    if (validatedQuery.severity) {
      filteredItems = filteredItems.filter(item => 
        (item['cf:severity'] ?? item.cf_severity) === validatedQuery.severity
      )
    }
    
    if (validatedQuery.isBlocked !== undefined) {
      filteredItems = filteredItems.filter(item => 
        (item['cf:blocked'] ?? item.cf_blocked) === validatedQuery.isBlocked
      )
    }

    // Map to response format
    const todos = filteredItems.map((item) => ({
      id: item.id,
      title: item.title,
      tenant_id: item.tenant_id,
      organization_id: item.organization_id,
      is_done: item.is_done,
      cf_priority: item['cf:priority'] ?? item.cf_priority,
      cf_severity: item['cf:severity'] ?? item.cf_severity,
      cf_blocked: item['cf:blocked'] ?? item.cf_blocked,
    }))

    return new Response(JSON.stringify({
      items: todos,
      total: res.total,
      page: validatedQuery.page,
      pageSize: validatedQuery.pageSize,
      totalPages: Math.ceil(res.total / validatedQuery.pageSize),
    }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching todos:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
