import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { inviteUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { isOwnedCompanyEntity, isOwnedPersonEntity, resolveOwnedCompanyForPerson } from '@open-mercato/core/modules/customer_accounts/lib/customerEntityOwnership'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerInviteRateLimitConfig,
  customerInviteIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'
import { readNormalizedEmailFromJsonRequest } from '@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier'
import { sendCustomerInvitationEmail } from '@open-mercato/core/modules/customer_accounts/lib/invitationEmail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerUserInvitation } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'

const logger = createLogger('customer_accounts').child({ component: 'admin-users-invite' })

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = {}

function resolveInvitedByUserId(auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>): string | null {
  if (auth.isApiKey) return auth.userId ?? null
  return auth.sub
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Pending invitations are the only trace a not-yet-accepted invite leaves: the
// customer user row is created on accept, so every users-backed surface (admin
// users list, the CRM person "account status" widget) shows the same empty
// state right after a successful invite (#4950). This read surface makes that
// pending state queryable. The one-time token stays server-side.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.view'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  // A non-numeric page/pageSize must not reach the query as NaN.
  const page = Math.max(1, parsePositiveInt(url.searchParams.get('page'), 1))
  const pageSize = Math.min(100, Math.max(1, parsePositiveInt(url.searchParams.get('pageSize'), 25)))
  const personEntityId = url.searchParams.get('personEntityId')
  const customerEntityId = url.searchParams.get('customerEntityId')
  const email = url.searchParams.get('email')

  for (const value of [personEntityId, customerEntityId]) {
    if (value && !UUID_PATTERN.test(value)) {
      return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
    }
  }

  // Pending means: still open (not accepted, not cancelled) and not expired.
  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    acceptedAt: null,
    cancelledAt: null,
    expiresAt: { $gt: new Date() },
  }
  if (personEntityId) where.personEntityId = personEntityId
  if (customerEntityId) where.customerEntityId = customerEntityId
  // email is stored encrypted, so match on the deterministic lookup hash.
  if (email) where.emailHash = { $in: lookupHashCandidates(email) }

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const [invitations, total] = await findAndCountWithDecryption(
    em,
    CustomerUserInvitation,
    where as any,
    {
      orderBy: { createdAt: 'DESC' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    },
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  const items = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    displayName: invitation.displayName || null,
    customerEntityId: invitation.customerEntityId || null,
    personEntityId: invitation.personEntityId || null,
    roleIds: Array.isArray(invitation.roleIdsJson) ? invitation.roleIdsJson : [],
    invitedByUserId: invitation.invitedByUserId || null,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  }))

  return NextResponse.json({
    ok: true,
    items,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    page,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const rateLimitEmail = await readNormalizedEmailFromJsonRequest(req)
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerInviteIpRateLimitConfig,
    compoundConfig: customerInviteRateLimitConfig,
    compoundIdentifier: rateLimitEmail,
  })
  if (rateLimitError) return rateLimitError

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.invite'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = inviteUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  // Reject a customerEntityId the caller does not own. customerEntityId is the
  // CRM company FK; without this check a non-company (e.g. a person) entity id
  // or a company from another org poisons the invitation and every later user
  // edit fails with "Company not found" (#4362, #2693).
  if (parsed.data.customerEntityId) {
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const owned = await isOwnedCompanyEntity(em, parsed.data.customerEntityId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!owned) {
      return NextResponse.json({ ok: false, error: 'Company not found' }, { status: 400 })
    }
  }

  // Same guard for the person FK: it is copied onto the customer user on accept
  // and makes `autoLinkCrm` short-circuit, so an unowned id would permanently
  // cross-link the portal user to another org's CRM person.
  let resolvedCustomerEntityId = parsed.data.customerEntityId || null
  if (parsed.data.personEntityId) {
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const owned = await isOwnedPersonEntity(em, parsed.data.personEntityId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!owned) {
      return NextResponse.json({ ok: false, error: 'Person not found' }, { status: 400 })
    }

    // An invitation raised from a person card carries only the person FK, and the
    // accepted user then short-circuits `autoLinkCrm`. Resolve the person's company
    // here so the user lands with a company scope key: the portal Users page, portal
    // invitations, and the company detail "Portal users" group all filter on it.
    if (!resolvedCustomerEntityId) {
      resolvedCustomerEntityId = await resolveOwnedCompanyForPerson(em, parsed.data.personEntityId, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
    }
  }

  const customerInvitationService = container.resolve('customerInvitationService') as CustomerInvitationService

  const { invitation, rawToken, rollbackState } = await customerInvitationService.createInvitation(
    parsed.data.email,
    { tenantId: auth.tenantId!, organizationId: auth.orgId! },
    {
      customerEntityId: resolvedCustomerEntityId,
      personEntityId: parsed.data.personEntityId || null,
      roleIds: parsed.data.roleIds,
      invitedByUserId: resolveInvitedByUserId(auth),
      displayName: parsed.data.displayName || null,
    },
  )

  try {
    await sendCustomerInvitationEmail({
      container,
      tenantId: auth.tenantId!,
      organizationId: auth.orgId!,
      email: invitation.email,
      rawToken,
    })
  } catch (error) {
    logger.error('Invitation email failed', { err: error })
    try {
      await customerInvitationService.rollbackInvitation(invitation, rollbackState)
    } catch (rollbackError) {
      logger.error('Invitation rollback failed', { err: rollbackError })
    }
    return NextResponse.json({ ok: false, error: 'Invitation email could not be sent' }, { status: 502 })
  }

  // Emit only after the email is sent, so a subscriber observing "invited" can
  // assume the recipient was actually notified (no event fires on the 502 path).
  void emitCustomerAccountsEvent('customer_accounts.user.invited', {
    invitationId: invitation.id,
    email: invitation.email,
    customerEntityId: invitation.customerEntityId || null,
    invitedByType: 'staff',
    tenantId: auth.tenantId!,
    organizationId: auth.orgId!,
  }).catch(() => undefined)

  return NextResponse.json({
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      // Echo the stored CRM links so the caller can see which company the person
      // invite resolved to. The token stays unexposed.
      customerEntityId: invitation.customerEntityId || null,
      personEntityId: invitation.personEntityId || null,
      expiresAt: invitation.expiresAt,
    },
  }, { status: 201 })
}

