import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { deleteUserPerspective } from '@open-mercato/core/modules/perspectives/services/perspectiveService'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['perspectives.use'] },
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

export async function DELETE(req: Request, ctx: { params: { tableId: string; perspectiveId: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tableId = decodeParam(ctx.params?.tableId).trim()
  const perspectiveId = decodeParam(ctx.params?.perspectiveId).trim()
  if (!tableId || !perspectiveId) {
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

  await deleteUserPerspective(em, cache, {
    scope: {
      userId: auth.sub,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    },
    tableId,
    perspectiveId,
  })

  return NextResponse.json({ success: true })
}
