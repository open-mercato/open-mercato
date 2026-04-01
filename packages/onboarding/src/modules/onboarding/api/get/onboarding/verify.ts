import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { SearchIndexer } from '@open-mercato/search'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale, locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { onboardingVerifySchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import WorkspaceReadyEmail from '@open-mercato/onboarding/modules/onboarding/emails/WorkspaceReadyEmail'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { UserConsent } from '@open-mercato/core/modules/auth/data/entities'
import { computeConsentIntegrityHash } from '@open-mercato/core/modules/auth/lib/consentIntegrity'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { reindexEntity } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { purgeIndexScope } from '@open-mercato/core/modules/query_index/lib/purge'
import { refreshCoverageSnapshot } from '@open-mercato/core/modules/query_index/lib/coverage'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  path: '/onboarding/onboarding/verify',
  GET: {
    requireAuth: false,
  },
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  response.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  response.cookies.set('om_login_tenant', '', { path: '/', maxAge: 0 })
}

function redirectWithStatus(baseUrl: string, status: string) {
  const response = NextResponse.redirect(`${baseUrl}/onboarding?status=${encodeURIComponent(status)}`)
  clearAuthCookies(response)
  return response
}

function redirectToPreparing(baseUrl: string, tenantId: string | null) {
  const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''
  const response = NextResponse.redirect(`${baseUrl}/onboarding/preparing${tenantParam}`)
  clearAuthCookies(response)
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

function redirectToLogin(baseUrl: string, tenantId: string | null) {
  const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''
  const response = NextResponse.redirect(`${baseUrl}/login${tenantParam}`)
  clearAuthCookies(response)
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

const VECTOR_REINDEX_ENQUEUE_TIMEOUT_MS = 5_000
const SEED_DEFAULTS_TIMEOUT_MS = 15_000
const SEED_EXAMPLES_TIMEOUT_MS = 15_000

function createTimeoutPromise(label: string, timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
}

async function runModuleSetupHook(args: {
  moduleId: string
  phase: 'seedDefaults' | 'seedExamples'
  timeoutMs: number
  run: () => Promise<void>
}) {
  const startedAt = Date.now()
  console.info('[onboarding.verify] module hook started', {
    moduleId: args.moduleId,
    phase: args.phase,
    timeoutMs: args.timeoutMs,
  })
  try {
    await Promise.race([
      args.run(),
      createTimeoutPromise(`module ${args.moduleId} ${args.phase}`, args.timeoutMs),
    ])
    console.info('[onboarding.verify] module hook completed', {
      moduleId: args.moduleId,
      phase: args.phase,
      durationMs: Math.max(0, Date.now() - startedAt),
    })
  } catch (error) {
    console.error('[onboarding.verify] module hook failed', {
      moduleId: args.moduleId,
      phase: args.phase,
      durationMs: Math.max(0, Date.now() - startedAt),
      timeoutMs: args.timeoutMs,
      error,
    })
    throw error
  }
}

function resolveLocale(rawLocale: string | null | undefined): Locale {
  if (rawLocale && locales.includes(rawLocale as Locale)) return rawLocale as Locale
  return defaultLocale
}

async function sendWorkspaceReadyEmail(args: {
  requestId: string
  baseUrl: string
  tenantId: string
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findById(args.requestId)
  if (!request || request.readyEmailSentAt) return
  const locale = resolveLocale(request.locale)
  const dict = await loadDictionary(locale)
  const translate = createFallbackTranslator(dict)
  const loginUrl = `${args.baseUrl}/login?tenant=${encodeURIComponent(args.tenantId)}`
  const firstName = request.firstName?.trim() || request.organizationName?.trim() || request.email
  const subject = translate('onboarding.readyEmail.subject', 'Your Open Mercato workspace is ready')
  const emailCopy = {
    preview: translate('onboarding.readyEmail.preview', 'Your workspace is ready. Use your tenant-specific login link to sign in.'),
    heading: translate('onboarding.readyEmail.heading', 'Your workspace is ready'),
    greeting: translate('onboarding.readyEmail.greeting', 'Hi {firstName},', { firstName }),
    body: translate(
      'onboarding.readyEmail.body',
      'Your Open Mercato workspace for {organizationName} has finished preparing. Use the secure link below to sign in to the correct tenant.',
      { organizationName: request.organizationName },
    ),
    cta: translate('onboarding.readyEmail.cta', 'Open tenant login'),
    footer: translate('onboarding.readyEmail.footer', 'Open Mercato · Tenant onboarding service'),
  }

  await sendEmail({
    to: request.email,
    subject,
    react: WorkspaceReadyEmail({ loginUrl, copy: emailCopy }),
  })
  await service.markReadyEmailSent(request, new Date())
}

async function markWorkspaceReady(args: {
  requestId: string
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findById(args.requestId)
  if (!request || request.preparationCompletedAt) return
  await service.markPreparationCompleted(request, new Date())
}

async function enqueueVectorReindex(args: {
  container: { resolve: <T = unknown>(name: string) => T }
  tenantId: string
  organizationId: string
}) {
  let searchIndexer: SearchIndexer | null = null
  try {
    searchIndexer = args.container.resolve<SearchIndexer>('searchIndexer')
  } catch {
    searchIndexer = null
  }
  if (!searchIndexer) return

  await Promise.race([
    searchIndexer.reindexAllToVector({
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      purgeFirst: true,
      useQueue: true,
    }),
    createTimeoutPromise('vector reindex enqueue', VECTOR_REINDEX_ENQUEUE_TIMEOUT_MS),
  ])
}

async function rebuildTenantQueryIndexes(args: {
  em: EntityManager
  tenantId: string
  organizationId: string
}) {
  const coverageRefreshKeys = new Set<string>()
  try {
    const allEntities = getEntityIds()
    const entityIds = flattenSystemEntityIds(allEntities)
    for (const entityType of entityIds) {
      try {
        await purgeIndexScope(args.em, { entityType, tenantId: args.tenantId })
      } catch (error) {
        console.error('[onboarding.verify] failed to purge query index scope', {
          entityType,
          tenantId: args.tenantId,
          error,
        })
      }
      try {
        await reindexEntity(args.em, {
          entityType,
          tenantId: args.tenantId,
          force: true,
          emitVectorizeEvents: false,
          vectorService: null,
        })
      } catch (error) {
        console.error('[onboarding.verify] failed to reindex entity', {
          entityType,
          tenantId: args.tenantId,
          error,
        })
      }
      coverageRefreshKeys.add(`${entityType}|${args.tenantId}|__null__`)
      coverageRefreshKeys.add(`${entityType}|${args.tenantId}|${args.organizationId}`)
    }
  } catch (error) {
    console.error('[onboarding.verify] failed to rebuild query indexes', { tenantId: args.tenantId, error })
  }

  if (!coverageRefreshKeys.size) return

  for (const entry of coverageRefreshKeys) {
    const [entityType, tenantKey, orgKey] = entry.split('|')
    const orgScope = orgKey === '__null__' ? null : orgKey
    try {
      await refreshCoverageSnapshot(
        args.em,
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

async function runDeferredProvisioning(args: {
  requestId: string
  baseUrl: string
  tenantId: string
  organizationId: string
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const modules = getModules()

  for (const mod of modules) {
    if (!mod.setup?.seedExamples) continue
    try {
      await runModuleSetupHook({
        moduleId: mod.id,
        phase: 'seedExamples',
        timeoutMs: SEED_EXAMPLES_TIMEOUT_MS,
        run: () => mod.setup!.seedExamples!({
          em,
          tenantId: args.tenantId,
          organizationId: args.organizationId,
          container,
        }),
      })
    } catch (error) {
      console.error('[onboarding.verify] deferred seedExamples failed', {
        moduleId: mod.id,
        tenantId: args.tenantId,
        organizationId: args.organizationId,
        error,
      })
    }
  }

  await markWorkspaceReady({
    requestId: args.requestId,
  })

  await sendWorkspaceReadyEmail({
    requestId: args.requestId,
    baseUrl: args.baseUrl,
    tenantId: args.tenantId,
  }).catch((error) => {
    console.error('[onboarding.verify] ready email failed', {
      requestId: args.requestId,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      error,
    })
    throw error
  })

  await rebuildTenantQueryIndexes({
    em,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
  })

  await enqueueVectorReindex({
    container,
    tenantId: args.tenantId,
    organizationId: args.organizationId,
  }).catch((error) => {
    console.warn('[onboarding.verify] vector reindex enqueue did not complete promptly', {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      reason: error instanceof Error ? error.message : String(error),
    })
  })
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
    if (!request.preparationCompletedAt) {
      return redirectToPreparing(baseUrl, request.tenantId)
    }
    if (!request.readyEmailSentAt) {
      after(async () => {
        await sendWorkspaceReadyEmail({
          requestId: request.id,
          baseUrl,
          tenantId: request.tenantId!,
        }).catch((error) => {
          console.error('[onboarding.verify] retry ready email failed', {
            requestId: request.id,
            tenantId: request.tenantId,
            organizationId: request.organizationId,
            error,
          })
        })
      })
    }
    return redirectToLogin(baseUrl, request.tenantId)
  }
  const lockWindowMs = 15 * 60 * 1000
  const processingStartedAt = request.processingStartedAt?.getTime() ?? 0
  const processingFresh = request.status === 'processing' && processingStartedAt > Date.now() - lockWindowMs
  if (processingFresh) {
    return redirectToPreparing(baseUrl, request.tenantId ?? null)
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
      modules: getModules(),
    })

    const resolvedTenantId = String(setupResult.tenantId)
    const resolvedOrganizationId = String(setupResult.organizationId)
    tenantId = resolvedTenantId
    organizationId = resolvedOrganizationId

    const mainUserSnapshot = setupResult.users.find((entry) => entry.user.email === request.email)
    if (!mainUserSnapshot) throw new Error('USER_NOT_CREATED')
    const user = mainUserSnapshot.user
    const resolvedUserId = String(user.id)
    userId = resolvedUserId
    await service.updateProvisioningIds(request, {
      tenantId: resolvedTenantId,
      organizationId: resolvedOrganizationId,
      userId: resolvedUserId,
    })

    if (request.marketingConsent) {
      const now = new Date()
      const clientIp = getClientIp(req, 1) ?? null
      const integrityHash = computeConsentIntegrityHash({
        userId: resolvedUserId,
        consentType: 'marketing_email',
        isGranted: true,
        grantedAt: now,
        ipAddress: clientIp,
        source: 'onboarding',
      })
      em.create(UserConsent, {
        userId: resolvedUserId,
        tenantId: resolvedTenantId,
        organizationId: resolvedOrganizationId,
        consentType: 'marketing_email',
        isGranted: true,
        grantedAt: now,
        source: 'onboarding',
        ipAddress: clientIp,
        integrityHash,
        createdAt: now,
      })
      await em.flush()
    }

    // Call module seedDefaults + seedExamples hooks
    const modules = getModules()
    for (const mod of modules) {
      if (mod.setup?.seedDefaults) {
        await runModuleSetupHook({
          moduleId: mod.id,
          phase: 'seedDefaults',
          timeoutMs: SEED_DEFAULTS_TIMEOUT_MS,
          run: () => mod.setup!.seedDefaults!({
            em,
            tenantId: resolvedTenantId,
            organizationId: resolvedOrganizationId,
            container,
          }),
        })
      }
    }
    await service.markCompleted(request, {
      tenantId: resolvedTenantId,
      organizationId: resolvedOrganizationId,
      userId: resolvedUserId,
    })
    after(async () => {
      await runDeferredProvisioning({
        requestId: request.id,
        baseUrl,
        tenantId: resolvedTenantId,
        organizationId: resolvedOrganizationId,
      })
    })
    return redirectToPreparing(baseUrl, resolvedTenantId)
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
