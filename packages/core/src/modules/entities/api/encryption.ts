import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { upsertEncryptionMapSchema } from '@open-mercato/core/modules/entities/data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildOptimisticLockConflictBody,
  enforceCommandOptimisticLock,
  readOptimisticLockExpected,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { normalizeIsoToken, parseOptimisticLockEnv } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_ENV_VAR } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  EncryptionMapVersionConflictError,
  resolveCanonicalEncryptionMap,
  upsertCanonicalEncryptionMap,
} from '@open-mercato/core/modules/entities/lib/encryption-maps'

const ENCRYPTION_MAP_RESOURCE_KIND = 'entities.encryption_map'

const logger = createLogger('entities').child({ component: 'encryption-map-api' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

function shouldEnforceVersionOnWrite(req: Request): boolean {
  const expected = readOptimisticLockExpected(req)
  if (!expected || normalizeIsoToken(expected) == null) return false
  const config = parseOptimisticLockEnv(process.env[OPTIMISTIC_LOCK_ENV_VAR])
  if (config.mode === 'off') return false
  return config.mode === 'all' || config.entities.has(ENCRYPTION_MAP_RESOURCE_KIND)
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

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId
  const organizationId = scope.selectedId
  const em = container.resolve('em') as any
  const repo = em.getRepository(EncryptionMap)
  // Prefer tenant+org, then tenant-global, then global
  const candidates = [
    { entityId, tenantId, organizationId },
    { entityId, tenantId, organizationId: null },
    { entityId, tenantId: null, organizationId: null },
  ]
  let record: ReturnType<typeof resolveCanonicalEncryptionMap> = null
  for (const where of candidates) {
    const found = await repo.find(
      { ...where, deletedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    )
    const canonical = resolveCanonicalEncryptionMap(found)
    if (canonical) {
      record = canonical
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
    const payload = parsed.data

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    if (scope.selectionRejected) {
      return NextResponse.json(
        {
          error: 'Your selected organization is no longer available. Please re-select an organization and try again.',
          code: 'organization_selection_invalid',
        },
        { status: 422 },
      )
    }
    const tenantId = scope.tenantId ?? auth.tenantId
    const organizationId = scope.selectedId
    const em = container.resolve('em') as any
    const repo = em.getRepository(EncryptionMap)
    const existingRecords = await repo.find(
      { entityId: payload.entityId, tenantId, organizationId, deletedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    )
    const existing = resolveCanonicalEncryptionMap(existingRecords)

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

    let saved: Awaited<ReturnType<typeof upsertCanonicalEncryptionMap>>
    try {
      saved = await upsertCanonicalEncryptionMap(em, {
        entityId: payload.entityId,
        tenantId,
        organizationId,
        fields: payload.fields,
        isActive: payload.isActive ?? true,
        // The version check above is advisory; this makes the write itself conditional so a
        // concurrent save that lands between that read and this upsert is not overwritten.
        expectedUpdatedAt: existing && shouldEnforceVersionOnWrite(req) ? existing.updatedAt : null,
      })
    } catch (err) {
      if (err instanceof EncryptionMapVersionConflictError) {
        const expectedIso = err.expectedUpdatedAt.toISOString()
        const currentIso = err.currentUpdatedAt ? err.currentUpdatedAt.toISOString() : expectedIso
        throw new CrudHttpError(409, buildOptimisticLockConflictBody(currentIso, expectedIso))
      }
      throw err
    }

    // The map row is committed and every reader resolves policy from it, so a failure to drop
    // this process's per-request memo must not turn a successful write into an error response.
    try {
      const svc = container.resolve('tenantEncryptionService') as { invalidateMap?: (e: string, t: string | null, o: string | null) => Promise<void> }
      if (!svc || typeof svc.invalidateMap !== 'function') {
        throw new Error('[internal] Tenant encryption service cannot invalidate map caches')
      }
      await svc.invalidateMap(payload.entityId, tenantId, organizationId)
    } catch (err) {
      logger.warn('Encryption map saved but post-commit invalidation failed', {
        entityId: payload.entityId,
        err,
      })
      getTelemetryRuntime()?.reportError(err, {
        module: 'entities',
        code: 'entities.encryption_map_invalidation_failed',
        attributes: { entityId: payload.entityId },
      })
    }

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: ENCRYPTION_MAP_RESOURCE_KIND,
        resourceId: saved.id,
        operation: existing ? 'update' : 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, updatedAt: toIsoOrNull(saved.updatedAt) })
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

const organizationSelectionInvalidResponseSchema = z.object({
  error: z.string(),
  code: z.literal('organization_selection_invalid'),
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
        { status: 422, description: 'Selected organization is unavailable', schema: organizationSelectionInvalidResponseSchema },
      ],
    },
  },
}
