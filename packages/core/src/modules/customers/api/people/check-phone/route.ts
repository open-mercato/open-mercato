import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CustomerEntity } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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

  // `primary_phone` is encrypted at rest (customers/encryption.ts), so digit
  // normalization must run in application code over decrypted rows: a SQL
  // comparison against the stored column silently never matches once tenant
  // data encryption is on (issue #3840).
  const where: FilterQuery<CustomerEntity> = {
    kind: 'person',
    deletedAt: null,
    primaryPhone: { $ne: null },
    organizationId: { $in: Array.from(allowedOrgIds) },
  }
  if (auth.tenantId) {
    where.tenantId = auth.tenantId
  }

  const candidates = await findWithDecryption(
    em,
    CustomerEntity,
    where,
    undefined,
    {
      tenantId: auth.tenantId ?? null,
      organizationId: scope?.selectedId ?? auth.orgId ?? null,
    },
  )

  const match = candidates.find(
    (candidate) => normalizePhoneDigits(candidate.primaryPhone) === parse.data.digits,
  )
  if (!match) {
    return NextResponse.json({ match: null })
  }

  return NextResponse.json({
    match: {
      id: match.id,
      displayName: match.displayName ?? null,
    },
  })
}

function normalizePhoneDigits(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : ''
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
