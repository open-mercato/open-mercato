import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { invalidateDefinitionsCache } from './definitions.cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  beginEntitiesMutationGuard,
  FIELD_DEFINITION_RESOURCE_KIND,
} from './definitions.mutation-guard'
import { createExactDefinitionWhere, resolveDefinitionMutationScope } from '../lib/definition-scope'

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
  const scope = await resolveDefinitionMutationScope({ auth, container, request: req })
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  const where: any = createExactDefinitionWhere(entityId, key, scope)
  const def = await em.findOne(CustomFieldDef, where)
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const guard = await beginEntitiesMutationGuard({
    container,
    auth,
    req,
    resourceKind: FIELD_DEFINITION_RESOURCE_KIND,
    resourceId: def.id,
    operation: 'custom',
    mutationPayload: { entityId, key },
  })
  if (guard.blockedResponse) return guard.blockedResponse

  ;(def as any).deletedAt = null
  ;(def as any).isActive = true
  ;(def as any).updatedAt = new Date()
  em.persist(def)
  await em.flush()
  await guard.runAfterSuccess()
  await invalidateDefinitionsCache(cache, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
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
