import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity } from '../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { MATCH_CANDIDATE_LIMIT } from '../../../lib/findPeopleByAddresses'
import {
  hasPersonPhoneLookupPepper,
  normalizePhoneLookupDigits,
  personPhoneHashCandidates,
} from '../../../lib/personPhoneLookup'

const INDEXED_MATCH_PAGE_SIZE = 50

const querySchema = z.object({
  digits: z
    .string()
    .regex(/^\d{4,}$/)
    .transform((value) => value.trim()),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

function respondWithMatch(person?: Pick<CustomerEntity, 'id' | 'displayName'>) {
  return NextResponse.json({
    match: person ? {
      id: person.id,
      displayName: isEncryptedPayloadShape(person.displayName) ? null : person.displayName ?? null,
    } : null,
  })
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

  const organizationIds = Array.from(allowedOrgIds)
  const where = {
    kind: 'person' as const,
    deletedAt: null,
    primaryPhone: { $ne: null },
    organizationId: { $in: organizationIds },
    ...(auth.tenantId ? { tenantId: auth.tenantId } : {}),
  }
  const fields = ['id', 'displayName', 'primaryPhone', 'tenantId', 'organizationId'] as const
  const decryptScope = {
    tenantId: auth.tenantId ?? null,
    organizationId: resolveSingleOrganizationIdOrDeny(scope, auth) ?? null,
  }
  const digits = parse.data.digits
  const hashes = organizationIds.flatMap((organizationId) => personPhoneHashCandidates(digits, organizationId))
  const matchesDigits = (candidate: Pick<CustomerEntity, 'primaryPhone'>) =>
    normalizePhoneLookupDigits(candidate.primaryPhone) === digits

  async function findIndexedMatch() {
    if (hashes.length === 0) return undefined
    let lastId: string | undefined
    for (;;) {
      const indexed = await findWithDecryption(
        em,
        CustomerEntity,
        { ...where, primaryPhoneDigitsHash: { $in: hashes }, ...(lastId ? { id: { $gt: lastId } } : {}) },
        { fields, orderBy: { id: 'ASC' }, limit: INDEXED_MATCH_PAGE_SIZE },
        decryptScope,
      )
      const match = indexed.find(matchesDigits)
      if (match || indexed.length < INDEXED_MATCH_PAGE_SIZE) return match
      lastId = indexed[indexed.length - 1].id
    }
  }

  const indexedMatch = await findIndexedMatch()
  if (indexedMatch) return respondWithMatch(indexedMatch)

  const fallbackWhere = hasPersonPhoneLookupPepper() ? { ...where, primaryPhoneDigitsHash: null } : where
  if (!isTenantDataEncryptionEnabled()) {
    const person = await em.createQueryBuilder(CustomerEntity, 'person')
      .select(['person.id', 'person.displayName', 'person.primaryPhone'])
      .where(fallbackWhere)
      .andWhere("person.primary_phone not like '%:%:%:v1'")
      .andWhere("regexp_replace(person.primary_phone, '\\D', '', 'g') = ?", [digits])
      .limit(1)
      .getSingleResult()
    return respondWithMatch(person && matchesDigits(person) ? person : await findIndexedMatch())
  }

  const legacy = await findWithDecryption(
    em, CustomerEntity, fallbackWhere, { limit: MATCH_CANDIDATE_LIMIT, orderBy: { createdAt: 'DESC' }, fields }, decryptScope,
  )
  return respondWithMatch(legacy.find(matchesDigits) ?? await findIndexedMatch())
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
