import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { upsertEncryptionMapSchema } from '@open-mercato/core/modules/entities/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const ENCRYPTION_MAP_RESOURCE_KIND = 'entities.encryption_map'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

function resolveScope(auth: { tenantId?: string | null; orgId?: string | null }) {
  return {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  const trimmed = String(value).trim()
  return trimmed.length ? trimmed : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId, organizationId } = resolveScope(auth)

  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const repo = em.getRepository(EncryptionMap)
  // Prefer tenant+org, then tenant-global, then global
  const candidates = [
    { entityId, tenantId, organizationId },
    { entityId, tenantId, organizationId: null },
    { entityId, tenantId: null, organizationId: null },
  ]
  let record: any = null
  for (const where of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const found = await repo.findOne({ ...where, deletedAt: null })
    if (found) {
      record = found
      break
    }
  }

  return NextResponse.json({
    entityId,
    tenantId,
    organizationId,
    fields: record?.fieldsJson ?? [],
    isActive: record?.isActive ?? true,
    updatedAt: toIsoOrNull(record?.updatedAt),
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = upsertEncryptionMapSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
    }
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scope = resolveScope(auth)
    const payload = parsed.data
    const tenantId: string = auth.tenantId
    const organizationId = scope.organizationId

    const container = await createRequestContainer()
    const em = container.resolve('em') as any
    const repo = em.getRepository(EncryptionMap)
    const existing = await repo.findOne({ entityId: payload.entityId, tenantId, organizationId, deletedAt: null })

    // Reject stale writes: a save started from an older tab must not silently
    // overwrite a newer encryption configuration. No-op when the client did not
    // send the expected-version header (strictly additive).
    if (existing) {
      enforceCommandOptimisticLock({
        resourceKind: ENCRYPTION_MAP_RESOURCE_KIND,
        resourceId: existing.id,
        current: existing.updatedAt,
        request: req,
      })
    }

    // Mutation-guard contract for custom write routes. The resource is the
    // encryption map for this entity scoped to the tenant/organization.
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: ENCRYPTION_MAP_RESOURCE_KIND,
      resourceId: existing?.id ?? payload.entityId,
      operation: existing ? 'update' : 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    let saved: any
    if (existing) {
      existing.fieldsJson = payload.fields
      existing.isActive = payload.isActive ?? true
      existing.updatedAt = new Date()
      await em.persist(existing).flush()
      saved = existing
    } else {
      const map = repo.create({
        entityId: payload.entityId,
        tenantId,
        organizationId,
        fieldsJson: payload.fields,
        isActive: payload.isActive ?? true,
      })
      await em.persist(map).flush()
      saved = map
    }

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: ENCRYPTION_MAP_RESOURCE_KIND,
        resourceId: saved?.id ?? payload.entityId,
        operation: existing ? 'update' : 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    try {
      const svc = container.resolve('tenantEncryptionService') as { invalidateMap?: (e: string, t: string | null, o: string | null) => Promise<void> }
      await svc?.invalidateMap?.(payload.entityId, tenantId, organizationId)
    } catch {
      // best-effort cache bust
    }

    return NextResponse.json({ ok: true, updatedAt: toIsoOrNull(saved?.updatedAt) })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

const conflictResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Manage encryption maps',
  methods: {
    GET: {
      summary: 'Fetch encryption map',
      description: 'Returns the encrypted field map for the current tenant/organization scope.',
      query: z.object({ entityId: z.string() }),
      responses: [{ status: 200, description: 'Map', schema: z.object({ entityId: z.string(), fields: z.array(z.object({ field: z.string(), hashField: z.string().nullable().optional() })), isActive: z.boolean().optional(), updatedAt: z.string().nullable().optional() }) }],
    },
    POST: {
      summary: 'Upsert encryption map',
      description: 'Creates or updates the encryption map for the current tenant/organization scope. Enforces optimistic locking when the caller sends the expected version header.',
      requestBody: { contentType: 'application/json', schema: upsertEncryptionMapSchema },
      responses: [
        { status: 200, description: 'Saved', schema: z.object({ ok: z.boolean(), updatedAt: z.string().nullable().optional() }) },
        { status: 409, description: 'Optimistic-lock conflict (stale write)', schema: conflictResponseSchema },
      ],
    },
  },
}
