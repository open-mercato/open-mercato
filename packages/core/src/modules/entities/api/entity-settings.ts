import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

// Tenant-scoped policy: when true, new custom entities are created with
// `access_restricted = true` unless the create request explicitly sets the flag.
const CONFIG_MODULE = 'entities'
const NEW_ENTITIES_RESTRICTED_KEY = 'newEntitiesRestrictedByDefault'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
  PUT: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

type ModuleConfigServiceLike = {
  getValue: (
    moduleId: string,
    name: string,
    options?: { defaultValue?: unknown; scope?: { tenantId?: string | null } },
  ) => Promise<unknown>
  setValue: (
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ) => Promise<unknown>
}

async function readPolicy(tenantId: string | null): Promise<boolean> {
  try {
    const { resolve } = await createRequestContainer()
    const moduleConfigService = resolve('moduleConfigService') as ModuleConfigServiceLike
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
  const newEntitiesRestrictedByDefault = await readPolicy(auth.tenantId ?? null)
  return NextResponse.json({ newEntitiesRestrictedByDefault })
}

const putBodySchema = z.object({
  newEntitiesRestrictedByDefault: z.boolean(),
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
  const { resolve } = await createRequestContainer()
  const moduleConfigService = resolve('moduleConfigService') as ModuleConfigServiceLike
  await moduleConfigService.setValue(
    CONFIG_MODULE,
    NEW_ENTITIES_RESTRICTED_KEY,
    parsed.data.newEntitiesRestrictedByDefault,
    { tenantId: auth.tenantId ?? null },
  )
  return NextResponse.json({ ok: true, newEntitiesRestrictedByDefault: parsed.data.newEntitiesRestrictedByDefault })
}

const settingsResponseSchema = z.object({
  newEntitiesRestrictedByDefault: z.boolean(),
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
        { status: 200, description: 'Updated settings', schema: z.object({ ok: z.boolean(), newEntitiesRestrictedByDefault: z.boolean() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Missing authentication', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
