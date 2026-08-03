import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { beginEntitiesMutationGuard } from './definitions.mutation-guard'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ModuleConfigService } from '../../configs/lib/module-config-service'

// Tenant-scoped policy: when true, new custom entities are created with
// `access_restricted = true` unless the create request explicitly sets the flag.
const CONFIG_MODULE = 'entities'
const NEW_ENTITIES_RESTRICTED_KEY = 'newEntitiesRestrictedByDefault'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
  PUT: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

async function readPolicy(tenantId: string | null): Promise<boolean> {
  try {
    const { resolve } = await createRequestContainer()
    const moduleConfigService = resolve('moduleConfigService') as ModuleConfigService
    const value = await moduleConfigService.getValue(CONFIG_MODULE, NEW_ENTITIES_RESTRICTED_KEY, {
      defaultValue: false,
      scope: { tenantId },
    })
    return value === true
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { resolve } = await createRequestContainer()
  const moduleConfigService = resolve('moduleConfigService') as ModuleConfigService
  const record = await moduleConfigService.getRecord(CONFIG_MODULE, NEW_ENTITIES_RESTRICTED_KEY, {
    tenantId: auth.tenantId ?? null,
  })
  return NextResponse.json({
    newEntitiesRestrictedByDefault: record ? record.value === true : false,
    updatedAt: record ? record.updatedAt : null,
  })
}

const putBodySchema = z.object({
  newEntitiesRestrictedByDefault: z.boolean(),
  expectedUpdatedAt: z.string().optional(),
})

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const container = await createRequestContainer()
  const { resolve } = container
  const moduleConfigService = resolve('moduleConfigService') as ModuleConfigService

  const currentRecord = await moduleConfigService.getRecord(
    CONFIG_MODULE,
    NEW_ENTITIES_RESTRICTED_KEY,
    { tenantId: auth.tenantId ?? null },
  )

  const guard = await beginEntitiesMutationGuard({
    container,
    auth,
    req,
    resourceKind: 'entities.settings',
    resourceId: NEW_ENTITIES_RESTRICTED_KEY,
    operation: currentRecord ? 'update' : 'create',
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  })
  if (guard.blockedResponse) return guard.blockedResponse

  const ifMatchHeader = req.headers.get('If-Match') || req.headers.get('x-om-ext-optimistic-lock-expected-updated-at')
  const expectedUpdatedAt = ifMatchHeader || parsed.data.expectedUpdatedAt

  try {
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'entities.settings',
      resourceId: NEW_ENTITIES_RESTRICTED_KEY,
      current: currentRecord ? currentRecord.updatedAt : null,
      expected: expectedUpdatedAt,
      request: req,
    })
  } catch (lockError) {
    if (isCrudHttpError(lockError)) {
      return NextResponse.json(lockError.body, { status: lockError.status })
    }
    throw lockError
  }

  const updatedRecord = await moduleConfigService.setValue(
    CONFIG_MODULE,
    NEW_ENTITIES_RESTRICTED_KEY,
    parsed.data.newEntitiesRestrictedByDefault,
    { tenantId: auth.tenantId ?? null },
  )

  await guard.runAfterSuccess()

  return NextResponse.json({
    ok: true,
    newEntitiesRestrictedByDefault: parsed.data.newEntitiesRestrictedByDefault,
    updatedAt: updatedRecord ? updatedRecord.updatedAt : null,
  })
}

const settingsResponseSchema = z.object({
  newEntitiesRestrictedByDefault: z.boolean(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Custom entity workspace settings',
  methods: {
    GET: {
      summary: 'Get custom entity settings',
      description: 'Returns the tenant-scoped default-restricted policy for new custom entities.',
      responses: [
        { status: 200, description: 'Current settings', schema: settingsResponseSchema },
        { status: 401, description: 'Missing authentication', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Update custom entity settings',
      description: 'Sets the tenant-scoped default-restricted policy for new custom entities.',
      requestBody: { schema: putBodySchema },
      responses: [
        { status: 200, description: 'Updated settings', schema: z.object({ ok: z.boolean(), newEntitiesRestrictedByDefault: z.boolean(), updatedAt: z.string().nullable().optional() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Missing authentication', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Optimistic lock conflict', schema: z.object({ code: z.string(), error: z.string() }) },
      ],
    },
  },
}
