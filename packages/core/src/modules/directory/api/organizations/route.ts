import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.organizations.list'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const where: any = {}
  if (auth.tenantId) where.tenant = auth.tenantId as any
  try {
    const orgs = await em.find(Organization, where, { populate: ['tenant'] })
    const items = (orgs || []).map((o: any) => ({ id: String(o.id), name: String(o.name || '') }))
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ items: [] })
  }
}


