import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { invalidateDefinitionsCache } from './definitions.cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { entityId, key } = body || {}
  if (!entityId || !key) return NextResponse.json({ error: 'entityId and key are required' }, { status: 400 })

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  const where: any = { entityId, key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const def = await em.findOne(CustomFieldDef, where)
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  ;(def as any).deletedAt = null
  ;(def as any).isActive = true
  ;(def as any).updatedAt = new Date()
  em.persist(def)
  await em.flush()
  await invalidateDefinitionsCache(cache, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    entityIds: [entityId],
  })
  return NextResponse.json({ ok: true })
}

const restoreDefinitionRequestSchema = z.object({
  entityId: z.string(),
  key: z.string(),
})

const restoreDefinitionResponseSchema = z.object({
  ok: z.literal(true),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Restore soft-deleted custom field definitions',
  methods: {
    POST: {
      summary: 'Restore definition',
      description: 'Reactivates a previously soft-deleted definition within the current tenant/org scope.',
      requestBody: {
        contentType: 'application/json',
        schema: restoreDefinitionRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Definition restored',
          schema: restoreDefinitionResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id or key',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Definition not found',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
