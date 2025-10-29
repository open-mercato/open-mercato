import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { EntityManager } from '@mikro-orm/core'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const cache = resolve('cache') as any

  const where: any = { 
    isActive: true,
    showInSidebar: true
  }
  where.$and = [
//    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] }, // the entities and custom fields are defined per tenant
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  
  // Try cache first to avoid repeated queries on focus refreshes
  const cacheKey = `entities:sidebar:${auth.tenantId || 'null'}`
  try {
    if (cache) {
      const cached = await cache.get(cacheKey)
      if (cached && Array.isArray(cached.items)) return NextResponse.json(cached)
    }
  } catch {}

  const entities = await em.find(CustomEntity as any, where as any, { orderBy: { label: 'asc' } as any })
  
  const items = (entities as any[]).map((e) => ({
    entityId: e.entityId,
    label: e.label,
    href: `/backend/entities/user/${encodeURIComponent(e.entityId)}/records`
  }))

  const payload = { items }
  try {
    if (cache) await cache.set(cacheKey, payload, { tags: [`nav:entities:${auth.tenantId || 'null'}`] })
  } catch {}
  return NextResponse.json(payload)
}

const sidebarEntitiesResponseSchema = z.object({
  items: z.array(
    z.object({
      entityId: z.string(),
      label: z.string(),
      href: z.string(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'List sidebar entities',
  methods: {
    GET: {
      summary: 'Get sidebar entities',
      description: 'Returns custom entities flagged with `showInSidebar` for the current tenant/org scope.',
      responses: [
        {
          status: 200,
          description: 'Sidebar entities for navigation',
          schema: sidebarEntitiesResponseSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
