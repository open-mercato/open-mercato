import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { UserAcl } from '@open-mercato/core/modules/auth/data/entities'

const getSchema = z.object({ userId: z.string().uuid() })
const putSchema = z.object({
  userId: z.string().uuid(),
  isSuperAdmin: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  organizations: z.array(z.string()).nullable().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  if (!acl) return NextResponse.json({ isSuperAdmin: false, features: [], organizations: null })
  return NextResponse.json({ isSuperAdmin: !!acl.isSuperAdmin, features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [], organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null })
}

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  let acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  if (!acl) { acl = em.create(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any }) }
  if (parsed.data.isSuperAdmin !== undefined) (acl as any).isSuperAdmin = !!parsed.data.isSuperAdmin
  if (parsed.data.features !== undefined) (acl as any).featuresJson = parsed.data.features
  if (parsed.data.organizations !== undefined) (acl as any).organizationsJson = parsed.data.organizations
  await em.persistAndFlush(acl)
  return NextResponse.json({ ok: true })
}


