import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { setRecordCustomFields } from '../../lib/helpers'

export const metadata = {
  PUT: { requireAuth: true, requireRoles: ['admin'] },
}

const bodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  values: z.record(z.any()).default({}),
})

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, recordId, values } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    await setRecordCustomFields(em, {
      entityId,
      recordId,
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
      values: normalizeValues(values),
    })

    return NextResponse.json({ ok: true, item: { entityId, recordId } })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function normalizeValues(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(input || {})) {
    const key = k.startsWith('cf_') ? k.replace(/^cf_/, '') : k
    out[key] = v
  }
  return out
}


