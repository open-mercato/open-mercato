import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  
  const url = new URL(req.url)
  const idsParam = url.searchParams.get('ids')
  
  const where: any = {}
  if (auth.tenantId) where.tenant = auth.tenantId as any
  
  // Support filtering by specific IDs
  if (idsParam) {
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length > 0) where.id = { $in: ids }
  }
  
  try {
    const orgs = await em.find(Organization, where, { populate: ['tenant'] })
    const items = (orgs || []).map((o: any) => ({ id: String(o.id), name: String(o.name || '') }))
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ items: [] })
  }
}


