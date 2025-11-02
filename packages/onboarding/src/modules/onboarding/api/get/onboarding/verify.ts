import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { onboardingVerifySchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { seedCustomerDictionaries, seedCustomerExamples } from '@open-mercato/core/modules/customers/cli'
import { seedExampleTodos } from '@open-mercato/example/modules/example/cli'
import { seedDashboardDefaultsForTenant } from '@open-mercato/core/modules/dashboards/cli'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@/lib/auth/jwt'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: {
    requireAuth: false,
  },
}

function redirectWithStatus(baseUrl: string, status: string) {
  return NextResponse.redirect(`${baseUrl}/onboarding?status=${encodeURIComponent(status)}`)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const baseUrl = process.env.APP_URL || `${url.protocol}//${url.host}`
  const token = url.searchParams.get('token') ?? ''
  const parsed = onboardingVerifySchema.safeParse({ token })
  if (!parsed.success) {
    return redirectWithStatus(baseUrl, 'invalid')
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager)
  const service = new OnboardingService(em)
  const request = await service.findPendingByToken(parsed.data.token)
  if (!request) {
    return redirectWithStatus(baseUrl, 'invalid')
  }
  if (!request.passwordHash) {
    console.error('[onboarding.verify] missing password hash for request', request.id)
    return redirectWithStatus(baseUrl, 'error')
  }

  let tenantId: string | null = null
  let organizationId: string | null = null
  let userId: string | null = null

  try {
    const setupResult = await setupInitialTenant(em, {
      orgName: request.organizationName,
      includeDerivedUsers: false,
      failIfUserExists: true,
      primaryUserRoles: ['admin'],
      includeSuperadminRole: false,
      primaryUser: {
        email: request.email,
        firstName: request.firstName,
        lastName: request.lastName,
        displayName: `${request.firstName} ${request.lastName}`.trim(),
        hashedPassword: request.passwordHash,
        confirm: true,
      },
    })

    tenantId = String(setupResult.tenantId)
    organizationId = String(setupResult.organizationId)

    const mainUserSnapshot = setupResult.users.find((entry) => entry.user.email === request.email)
    if (!mainUserSnapshot) throw new Error('USER_NOT_CREATED')
    const user = mainUserSnapshot.user
    const resolvedUserId = String(user.id)
    userId = resolvedUserId

    await seedCustomerDictionaries(em, { tenantId, organizationId })
    await seedCustomerExamples(em, container, { tenantId, organizationId })
    await seedExampleTodos(em, container, { tenantId, organizationId })
    await seedDashboardDefaultsForTenant(em, { tenantId, organizationId, logger: () => {} })

    const authService = (container.resolve('authService') as AuthService)
    await authService.updateLastLoginAt(user)
    const roles = await authService.getUserRoles(user, tenantId)
    const jwt = signJwt({
      sub: String(user.id),
      tenantId,
      orgId: organizationId,
      email: user.email,
      roles,
    })
    const response = NextResponse.redirect(`${baseUrl}/backend`)
    response.cookies.set('auth_token', jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    })

    const rememberDays = Number(process.env.REMEMBER_ME_DAYS || '30')
    const expiresAt = new Date(Date.now() + rememberDays * 24 * 60 * 60 * 1000)
    const session = await authService.createSession(user, expiresAt)
    response.cookies.set('session_token', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: expiresAt,
    })

    await service.markCompleted(request, { tenantId, organizationId, userId: resolvedUserId })
    return response
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_EXISTS') {
      return redirectWithStatus(baseUrl, 'already_exists')
    }
    console.error('[onboarding.verify] failed', error)
    return redirectWithStatus(baseUrl, 'error')
  }
}

export default GET

const onboardingTag = 'Onboarding'

const onboardingVerifyQuerySchema = z.object({
  token: onboardingVerifySchema.shape.token,
})

const onboardingVerifyDoc: OpenApiMethodDoc = {
  summary: 'Verify onboarding token',
  description: 'Validates the onboarding token, provisions the tenant, seeds demo data, and redirects the user to the dashboard.',
  tags: [onboardingTag],
  query: onboardingVerifyQuerySchema,
  responses: [
    { status: 302, description: 'Redirect to onboarding UI or dashboard' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: onboardingTag,
  summary: 'Onboarding verification redirect',
  methods: {
    GET: onboardingVerifyDoc,
  },
}
