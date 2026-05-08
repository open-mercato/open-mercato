import { NextResponse } from 'next/server'
import { z } from 'zod'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { registerDomainSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import {
  DomainMappingService,
  type ResolveResult,
} from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'
import { DomainMapping } from '@open-mercato/core/modules/customer_accounts/data/entities'

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
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt?.toISOString() ?? null,
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const orgFilter = url.searchParams.get('organizationId')

  const em = container.resolve('em') as EntityManager
  const where: Record<string, unknown> = { tenantId: auth.tenantId }
  if (orgFilter) where.organizationId = orgFilter
  const records = await em.find(DomainMapping, where as never, { orderBy: { createdAt: 'desc' } })

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
  const allowed = await rbac.userHasAllFeatures(auth.sub, [FEATURE], {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const body = await readJsonSafe(req, {})
  const parsed = registerDomainSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request', issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: parsed.data.organizationId,
    userId: auth.sub,
    resourceKind: 'customer_accounts.domain_mapping',
    resourceId: parsed.data.organizationId,
    operation: 'create',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as unknown as Record<string, unknown>,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const service = container.resolve('domainMappingService') as DomainMappingService

  let entity: DomainMapping
  try {
    // service.register normalizes hostname internally — guards may have
    // returned modifiedPayload but the typed runner doesn't expose it,
    // so we rely on the service for the canonical form.
    entity = await service.register({
      hostname: parsed.data.hostname,
      organizationId: parsed.data.organizationId,
      tenantId: auth.tenantId,
      replacesDomainId: parsed.data.replacesDomainId,
    })
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { ok: false, error: 'This domain is already in use by another organization' },
        { status: 409 },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to register domain'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: parsed.data.organizationId,
      userId: auth.sub,
      resourceKind: 'customer_accounts.domain_mapping',
      resourceId: entity.id,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({ ok: true, domainMapping: serializeRecord(entity) }, { status: 201 })
}

export async function DELETE(req: Request) {
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
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

  const service = container.resolve('domainMappingService') as DomainMappingService
  const existing = await service.findById(id, { tenantId: auth.tenantId })
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: existing.organizationId,
    userId: auth.sub,
    resourceKind: 'customer_accounts.domain_mapping',
    resourceId: id,
    operation: 'delete',
    requestMethod: req.method,
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  await service.remove(id, { tenantId: auth.tenantId })

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: existing.organizationId,
      userId: auth.sub,
      resourceKind: 'customer_accounts.domain_mapping',
      resourceId: id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

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
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerAccounts',
  summary: 'Custom portal domain mappings (admin)',
  methods: {
    GET: {
      summary: 'List domain mappings',
      description: 'Returns all custom-domain mappings for the current tenant, optionally filtered by organization.',
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
      description: 'Registers a new custom domain mapping for an organization. Verifies via DNS asynchronously.',
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
        { status: 400, description: 'Bad request', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}

// Re-export resolve type so tests can import without indirect lookup
export type { ResolveResult }
