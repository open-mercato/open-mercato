import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: {
    requireAuth: false,
  },
}

const tenantLookupQuerySchema = z.object({
  tenantId: z.string().uuid(),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant') || ''
  const parsed = tenantLookupQuerySchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid tenant id.' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager)
  const tenant = await em.findOne(Tenant, { id: parsed.data.tenantId, deletedAt: null })
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'Tenant not found.' }, { status: 404 })
  }
  return NextResponse.json({
    ok: true,
    tenant: { id: String(tenant.id), name: tenant.name },
  })
}

const lookupTag = 'Directory'

const tenantLookupSuccessSchema = z.object({
  ok: z.literal(true),
  tenant: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
})

const tenantLookupErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const tenantLookupDoc: OpenApiMethodDoc = {
  summary: 'Public tenant lookup',
  description: 'Resolves tenant metadata for login/activation flows.',
  tags: [lookupTag],
  query: tenantLookupQuerySchema,
  responses: [
    { status: 200, description: 'Tenant resolved.', schema: tenantLookupSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid tenant id', schema: tenantLookupErrorSchema },
    { status: 404, description: 'Tenant not found', schema: tenantLookupErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: lookupTag,
  summary: 'Public tenant lookup',
  methods: {
    GET: tenantLookupDoc,
  },
}
