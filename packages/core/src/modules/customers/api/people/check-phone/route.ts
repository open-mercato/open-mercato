import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CustomerEntity } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { MATCH_CANDIDATE_LIMIT } from '../../../lib/findPeopleByAddresses'

const querySchema = z.object({
  digits: z
    .string()
    .regex(/^\d{4,}$/)
    .transform((value) => value.trim()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

function normalizePhoneDigits(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : ''
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

  // SQL fast path, gated on the encryption toggle: it can only match stored
  // plaintext digits, so running it while tenant data encryption is enabled
  // (the default) would pay a per-row scan that provably returns nothing.
  // When encryption is off it serves the pre-encryption single-query behavior,
  // including legacy plaintext rows. Encrypted rows written before the toggle
  // was turned off are not resolvable by either path by design; plaintext
  // legacy rows under an enabled toggle still resolve through the decrypted
  // scan below, where decryption no-ops on non-ciphertext values.
  if (!isTenantDataEncryptionEnabled()) {
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

    const fastMatch = await qb.getSingleResult()
    if (fastMatch) {
      return NextResponse.json({
        match: {
          id: fastMatch.id,
          displayName: fastMatch.displayName,
        },
      })
    }
  }

  // Encryption-on path: primary_phone holds random-IV ciphertext, so digit
  // normalization must run in application code over decrypted rows instead of
  // SQL against the stored column (issue #3840).
  // Encryption-on path: primary_phone holds random-IV ciphertext, so digit
  // normalization must run in application code over decrypted rows instead of
  // SQL against the stored column (issue #3840). The scan is bounded newest-
  // first and projected to the columns the route uses plus tenantId/
  // organizationId, which the decryption path reads per row to resolve each
  // row's own key (a request-level fallback cannot cover multi-org scans or
  // null-tenant sessions). A primary_phone blind index is the exact O(1)
  // follow-up (#5515).
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
    {
      limit: MATCH_CANDIDATE_LIMIT,
      orderBy: { createdAt: 'DESC' },
      fields: ['id', 'displayName', 'primaryPhone', 'tenantId', 'organizationId'],
    },
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