const successSchema = z.object({
  ok: z.literal(true),
  invitation: z.object({
    id: z.string().uuid(),
    email: z.string(),
    customerEntityId: z.string().uuid().nullable(),
    personEntityId: z.string().uuid().nullable(),
    expiresAt: z.string().datetime(),
  }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Invite customer user (admin)',
  description: 'Creates a staff-initiated invitation for a new customer user. The invitedByUserId is set from the staff auth context.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: inviteUserSchema },
  responses: [{ status: 201, description: 'Invitation created', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 429, description: 'Too many invitation requests', schema: rateLimitErrorSchema },
    { status: 502, description: 'Invitation email could not be sent', schema: errorSchema },
  ],
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  personEntityId: z.string().uuid().optional(),
  customerEntityId: z.string().uuid().optional(),
  email: z.string().optional(),
})

const listSuccessSchema = z.object({
  ok: z.literal(true),
  items: z.array(z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    customerEntityId: z.string().uuid().nullable(),
    personEntityId: z.string().uuid().nullable(),
    roleIds: z.array(z.string().uuid()),
    invitedByUserId: z.string().uuid().nullable(),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })),
  total: z.number(),
  totalPages: z.number(),
  page: z.number(),
})

const listMethodDoc: OpenApiMethodDoc = {
  summary: 'List pending customer invitations (admin)',
  description: 'Lists invitations that are still pending — not accepted, not cancelled, and not expired — for the caller\'s tenant and organization. The invitation token is never returned.',
  tags: ['Customer Accounts Admin'],
  query: listQuerySchema,
  responses: [{ status: 200, description: 'Pending invitations', schema: listSuccessSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Invite customer user (admin)',
  methods: { GET: listMethodDoc, POST: methodDoc },
}
