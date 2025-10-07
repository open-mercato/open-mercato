import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { EntityManager } from '@mikro-orm/core'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const where: any = { 
    isActive: true,
    showInSidebar: true
  }
  where.$and = [
//    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] }, // the entities and custom fields are defined per tenant
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  
  const entities = await em.find(CustomEntity as any, where as any, { orderBy: { label: 'asc' } as any })
  
  const items = (entities as any[]).map((e) => ({
    entityId: e.entityId,
    label: e.label,
    href: `/backend/entities/user/${encodeURIComponent(e.entityId)}/records`
  }))

  return NextResponse.json({ items })
}
