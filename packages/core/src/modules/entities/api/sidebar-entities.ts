import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { EntityManager } from '@mikro-orm/core'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { canReadEntityMetadata, getDeclaredCustomEntityRestriction } from '../lib/entityAcl'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.records.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const cache = resolve('cache') as any
  const rbac = resolve('rbacService') as RbacService
  const acl = await rbac.loadAcl(auth.sub ?? '', {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  const where: any = { 
    isActive: true,
    showInSidebar: true
  }
  where.$and = [
//    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] }, // the entities and custom fields are defined per tenant
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  
  const cacheKey = `entities:sidebar:v2:${auth.tenantId || 'null'}`
  let candidates: Array<{
    entityId: string
    label: string
    href: string
    accessRestricted: boolean
  }> | null = null
  try {
    if (cache) {
      const cached = await cache.get(cacheKey)
      if (cached && Array.isArray(cached.candidates)) candidates = cached.candidates
    }
  } catch {}

  if (!candidates) {
    const entities = await em.find(CustomEntity as any, where as any, { orderBy: { label: 'asc' } as any })
    candidates = (entities as any[]).map((entity) => ({
      entityId: entity.entityId,
      label: entity.label,
      href: `/backend/entities/user/${encodeURIComponent(entity.entityId)}/records`,
      accessRestricted: getDeclaredCustomEntityRestriction(entity.entityId)
        ?? entity.accessRestricted === true,
    }))
    try {
      if (cache) {
        await cache.set(cacheKey, { candidates }, { tags: [`nav:entities:${auth.tenantId || 'null'}`] })
      }
    } catch {}
  }

  const items = candidates
    .filter((entity) => canReadEntityMetadata({
      entityId: entity.entityId,
      isCustomEntity: true,
      isRestricted: entity.accessRestricted,
      acl,
    }))
    .map((entity) => ({
      entityId: entity.entityId,
      label: entity.label,
      href: entity.href,
    }))
  const payload = { items }
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
