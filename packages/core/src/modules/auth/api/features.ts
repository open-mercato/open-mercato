import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { modules } from '@/generated/modules.generated'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'], requireFeatures: ['auth.acl.manage'] },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const items = (modules || []).flatMap((m: any) =>
    (m.features || []).map((f: any) => ({ id: String(f.id), title: String(f.title || f.id), module: String(f.module || m.id) }))
  )
  // Deduplicate by id
  const byId = new Map<string, { id: string; title: string; module: string }>()
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it)
  const list = Array.from(byId.values()).sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id))
  return NextResponse.json({ items: list })
}


