import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const features: string[] = Array.isArray(body?.features) ? body.features : []
  if (!features.length) return NextResponse.json({ ok: true, granted: [] })
  const container = await createRequestContainer()
  const rbac = container.resolve<any>('rbacService')
  const ok = await rbac.userHasAllFeatures(auth.sub, features, { tenantId: auth.tenantId, organizationId: auth.orgId })
  // Return which features the user has (for batch checking)
  if (ok) {
    return NextResponse.json({ ok: true, granted: features })
  }
  // Check individually to see which features are granted
  const granted: string[] = []
  for (const f of features) {
    const hasFeature = await rbac.userHasAllFeatures(auth.sub, [f], { tenantId: auth.tenantId, organizationId: auth.orgId })
    if (hasFeature) granted.push(f)
  }
  return NextResponse.json({ ok: false, granted })
}


