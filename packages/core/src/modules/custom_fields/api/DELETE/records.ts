import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldValue } from '../../data/entities'

export const metadata = {
  DELETE: { requireAuth: true, requireRoles: ['admin'] },
}

const bodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
})

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Accept either query params or JSON body
  const url = new URL(req.url)
  const qpEntityId = url.searchParams.get('entityId')
  const qpRecordId = url.searchParams.get('recordId')
  let payload: any = qpEntityId && qpRecordId ? { entityId: qpEntityId, recordId: qpRecordId } : null
  if (!payload) {
    try { payload = await req.json() } catch { payload = null }
  }
  const parsed = bodySchema.safeParse(payload)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, recordId } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    // Soft-delete by marking CF values for this record as deleted_at now
    const rows = await em.find(CustomFieldValue, {
      entityId,
      recordId,
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
    })
    if (!rows.length) return NextResponse.json({ ok: true })
    const now = new Date()
    for (const r of rows) {
      r.deletedAt = r.deletedAt ?? now
    }
    await em.persistAndFlush(rows)

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


