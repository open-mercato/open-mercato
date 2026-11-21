import { NextResponse } from 'next/server'
import { z } from 'zod'
import { UniqueConstraintViolationException, type FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { registerDomainSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import {
  DomainMappingService,
  DomainMappingOrgScopeError,
  DomainMappingRegistrationConflict,
  type ResolveResult,
} from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'
import { DomainMapping } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  DOMAIN_UNAVAILABLE_MESSAGE,
  MAX_VERIFIABLE_HOSTNAME_LENGTH,
  UNVERIFIED_DOMAIN_STATUSES,
  domainOwnershipRecord,
  domainVerificationDeadline,
  liveDomainMappings,
} from '../../lib/domainMappingLifecycle'

const FEATURE = 'customer_accounts.domain.manage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [FEATURE] },
  POST: { requireAuth: true, requireFeatures: [FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [FEATURE] },
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === '23505') return true
  const messageRaw = (error as { message?: string }).message
  const message = typeof messageRaw === 'string' ? messageRaw : ''
  return message.toLowerCase().includes('duplicate key')
}

function serializeRecord(record: DomainMapping) {
  const pending = UNVERIFIED_DOMAIN_STATUSES.includes(record.status)
  return {
    id: record.id,
    hostname: record.hostname,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    provider: record.provider,
    status: record.status,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    lastDnsCheckAt: record.lastDnsCheckAt?.toISOString() ?? null,
    dnsFailureReason: record.dnsFailureReason ?? null,
    tlsFailureReason: record.tlsFailureReason ?? null,
    tlsRetryCount: record.tlsRetryCount,
    cnameTarget: process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? null,
    aRecordTarget: process.env.CUSTOM_DOMAIN_A_RECORD_TARGET ?? null,
    ownershipRecord: pending && record.hostname.length <= MAX_VERIFIABLE_HOSTNAME_LENGTH ? domainOwnershipRecord(record) : null,
    verificationExpiresAt: pending ? domainVerificationDeadline(record.createdAt).toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt?.toISOString() ?? null,
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const orgFilter = url.searchParams.get('organizationId')
  if (orgFilter && !await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: orgFilter,
  })) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const em = container.resolve('em') as EntityManager
  const where: FilterQuery<DomainMapping> = { tenantId: auth.tenantId, ...liveDomainMappings() }
  if (orgFilter) {
    where.organizationId = orgFilter
  } else {
    const featureAccess = await rbac.resolveFeatureOrganizationAccess(auth.sub, [FEATURE], { tenantId: auth.tenantId })
    if (!featureAccess.unrestricted) {
      const organizations = await findWithDecryption(em, Organization, {
        tenant: auth.tenantId,
        deletedAt: null,
      }, { fields: ['id', 'ancestorIds'] }, { tenantId: auth.tenantId })
      where.organizationId = { $in: featureAccess.filterOrganizationIds(organizations) }
    }
  }
  const records = await findWithDecryption(em, DomainMapping, where, { orderBy: { createdAt: 'desc' } }, {
    tenantId: auth.tenantId,
    organizationId: orgFilter,
  })

  return NextResponse.json({
    ok: true,
    domainMappings: records.map(serializeRecord),
    config: {
      cnameTarget: process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? null,
      aRecordTarget: process.env.CUSTOM_DOMAIN_A_RECORD_TARGET ?? null,
    },
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService

  const body = await readJsonSafe(req, {})
  const parsed = registerDomainSchema.safeParse(body)
  if (!parsed.success) {
    const { translate } = await resolveTranslations()
    const issues = parsed.error.flatten((issue) => issue.message === 'customer_accounts.domainMapping.dns.txtNameTooLong'
      ? translate(issue.message)
      : issue.message)
    return NextResponse.json(
      { ok: false, error: 'Invalid request', issues },
      { status: 400 },
    )
  }
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: parsed.data.organizationId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const registrationGuardInput = {
    resourceKind: 'customer_accounts.domain_mapping',
    resourceId: parsed.data.organizationId,
    operation: 'create' as const,
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  }
  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { tenantId: auth.tenantId, organizationId: parsed.data.organizationId, userId: auth.sub },
    input: registrationGuardInput,
  })
  if (!guardResult.ok) return guardResult.response

  const guarded = registerDomainSchema.safeParse({ ...parsed.data, ...guardResult.modifiedPayload })
  if (!guarded.success || guarded.data.organizationId !== parsed.data.organizationId) {
    const { translate } = await resolveTranslations()
    return NextResponse.json({ ok: false, error: translate('customer_accounts.domainMapping.hostname.validation.invalid') }, { status: 400 })
  }

  const service = container.resolve('domainMappingService') as DomainMappingService

  let entity: DomainMapping
  try {
    entity = await service.register({ ...guarded.data, tenantId: auth.tenantId })
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { ok: false, error: DOMAIN_UNAVAILABLE_MESSAGE },
        { status: 409 },
      )
    }
    if (err instanceof DomainMappingRegistrationConflict) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 })
    }
    if (err instanceof DomainMappingOrgScopeError) {
      return NextResponse.json(
        { ok: false, error: 'Organization was not found in the current tenant.' },
        { status: 400 },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to register domain'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  registrationGuardInput.resourceId = entity.id
  await guardResult.runAfterSuccess()

  return NextResponse.json({ ok: true, domainMapping: serializeRecord(entity) }, { status: 201 })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

  const service = container.resolve('domainMappingService') as DomainMappingService
  const existing = await service.findById(id, { tenantId: auth.tenantId })
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: existing.organizationId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { tenantId: auth.tenantId, organizationId: existing.organizationId, userId: auth.sub },
    input: {
      resourceKind: 'customer_accounts.domain_mapping',
      resourceId: id,
      operation: 'delete',
    },
  })
  if (!guardResult.ok) return guardResult.response

  try {
    await service.remove(id, {
      tenantId: auth.tenantId,
      expectedUpdatedAt: readOptimisticLockExpected(req),
      container,
    })
  } catch (error: unknown) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    throw error
  }

  await guardResult.runAfterSuccess()

  return NextResponse.json({ ok: true })
}

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })
const domainMappingSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  provider: z.literal('traefik'),
  status: z.enum(['pending', 'verified', 'active', 'dns_failed', 'tls_failed']),
  verifiedAt: z.string().nullable(),
  lastDnsCheckAt: z.string().nullable(),
  dnsFailureReason: z.string().nullable(),
  tlsFailureReason: z.string().nullable(),
  tlsRetryCount: z.number().int().nonnegative(),
  cnameTarget: z.string().nullable(),
  aRecordTarget: z.string().nullable(),
  ownershipRecord: z.object({ name: z.string(), value: z.string() }).nullable().optional(),
  verificationExpiresAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Custom portal domain mappings (admin)',
  methods: {
    GET: {
      summary: 'List domain mappings',
      description: 'Returns custom-domain mappings for authorized organizations in the current tenant, optionally filtered by organization.',
      responses: [
        {
          status: 200,
          description: 'OK',
          schema: z.object({
            ok: z.literal(true),
            domainMappings: z.array(domainMappingSchema),
            config: z.object({
              cnameTarget: z.string().nullable(),
              aRecordTarget: z.string().nullable(),
            }),
          }),
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Register a custom domain',
      description: 'Registers a custom domain mapping and returns its DNS ownership record. Unverified registrations expire after 48 hours.',
      requestBody: {
        contentType: 'application/json',
        schema: z.object({
          hostname: z.string(),
          organizationId: z.string().uuid(),
          replacesDomainId: z.string().uuid().optional(),
        }),
      },
      responses: [
        {
          status: 201,
          description: 'Created',
          schema: z.object({ ok: z.literal(true), domainMapping: domainMappingSchema }),
        },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 409, description: 'Conflict', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Remove a custom domain',
      description: 'Removes the domain mapping identified by ?id=. Cache and Traefik routing drain within TTL.',
      responses: [{ status: 200, description: 'OK', schema: z.object({ ok: z.literal(true) }) }],
      errors: [
        { status: 409, description: 'The mapping changed after it was loaded', schema: z.object({ error: z.string(), code: z.literal('optimistic_lock_conflict'), currentUpdatedAt: z.string(), expectedUpdatedAt: z.string() }) },
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}

// Re-export resolve type so tests can import without indirect lookup
export type { ResolveResult }
