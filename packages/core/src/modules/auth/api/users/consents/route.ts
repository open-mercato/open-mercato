import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { User, UserConsent } from '@open-mercato/core/modules/auth/data/entities'
import { verifyConsentIntegrityHash } from '@open-mercato/core/modules/auth/lib/consentIntegrity'
import { assertActorCanAccessUserTarget } from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ConsentItem } from '@open-mercato/core/modules/auth/lib/consentTypes'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/auth/users/consents',
  GET: {
    requireAuth: true,
    requireFeatures: ['auth.users.edit'],
  },
}

const querySchema = z.object({
  userId: z.string().uuid(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid userId' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const rbacService = container.resolve('rbacService') as RbacService
  const tenantId = auth.tenantId ?? null
  const organizationId = auth.orgId ?? null

  const actorAcl = auth.sub ? await rbacService.loadAcl(auth.sub, { tenantId, organizationId }) : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  if (!actorIsSuperAdmin && !tenantId) {
    return NextResponse.json({ ok: false, error: 'Tenant context is required' }, { status: 403 })
  }

  if (auth.sub) {
    try {
      await assertActorCanAccessUserTarget({
        em,
        rbacService,
        actorUserId: auth.sub,
        tenantId,
        organizationId,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  // An "all tenants" super-admin scope narrows to the target user's own tenant;
  // dropping the tenant filter here would span every tenant.
  let scopeTenantId = tenantId
  if (!scopeTenantId) {
    const target = await findOneWithDecryption(
      em,
      User,
      { id: parsed.data.userId } as FilterQuery<User>,
      {},
      { tenantId: null, organizationId: null },
    )
    if (!target) return NextResponse.json({ ok: true, items: [] })
    scopeTenantId = target.tenantId ?? null
  }

  const consents = await findWithDecryption(
    em,
    UserConsent,
    {
      userId: parsed.data.userId,
      deletedAt: null,
      tenantId: scopeTenantId,
      ...(organizationId ? { organizationId } : {}),
    },
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: scopeTenantId, organizationId },
  )

  const items: ConsentItem[] = consents.map((c) => ({
    id: c.id,
    consentType: c.consentType,
    isGranted: c.isGranted,
    grantedAt: c.grantedAt?.toISOString() ?? null,
    withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
    source: c.source ?? null,
    ipAddress: c.ipAddress ?? null,
    integrityValid: verifyConsentIntegrityHash({
      userId: c.userId,
      consentType: c.consentType,
      isGranted: c.isGranted,
      grantedAt: c.grantedAt,
      withdrawnAt: c.withdrawnAt,
      ipAddress: c.ipAddress,
      source: c.source,
    }, c.integrityHash),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
  }))

  return NextResponse.json({ ok: true, items })
}

export default GET

const consentsGetDoc: OpenApiMethodDoc = {
  summary: 'List user consents',
  description: 'Returns all consent records for a given user, with integrity verification status.',
  tags: ['Auth'],
  query: querySchema,
  responses: [
    { status: 200, description: 'Consent list returned' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Auth',
  summary: 'User consents',
  methods: {
    GET: consentsGetDoc,
  },
}
