import { after } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { SearchIndexer } from '@open-mercato/search'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  AppOriginConfigurationError,
  AppOriginRejectedError,
  getSecurityEmailBaseUrl,
} from '@open-mercato/shared/lib/url'
import { onboardingVerifySchema } from '@open-mercato/onboarding/modules/onboarding/data/validators'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { sendWorkspaceReadyEmail } from '@open-mercato/onboarding/modules/onboarding/lib/ready-email'
import {
  redirectToLogin,
  redirectToPreparing,
  redirectWithStatus,
} from '@open-mercato/onboarding/modules/onboarding/lib/verify-redirects'
import { setupInitialTenant } from '@open-mercato/core/modules/auth/lib/setup-app'
import { UserConsent } from '@open-mercato/core/modules/auth/data/entities'
import { computeConsentIntegrityHash } from '@open-mercato/core/modules/auth/lib/consentIntegrity'
import { resolveConsentClientIp } from '@open-mercato/onboarding/modules/onboarding/lib/consentClientIp'
import { runBestEffortProvisioningStep } from '@open-mercato/onboarding/modules/onboarding/lib/provisioning'
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

function resolveTrustedBaseUrl(req: Request): string {
  try {
    return getSecurityEmailBaseUrl(req)
  } catch (error) {
    if (error instanceof AppOriginRejectedError || error instanceof AppOriginConfigurationError) {
      console.error('[onboarding.verify] rejected request origin for redirect base', {
        requestUrl: req.url,
        reason: error.message,
      })
      return new URL(req.url).origin
    }
    throw error
  }
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
  const baseUrl = resolveTrustedBaseUrl(req)
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
  const claimed = await service.startProcessing(request, new Date())
  if (!claimed) {
    // A concurrent verify request already claimed this token (pending → processing).
    // Re-read on a fresh fork — the request EM's identity map still holds the stale
    // pre-claim copy — and route off the winner's committed state instead of re-running
    // provisioning, which would throw USER_EXISTS and could strand the request (#2742).
    const current = await new OnboardingService(em.fork()).findById(request.id)
    if (current?.status === 'completed' && current.tenantId) {
      return current.preparationCompletedAt
        ? redirectToLogin(baseUrl, current.tenantId)
        : redirectToPreparing(baseUrl, current.tenantId)
    }
    return redirectToPreparing(baseUrl, current?.tenantId ?? request.tenantId ?? null)
  }
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

    // Call module seedDefaults hooks. Each hook is best-effort and runs on an
    // isolated EM fork: a single module's throw or 15s timeout must not strand
    // the freshly provisioned workspace — the tenant/org/user already exist and
    // the request must still reach markCompleted so the user can sign in.
    // Failures are logged for follow-up (deferred seedExamples is already
    // non-fatal in the same way).
    const modules = getModules()
    const seedEm = em.fork()
    for (const mod of modules) {
      if (!mod.setup?.seedDefaults) continue
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
