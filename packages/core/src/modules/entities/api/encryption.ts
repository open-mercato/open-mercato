import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { upsertEncryptionMapSchema } from '@open-mercato/core/modules/entities/data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { tenantId, organizationId } = resolveScope(auth)

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
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
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const parsed = upsertEncryptionMapSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const scope = resolveScope(auth)
  const payload = parsed.data
  const tenantId = scope.tenantId
  const organizationId = scope.organizationId

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const repo = em.getRepository(EncryptionMap)
  const existing = await repo.findOne({ entityId: payload.entityId, tenantId, organizationId, deletedAt: null })
  if (existing) {
    existing.fieldsJson = payload.fields
    existing.isActive = payload.isActive ?? true
    existing.updatedAt = new Date()
    await em.persistAndFlush(existing)
  } else {
    const map = repo.create({
      entityId: payload.entityId,
      tenantId,
      organizationId,
      fieldsJson: payload.fields,
      isActive: payload.isActive ?? true,
    })
    await em.persistAndFlush(map)
  }

  try {
    const svc = resolve('tenantEncryptionService') as { invalidateMap?: (e: string, t: string | null, o: string | null) => Promise<void> }
    await svc?.invalidateMap?.(payload.entityId, tenantId, organizationId)
  } catch {
    // best-effort cache bust
  }

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Manage encryption maps',
  methods: {
    GET: {
      summary: 'Fetch encryption map',
      description: 'Returns the encrypted field map for the current tenant/organization scope.',
      query: z.object({ entityId: z.string() }),
      responses: [{ status: 200, description: 'Map', schema: z.object({ entityId: z.string(), fields: z.array(z.object({ field: z.string(), hashField: z.string().nullable().optional() })), isActive: z.boolean().optional() }) }],
    },
    POST: {
      summary: 'Upsert encryption map',
      description: 'Creates or updates the encryption map for the current tenant/organization scope.',
      requestBody: { contentType: 'application/json', schema: upsertEncryptionMapSchema },
      responses: [{ status: 200, description: 'Saved', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
