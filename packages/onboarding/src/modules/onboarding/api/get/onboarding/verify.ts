import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { onboardingVerifySchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import type { OnboardingRequest } from '@open-mercato/onboarding/modules/onboarding/data/entities'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import {
  redirectToLogin,
  redirectToPreparing,
  redirectWithStatus,
} from '@open-mercato/onboarding/modules/onboarding/lib/verify-redirects'
import { resolveVerifyRedirectBaseUrl } from '@open-mercato/onboarding/modules/onboarding/lib/verify-base-url'
import {
  resolveProvisioningIds,
  runDeferredProvisioning,
} from '@open-mercato/onboarding/modules/onboarding/lib/deferred-provisioning'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { UserConsent } from '@open-mercato/core/modules/auth/data/entities'
import { computeConsentIntegrityHash } from '@open-mercato/core/modules/auth/lib/consentIntegrity'
import { resolveConsentClientIp } from '@open-mercato/onboarding/modules/onboarding/lib/consentClientIp'
import { runBestEffortProvisioningStep } from '@open-mercato/onboarding/modules/onboarding/lib/provisioning'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('onboarding').child({ component: 'verify' })

export const metadata = {
  path: '/onboarding/onboarding/verify',
  GET: {
    requireAuth: false,
  },
}

const SEED_DEFAULTS_TIMEOUT_MS = 15_000

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
  logger.info('Module hook started', {
    moduleId: args.moduleId,
    phase: args.phase,
    timeoutMs: args.timeoutMs,
  })
  try {
    await Promise.race([
      args.run(),
      createTimeoutPromise(`module ${args.moduleId} ${args.phase}`, args.timeoutMs),
    ])
    logger.info('Module hook completed', {
      moduleId: args.moduleId,
      phase: args.phase,
      durationMs: Math.max(0, Date.now() - startedAt),
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent verify (or a re-verify after the request was already
      // provisioned) re-runs seedDefaults against rows that exist. seed hooks
      // are not fully idempotent, so the collision is expected and harmless —
      // the workspace already exists. Log at info so real failures stand out.
      logger.info('Module hook skipped (already seeded)', {
        moduleId: args.moduleId,
        phase: args.phase,
        durationMs: Math.max(0, Date.now() - startedAt),
      })
    } else {
      logger.error('Module hook failed', {
        moduleId: args.moduleId,
        phase: args.phase,
        durationMs: Math.max(0, Date.now() - startedAt),
        timeoutMs: args.timeoutMs,
        err: error,
      })
    }
    throw error
  }
}

async function completeProvisionedRequest(args: {
  service: OnboardingService
  request: OnboardingRequest
}) {
  const ids = resolveProvisioningIds(args.request)
  if (!ids) return null
  await args.service.markCompleted(args.request, ids)
  after(async () => {
    await runDeferredProvisioning({
      requestId: args.request.id,
      tenantId: ids.tenantId,
      organizationId: ids.organizationId,
    })
  })
  return ids
}

export async function GET(req: Request) {
  if (parseBooleanToken(process.env.SELF_SERVICE_ONBOARDING_ENABLED ?? '') !== true) {
    return NextResponse.json({ ok: false, error: 'Self-service onboarding is disabled.' }, { status: 404 })
  }
  const url = new URL(req.url)
  const baseUrlResult = resolveVerifyRedirectBaseUrl(req)
  if (!baseUrlResult.ok) {
    if (baseUrlResult.redirectOrigin) {
      return redirectWithStatus(baseUrlResult.redirectOrigin, baseUrlResult.status)
    }
    return NextResponse.json(
      { ok: false, error: baseUrlResult.message },
      { status: baseUrlResult.httpStatus },
    )
  }
  const baseUrl = baseUrlResult.baseUrl
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
          tenantId: request.tenantId!,
        }).catch((error) => {
          logger.error('Retry ready email failed', {
            requestId: request.id,
            tenantId: request.tenantId,
            organizationId: request.organizationId,
            err: error,
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
    const recovered = await completeProvisionedRequest({ service, request })
    if (recovered) return redirectToPreparing(baseUrl, recovered.tenantId)
    return redirectToPreparing(baseUrl, request.tenantId ?? null)
  }
  if (request.status === 'processing' && !processingFresh) {
    const recovered = await completeProvisionedRequest({ service, request })
    if (recovered) return redirectToPreparing(baseUrl, recovered.tenantId)
    await service.resetProcessing(request)
  }
  if (request.status !== 'pending') {
    return redirectWithStatus(baseUrl, 'invalid')
  }
  const claimed = await service.startProcessing(request, new Date())
  if (!claimed) {
    // A concurrent verify request already claimed this token (pending → processing).
    // Re-read on a fresh fork — the request EM's identity map still holds the stale
    // pre-claim copy — and route off the winner's committed state instead of re-running
    // provisioning, which would throw USER_EXISTS and could strand the request (#2742).
    const currentService = new OnboardingService(em.fork())
    const current = await currentService.findById(request.id)
    if (current?.status === 'completed' && current.tenantId) {
      return current.preparationCompletedAt
        ? redirectToLogin(baseUrl, current.tenantId)
        : redirectToPreparing(baseUrl, current.tenantId)
    }
    if (current?.status === 'processing') {
      const recovered = await completeProvisionedRequest({ service: currentService, request: current })
      if (recovered) return redirectToPreparing(baseUrl, recovered.tenantId)
    }
    return redirectToPreparing(baseUrl, current?.tenantId ?? request.tenantId ?? null)
  }
  if (!request.passwordHash) {
    logger.error('Missing password hash for request', { requestId: request.id })
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
      const clientIp = resolveConsentClientIp(req)
      const integrityHash = computeConsentIntegrityHash({
        userId: resolvedUserId,
        consentType: 'marketing_email',
        isGranted: true,
        grantedAt: now,
        ipAddress: clientIp,
        source: 'onboarding',
      })
      // Persist the marketing consent on an isolated EM fork wrapped in a
      // transaction so it commits all-or-nothing AND a failure here can neither
      // abort provisioning nor poison the request EM's unit of work before
      // markCompleted runs. Recording the consent is best-effort: the workspace
      // is already provisioned, and a lost consent record fails safe (treated as
      // not granted) and is logged for follow-up rather than stranding the user.
      await runBestEffortProvisioningStep('marketing-consent', () =>
        em.fork().transactional(async (txEm) => {
          txEm.create(UserConsent, {
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
        }),
      )
    }

    // Call module seedDefaults hooks. Each hook is best-effort and runs on its
    // own isolated EM fork: a single module's throw or 15s timeout must not
    // strand the freshly provisioned workspace — the tenant/org/user already
    // exist and the request must still reach markCompleted so the user can sign
    // in. A per-module fork also keeps a failed module's unflushed unit of work
    // from leaking into (or aborting) the next module's flush. Failures are
    // logged for follow-up (deferred seedExamples is already non-fatal in the
    // same way).
    const modules = getModules()
    for (const mod of modules) {
      if (!mod.setup?.seedDefaults) continue
      const seedEm = em.fork()
      await runBestEffortProvisioningStep(`seedDefaults:${mod.id}`, () =>
        runModuleSetupHook({
          moduleId: mod.id,
          phase: 'seedDefaults',
          timeoutMs: SEED_DEFAULTS_TIMEOUT_MS,
          run: () => mod.setup!.seedDefaults!({
            em: seedEm,
            tenantId: resolvedTenantId,
            organizationId: resolvedOrganizationId,
            container,
          }),
        }),
      )
    }
    await service.markCompleted(request, {
      tenantId: resolvedTenantId,
      organizationId: resolvedOrganizationId,
      userId: resolvedUserId,
    })
    // TODO: Move deferred provisioning into a durable job keyed by request id so process restarts can resume
    // seedExamples/index rebuild/email dispatch instead of leaving completed requests stuck on preparing.
    after(async () => {
      await runDeferredProvisioning({
        requestId: request.id,
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
    logger.error('Verification failed', { err: error })
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
