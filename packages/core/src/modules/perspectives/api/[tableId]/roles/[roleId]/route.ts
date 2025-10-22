import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { clearRolePerspectives } from '@open-mercato/core/modules/perspectives/services/perspectiveService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['perspectives.role_defaults'] },
}

const decodeParam = (value: string | string[] | undefined): string => {
  if (!value) return ''
  const raw = Array.isArray(value) ? value[0] : value
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export async function DELETE(req: Request, ctx: { params: { tableId: string; roleId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const roleId = decodeParam(ctx.params?.roleId).trim()
  if (!tableId || !roleId) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const cache = ((): import('@open-mercato/cache').CacheStrategy | null => {
    try {
      return container.resolve('cache') as import('@open-mercato/cache').CacheStrategy
    } catch {
      return null
    }
  })()

  const scope = auth.tenantId
    ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
    : { tenantId: null }

  const role = await em.findOne(Role, { id: roleId, deletedAt: null, ...(scope as any) } as any)
  if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

  await clearRolePerspectives(em, cache, {
    tableId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    roleIds: [roleId],
  })

  return NextResponse.json({ success: true })
}
