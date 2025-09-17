import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromCookies } from '@/lib/auth/server'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { QueryEngine, Where } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { z } from 'zod'

// Simple UUID validation
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional().default('id'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  title: z.string().optional(),
  severity: z.string().optional(),
  severityIn: z.string().optional(),
  isDone: z.coerce.boolean().optional(),
  isBlocked: z.coerce.boolean().optional(),
  withDeleted: z.coerce.boolean().optional().default(false),
  organizationId: z.string().uuid().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  labelsIn: z.string().optional(),
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
    
    if (!auth?.orgId || !auth?.tenantId) {
      console.error('Missing auth context:', { orgId: auth?.orgId, tenantId: auth?.tenantId })
      return new Response(JSON.stringify({ error: 'Unauthorized - missing organization or tenant context' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Validate that tenantId is a valid UUID
    if (typeof auth.tenantId !== 'string' || !isValidUUID(auth.tenantId)) {
      console.error('Invalid tenantId:', auth.tenantId)
      return new Response(JSON.stringify({ error: 'Invalid tenant context - tenant ID is required' }), {
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

    // Build typed object-style filters
    type TodoFields = {
      id: string
      title: string
      is_done: boolean
      tenant_id: string | null
      organization_id: string | null
      created_at: Date
      'cf:priority': number
      'cf:severity': string
      'cf:blocked': boolean
      'cf:labels': string
    }
    const filters: Where<TodoFields> = {}
    if (validatedQuery.title) filters.title = { $ilike: `%${validatedQuery.title}%` }
    if (validatedQuery.isDone !== undefined) filters.is_done = validatedQuery.isDone
    if (validatedQuery.organizationId) filters.organization_id = validatedQuery.organizationId
    if (validatedQuery.severity) filters['cf:severity'] = validatedQuery.severity
    if (validatedQuery.severityIn) {
      const list = validatedQuery.severityIn.split(',').map((s) => s.trim()).filter(Boolean)
      if (list.length) filters['cf:severity'] = { $in: list as any }
    }
    if (validatedQuery.labelsIn) {
      const list = validatedQuery.labelsIn.split(',').map((s) => s.trim()).filter(Boolean)
      if (list.length) filters['cf:labels'] = { $in: list as any }
    }
    if (validatedQuery.isBlocked !== undefined) filters['cf:blocked'] = validatedQuery.isBlocked
    if (validatedQuery.createdFrom || validatedQuery.createdTo) {
      const range: any = {}
      if (validatedQuery.createdFrom) range.$gte = new Date(validatedQuery.createdFrom)
      if (validatedQuery.createdTo) range.$lte = new Date(validatedQuery.createdTo)
      filters.created_at = range
    }

    // Query todos with custom fields
    const res = await queryEngine.query(E.example.todo, {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      fields: [id, title, tenant_id, organization_id, is_done, 'cf:priority', 'cf:severity', 'cf:blocked', 'cf:labels'],
      sort: [{ field: sortField, dir: sortDir }],
      page: { page: validatedQuery.page, pageSize: validatedQuery.pageSize },
      filters,
      withDeleted: validatedQuery.withDeleted,
    })

    // Map to response format
    const todos = res.items.map((item) => ({
      id: item.id,
      title: item.title,
      tenant_id: item.tenant_id,
      organization_id: item.organization_id,
      is_done: item.is_done,
      cf_priority: item['cf:priority'] ?? item.cf_priority,
      cf_severity: Array.isArray(item['cf:severity']) ? item['cf:severity'][0] : (item['cf:severity'] ?? item.cf_severity),
      cf_blocked: item['cf:blocked'] ?? item.cf_blocked,
      cf_labels: Array.isArray(item['cf:labels']) ? item['cf:labels'][0] : (item['cf:labels'] ?? (item as any).cf_labels),
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
