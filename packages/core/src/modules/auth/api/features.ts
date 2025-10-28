import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { modules } from '@/generated/modules.generated'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const items = (modules || []).flatMap((m: any) =>
    (m.features || []).map((f: any) => ({ id: String(f.id), title: String(f.title || f.id), module: String(f.module || m.id) }))
  )
  // Deduplicate by id
  const byId = new Map<string, { id: string; title: string; module: string }>()
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it)
  const list = Array.from(byId.values()).sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id))
  
  // Build module info map
  const moduleInfo = new Map<string, { id: string; title: string }>()
  for (const m of modules) {
    if (m.id) {
      moduleInfo.set(m.id, { id: m.id, title: (m.info as any)?.title || m.id })
    }
  }
  
  return NextResponse.json({ items: list, modules: Array.from(moduleInfo.values()) })
}

const featureItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
})

const featureModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
})

const featuresResponseSchema = z.object({
  items: z.array(featureItemSchema),
  modules: z.array(featureModuleSchema),
})

const featuresMethodDoc: OpenApiMethodDoc = {
  summary: 'List declared feature flags',
  description: 'Returns all static features contributed by the enabled modules along with their module source.',
  tags: ['Authentication & Accounts'],
  responses: [
    {
      status: 200,
      description: 'Aggregated feature catalog',
      schema: featuresResponseSchema,
    },
  ],
  errors: [
    {
      status: 401,
      description: 'Missing authentication',
      schema: z.object({ error: z.string() }),
    },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List declared feature flags',
  methods: {
    GET: featuresMethodDoc,
  },
}
