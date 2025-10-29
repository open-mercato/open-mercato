import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  // Load all scoped records (active/inactive/deleted) so that per-scope tombstones
  // can shadow global definitions. We'll filter out deleted winners later.
  const defs = await em.find(CustomFieldDef, {
    entityId,
    deletedAt: null,
    isActive: true,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  }, { orderBy: { key: 'asc' } as any })

  // Also load tombstones to shadow lower-scope/global entries with the same key
  const tombstones = await em.find(CustomFieldDef, {
    entityId,
    deletedAt: { $ne: null } as any,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  })
  const tombstonedKeys = new Set<string>((tombstones as any[]).map((d: any) => d.key))

  // Deduplicate by key, with clear precedence that allows higher-scope tombstones
  // to shadow lower-scope active definitions:
  // 1) Scope specificity first: tenant > org > global
  // 2) Within the same scope, latest updatedAt wins
  const byKey = new Map<string, any>()
  const ts = (x: any) => {
    const u = (x?.updatedAt instanceof Date) ? x.updatedAt.getTime() : (x?.updatedAt ? new Date(x.updatedAt).getTime() : 0)
    if (u) return u
    const c = (x?.createdAt instanceof Date) ? x.createdAt.getTime() : (x?.createdAt ? new Date(x.createdAt).getTime() : 0)
    return c
  }
  const scopeScore = (x: any) => (x?.tenantId ? 2 : 0) + (x?.organizationId ? 1 : 0)
  for (const d of defs) {
    const existing = byKey.get(d.key)
    if (!existing) { byKey.set(d.key, d); continue }
    const sNew = scopeScore(d)
    const sOld = scopeScore(existing)
    if (sNew > sOld) { byKey.set(d.key, d); continue }
    if (sNew < sOld) continue
    const tNew = ts(d)
    const tOld = ts(existing)
    if (tNew >= tOld) byKey.set(d.key, d)
  }
  // Exclude winners that have a tombstone in scope
  const winners = Array.from(byKey.values()).filter((d: any) => !tombstonedKeys.has(d.key))
  const items = winners.map((d: any) => ({
    id: d.id,
    key: d.key,
    kind: d.kind,
    configJson: d.configJson,
    isActive: d.isActive,
    organizationId: d.organizationId ?? null,
    tenantId: d.tenantId ?? null,
  }))
  const deletedKeys = Array.from(tombstonedKeys)
  return NextResponse.json({ items, deletedKeys })
}

const definitionsManageQuerySchema = z.object({
  entityId: z.string(),
})

const managedDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  kind: z.string(),
  configJson: z.record(z.any()).nullable().optional(),
  isActive: z.boolean().optional(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
})

const definitionsManageResponseSchema = z.object({
  items: z.array(managedDefinitionSchema),
  deletedKeys: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Inspect scoped custom field definitions',
  methods: {
    GET: {
      summary: 'Get management snapshot',
      description: 'Returns scoped custom field definitions (including inactive tombstones) for administration interfaces.',
      query: definitionsManageQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Scoped definitions and deleted keys',
          schema: definitionsManageResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Missing authentication or feature',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
