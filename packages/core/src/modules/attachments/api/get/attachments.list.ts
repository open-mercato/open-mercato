import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  const recordId = url.searchParams.get('recordId') || ''
  if (!entityId || !recordId) return NextResponse.json({ error: 'entityId and recordId are required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const { Attachment } = await import('../../data/entities')
  const items = await em.find(Attachment as any, { entityId, recordId, organizationId: auth.orgId!, tenantId: auth.tenantId! }, { orderBy: { createdAt: 'desc' } as any })
  return NextResponse.json({ items: items.map((a: any) => ({ id: a.id, url: a.url, fileName: a.fileName, fileSize: a.fileSize, createdAt: a.createdAt })) })
}

