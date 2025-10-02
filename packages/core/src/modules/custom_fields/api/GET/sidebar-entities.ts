import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { EntityManager } from '@mikro-orm/core'
import { CustomEntity } from '@open-mercato/core/modules/custom_fields/data/entities'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  // Get user entities that are marked to show in sidebar
  const where: any = { 
    isActive: true,
    showInSidebar: true
  }
  where.$and = [
    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  
  const entities = await em.find(CustomEntity as any, where as any, { orderBy: { label: 'asc' } as any })
  
  const items = (entities as any[]).map((e) => ({
    entityId: e.entityId,
    label: e.label,
    href: `/backend/definitions/${encodeURIComponent(e.entityId)}/records`
  }))

  return NextResponse.json({ items })
}
