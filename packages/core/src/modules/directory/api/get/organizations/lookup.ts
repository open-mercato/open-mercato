import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/directory/organizations/lookup',
  GET: {
    requireAuth: false,
  },
}

const orgLookupQuerySchema = z.object({
  slug: z.string().min(1).max(150),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') || ''
  const parsed = orgLookupQuerySchema.safeParse({ slug })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid slug.' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const organization = await em.findOne(
    Organization,
    { slug: parsed.data.slug, deletedAt: null },
    { populate: ['tenant'] },
  )
  if (!organization) {
    return NextResponse.json({ ok: false, error: 'Organization not found.' }, { status: 404 })
  }
  const tenantId = typeof organization.tenant === 'string'
    ? organization.tenant
    : organization.tenant?.id
      ? String(organization.tenant.id)
      : null
  return NextResponse.json({
    ok: true,
    organization: {
      id: String(organization.id),
      name: organization.name,
      slug: organization.slug,
      tenantId,
    },
  })
}

const lookupTag = 'Directory'

const orgLookupSuccessSchema = z.object({
  ok: z.literal(true),
  organization: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    tenantId: z.string().uuid().nullable(),
  }),
})

const orgLookupErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const orgLookupDoc: OpenApiMethodDoc = {
  summary: 'Public organization lookup by slug',
  description: 'Resolves organization metadata for portal flows. No authentication required.',
  tags: [lookupTag],
  query: orgLookupQuerySchema,
  responses: [
    { status: 200, description: 'Organization resolved.', schema: orgLookupSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid slug', schema: orgLookupErrorSchema },
    { status: 404, description: 'Organization not found', schema: orgLookupErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: lookupTag,
  summary: 'Public organization lookup by slug',
  methods: {
    GET: orgLookupDoc,
  },
}

export default GET
