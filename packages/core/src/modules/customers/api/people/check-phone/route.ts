import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const querySchema = z.object({
  digits: z
    .string()
    .regex(/^\d{4,}$/)
    .transform((value) => value.trim()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const rawQuery: Record<string, string | null> = { digits: url.searchParams.get('digits') }
  const parse = querySchema.safeParse(rawQuery)

  if (!parse.success) {
    return NextResponse.json({ match: null })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = (container.resolve('em') as EntityManager)

  const allowedOrgIds = new Set<string>()
  if (scope?.selectedId) allowedOrgIds.add(scope.selectedId)
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  if (!allowedOrgIds.size && auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size === 0) {
    return NextResponse.json({ match: null })
  }

  const qb = em.createQueryBuilder(CustomerEntity, 'person')
  qb.select(['person.id', 'person.displayName'])
  qb.where({ kind: 'person', deletedAt: null })
  qb.andWhere('person.primary_phone is not null')
  qb.andWhere("regexp_replace(person.primary_phone, '\\D', '', 'g') = ?", [parse.data.digits])
  if (auth.tenantId) {
    qb.andWhere({ tenantId: auth.tenantId })
  }
  qb.andWhere({ organizationId: { $in: Array.from(allowedOrgIds) } })
  qb.limit(1)

  const match = await qb.getSingleResult()
  if (!match) {
    return NextResponse.json({ match: null })
  }

  return NextResponse.json({
    match: {
      id: match.id,
      displayName: match.displayName,
    },
  })
}

const phoneCheckSuccessSchema = z.object({
  match: z
    .object({
      id: z.string().uuid(),
      displayName: z.string().nullable(),
    })
    .nullable(),
})

const phoneCheckErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Check customer phone number',
  methods: {
    GET: {
      summary: 'Find person by phone digits',
      description: 'Performs an exact digits comparison (stripping non-numeric characters) to determine whether a customer contact matches the provided phone fragment.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Matching contact (if any)', schema: phoneCheckSuccessSchema },
        { status: 401, description: 'Unauthorized', schema: phoneCheckErrorSchema },
      ],
    },
  },
}
