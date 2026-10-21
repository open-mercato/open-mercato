import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { dealStatusVocabularySchema, saveDealStatusVocabularySchema } from '../../../data/dealStatusVocabulary'
import { resolveDealStatusVocabulary } from '../../../lib/dealStatusVocabulary'
import { DEAL_STATUS_VOCABULARY_RESOURCE_KIND } from '../../../commands/dealStatusVocabulary'

const logger = createLogger('customers').child({ component: 'deal-status-vocabulary' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

async function resolveContext(req: Request, feature: string) {
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const rbac = container.resolve('rbacService') as RbacService
  const permissionScope = { tenantId, organizationId: auth.orgId ?? null }
  if (!await rbac.userHasAllFeatures(auth.sub, [feature], permissionScope)) {
    throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
  }
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: req,
  }
  return { ctx, auth, tenantId, rbac, permissionScope }
}

function reportRouteError(error: unknown, code: string): void {
  logger.error(code, { err: error })
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'customers', code })
  } catch {}
}

async function handleError(error: unknown, operation: 'load' | 'save') {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const { translate } = await resolveTranslations()
  if (error instanceof z.ZodError) {
    return NextResponse.json({
      error: translate('customers.settings.dealStatusVocabulary.validationError', 'Enter 1–20 distinct values per group. Values cannot overlap or change the meaning of built-in statuses.'),
    }, { status: 400 })
  }
  reportRouteError(error, `customers.deal_status_vocabulary_${operation}_failed`)
  return NextResponse.json({
    error: translate(
      `customers.settings.dealStatusVocabulary.${operation === 'load' ? 'errorLoad' : 'errorSave'}`,
      operation === 'load' ? 'Failed to load deal status vocabulary.' : 'Failed to save deal status vocabulary.',
    ),
  }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId } = await resolveContext(req, 'customers.deals.view')
    return NextResponse.json(await resolveDealStatusVocabulary(ctx.container, tenantId))
  } catch (error) {
    return handleError(error, 'load')
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, auth, tenantId, rbac, permissionScope } = await resolveContext(req, 'customers.deals.manage')
    let input = saveDealStatusVocabularySchema.parse(await readJsonSafe(req, null))
    const legacyGuard = bridgeLegacyGuard(ctx.container)
    const guards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]
    const guardInput = {
      tenantId,
      organizationId: null,
      userId: auth.sub,
      resourceKind: DEAL_STATUS_VOCABULARY_RESOURCE_KIND,
      resourceId: tenantId,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const userFeatures = await rbac.getGrantedFeatures(auth.sub, permissionScope)
    const guardResult = await runMutationGuards(guards, { ...guardInput, mutationPayload: input }, { userFeatures })
    if (!guardResult.ok) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(guardResult.errorBody ?? {
        error: translate('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
      }, { status: guardResult.errorStatus ?? 422 })
    }
    if (guardResult.modifiedPayload) {
      input = saveDealStatusVocabularySchema.parse({ ...input, ...guardResult.modifiedPayload })
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<z.infer<typeof saveDealStatusVocabularySchema>, Awaited<ReturnType<typeof resolveDealStatusVocabulary>>>(
      'customers.settings.save_deal_status_vocabulary',
      { input, ctx },
    )
    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata })
      } catch (error) {
        reportRouteError(error, 'customers.deal_status_vocabulary_guard_after_success_failed')
      }
    }
    return NextResponse.json(result)
  } catch (error) {
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleError(error, 'save')
  }
}

const responseSchema = z.object({
  vocabulary: dealStatusVocabularySchema,
  source: z.enum(['tenant', 'env', 'default']),
  updatedAt: z.string().nullable(),
})
const errorSchema = z.object({ error: z.string() }).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Tenant deal status vocabulary',
  methods: {
    GET: {
      summary: 'Read the effective tenant deal status vocabulary',
      description: 'Resolves tenant configuration, then the environment default, then built-in statuses. Requires customers.deals.view.',
      responses: [{ status: 200, description: 'Effective vocabulary and tenant record version', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Save or reset the tenant deal status vocabulary',
      description: 'Requires customers.deals.manage. Send null to reset to the environment or built-in vocabulary. Supports the standard optimistic-lock expected-updated-at header.',
      requestBody: { contentType: 'application/json', schema: saveDealStatusVocabularySchema },
      responses: [{ status: 200, description: 'Updated effective vocabulary', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid vocabulary', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 409, description: 'Concurrent edit conflict', schema: errorSchema },
        { status: 422, description: 'Mutation blocked', schema: errorSchema },
      ],
    },
  },
}
