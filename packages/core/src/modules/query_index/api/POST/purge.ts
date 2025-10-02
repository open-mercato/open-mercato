import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'

export const metadata = {
  POST: { requireAuth: true, requireRoles: ['admin'] as const },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as any
  const entityType = String(body?.entityType || '')
  if (!entityType) return NextResponse.json({ error: 'Missing entityType' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const bus = resolve('eventBus') as any
  await bus.emitEvent('query_index.purge', { entityType, organizationId: auth.orgId, tenantId: auth.tenantId }, { persistent: true })
  return NextResponse.json({ ok: true })
}


