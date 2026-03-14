import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserRole, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata = {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'Invalid user ID' }, { status: 400 })
  }

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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const user = await em.findOne(CustomerUser, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const userRoles = await em.find(CustomerUserRole, {
    user: user.id as any,
    deletedAt: null,
  }, { populate: ['role'] })
  const roles = userRoles.map((ur) => ({
    id: (ur.role as any).id,
    name: (ur.role as any).name,
    slug: (ur.role as any).slug,
  }))

  const activeSessions = await em.find(CustomerUserSession, {
    user: user.id as any,
    deletedAt: null,
    expiresAt: { $gt: new Date() },
  }, { orderBy: { lastUsedAt: 'DESC' } })

  const sessions = activeSessions.map((session) => ({
    id: session.id,
    ipAddress: (session as any).ipAddress || null,
    userAgent: (session as any).userAgent || null,
    lastUsedAt: (session as any).lastUsedAt || null,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }))

  return NextResponse.json({
    ok: true,
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt || null,
    isActive: user.isActive,
    lockedUntil: user.lockedUntil || null,
    lastLoginAt: user.lastLoginAt || null,
    customerEntityId: user.customerEntityId || null,
    personEntityId: user.personEntityId || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || null,
    roles,
    sessions,
  })
}

const roleSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })
const userDetailSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  lockedUntil: z.string().datetime().nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  failedLoginAttempts: z.number(),
  customerEntityId: z.string().uuid().nullable(),
  personEntityId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
  roles: z.array(roleSchema),
  activeSessionCount: z.number(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Get customer user detail (admin)',
  description: 'Returns full customer user details including CRM links, roles, and active session count.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'User detail',
    schema: z.object({ ok: z.literal(true), user: userDetailSchema }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Get customer user detail (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { GET: methodDoc },
}

export default GET
