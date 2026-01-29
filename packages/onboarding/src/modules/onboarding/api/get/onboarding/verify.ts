import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { onboardingVerifySchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { reindexEntity } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { purgeIndexScope } from '@open-mercato/core/modules/query_index/lib/purge'
import { refreshCoverageSnapshot } from '@open-mercato/core/modules/query_index/lib/coverage'
import { seedResourcesCapacityUnits, seedResourcesResourceExamples } from '@open-mercato/core/modules/resources/lib/seeds'
import { seedSalesAdjustmentKinds, seedSalesStatusDictionaries } from '@open-mercato/core/modules/sales/lib/dictionaries'
import { seedSalesTaxRates } from '@open-mercato/core/modules/sales/lib/seeds'
import { seedSalesExamples } from '@open-mercato/core/modules/sales/seed/examples'
import { ensureExamplePaymentMethods, ensureExampleShippingMethods } from '@open-mercato/core/modules/sales/seed/examples-data'
import { seedStaffTeamExamples } from '@open-mercato/core/modules/staff/lib/seeds'
import { seedExampleWorkflows } from '@open-mercato/core/modules/workflows/lib/seeds'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { VectorIndexService } from '@open-mercato/search/vector'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: {
    requireAuth: false,
  },
}

function redirectWithStatus(baseUrl: string, status: string) {
  return NextResponse.redirect(`${baseUrl}/onboarding?status=${encodeURIComponent(status)}`)
}

function redirectToLogin(baseUrl: string, tenantId: string | null) {
  const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''
  const response = NextResponse.redirect(`${baseUrl}/login${tenantParam}`)
  if (tenantId) {
    response.cookies.set('om_login_tenant', tenantId, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 14,
    })
  }
  return response
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
  const request = await service.findByToken(parsed.data.token)
  if (!request) {
    return redirectWithStatus(baseUrl, 'invalid')
  }
  if (request.expiresAt <= new Date() && request.status !== 'completed') {
    return redirectWithStatus(baseUrl, 'invalid')
  }
  if (request.status === 'completed' && request.tenantId) {
    return redirectToLogin(baseUrl, request.tenantId)
  }
  const lockWindowMs = 15 * 60 * 1000
  const processingStartedAt = request.processingStartedAt?.getTime() ?? 0
  const processingFresh = request.status === 'processing' && processingStartedAt > Date.now() - lockWindowMs
  if (processingFresh) {
    return redirectToLogin(baseUrl, request.tenantId ?? null)
  }
  if (request.status === 'processing' && !processingFresh) {
    await service.resetProcessing(request)
  }
  if (request.status !== 'pending') {
    return redirectWithStatus(baseUrl, 'invalid')
  }
  await service.startProcessing(request, new Date())
  if (!request.passwordHash) {
    console.error('[onboarding.verify] missing password hash for request', request.id)
    await service.resetProcessing(request)
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
    await service.updateProvisioningIds(request, { tenantId, organizationId, userId: resolvedUserId })

    // Call module seedDefaults + seedExamples hooks
    const modules = getModules()
    for (const mod of modules) {
      if (mod.setup?.seedDefaults) {
        await mod.setup.seedDefaults({ em, tenantId, organizationId, container })
      }
    }
    for (const mod of modules) {
      if (mod.setup?.seedExamples) {
        await mod.setup.seedExamples({ em, tenantId, organizationId, container })
      }
    }
    if (tenantId) {
      let vectorService: VectorIndexService | null = null
      try {
        vectorService = container.resolve<VectorIndexService>('vectorIndexService')
      } catch {
        vectorService = null
      }
      const coverageRefreshKeys = new Set<string>()
      try {
        const allEntities = getEntityIds()
        const entityIds = flattenSystemEntityIds(allEntities)
        for (const entityType of entityIds) {
          try {
            await purgeIndexScope(em, { entityType, tenantId })
          } catch (error) {
            console.error('[onboarding.verify] failed to purge query index scope', { entityType, tenantId, error })
          }
          try {
            await reindexEntity(em, {
              entityType,
              tenantId,
              force: true,
              emitVectorizeEvents: false,
              vectorService: null,
            })
          } catch (error) {
            console.error('[onboarding.verify] failed to reindex entity', { entityType, tenantId, error })
          }
          coverageRefreshKeys.add(`${entityType}|${tenantId}|__null__`)
          if (organizationId) coverageRefreshKeys.add(`${entityType}|${tenantId}|${organizationId}`)
        }
      } catch (error) {
        console.error('[onboarding.verify] failed to rebuild query indexes', { tenantId, error })
      }

      if (vectorService) {
        try {
          await vectorService.reindexAll({ tenantId, organizationId, purgeFirst: true })
        } catch (error) {
          console.error('[onboarding.verify] failed to rebuild vector indexes', { tenantId, organizationId, error })
        }
      }

      if (coverageRefreshKeys.size) {
        for (const entry of coverageRefreshKeys) {
          const [entityType, tenantKey, orgKey] = entry.split('|')
          const orgScope = orgKey === '__null__' ? null : orgKey
          try {
            await refreshCoverageSnapshot(
              em,
              {
                entityType,
                tenantId: tenantKey,
                organizationId: orgScope,
                withDeleted: false,
              },
            )
          } catch (error) {
            console.error('[onboarding.verify] failed to refresh coverage snapshot', {
              entityType,
              tenantId: tenantKey,
              organizationId: orgScope,
              error,
            })
          }
        }
      }
    }

    await service.markCompleted(request, { tenantId, organizationId, userId: resolvedUserId })
    return redirectToLogin(baseUrl, tenantId)
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_EXISTS') {
      await service.resetProcessing(request)
      return redirectWithStatus(baseUrl, 'already_exists')
    }
    console.error('[onboarding.verify] failed', error)
    await service.resetProcessing(request)
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
  description: 'Validates the onboarding token, provisions the tenant, seeds demo data, and redirects the user to the login screen.',
  tags: [onboardingTag],
  query: onboardingVerifyQuerySchema,
  responses: [
    { status: 302, description: 'Redirect to onboarding UI or login' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: onboardingTag,
  summary: 'Onboarding verification redirect',
  methods: {
    GET: onboardingVerifyDoc,
  },
}
