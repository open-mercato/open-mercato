import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards, type RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  xrayAnalyticsErrorSchema,
  xraySuggestionPathParamsSchema,
  xraySuggestionResponseSchema,
  xraySuggestionUpdateCommandSchema,
  xraySuggestionUpdateSchema,
  type XraySuggestionUpdateCommandInput,
} from '../../../../data/validators'
import { XRAY_SUGGESTION_UPDATE_COMMAND_ID, type UpdateXraySuggestionResult } from '../../../../commands/xray-suggestions'
import { XRAY_SUGGESTION_RESOURCE_KIND } from '../../../../lib/suggestions/constants'
import { findSuggestion } from '../../../../lib/suggestions/store'
import { createXrayDatabase } from '../../../../lib/projection/runtime'
import { xrayAnalyticsFailure, xrayAnalyticsJson, xrayErrorResponse, type XrayRouteParams } from '../../../../lib/xrayAnalyticsRoutes'
import { prepareXraySuggestionRoute, toSuggestionView, xraySuggestionNotFound } from '../../../../lib/xraySuggestionRoutes'

const logger = createLogger('insights').child({ component: 'xray-suggestion-route' })

const XRAY_MANAGE_FEATURE = 'insights.xray.manage'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: [XRAY_MANAGE_FEATURE] },
}

async function runAfterSuccessSafely(guarded: RouteMutationGuardPassed): Promise<void> {
  try {
    await guarded.runAfterSuccess()
  } catch (error) {
    logger.error('[internal] X-Ray suggestion mutation guard after-success callback failed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_guard_after_success_failed' })
  }
}

/**
 * Changes a suggestion's status (`dismissed`, `drafted` with the created workflow definition, or
 * `open`) through the `insights.xray.suggestion.update` command (optimistic lock on `updatedAt`,
 * compare-and-set write, audited). Needs `insights.xray.manage`, `insights.xray.view` and the
 * process's features at the suggestion's organization (else the same 404 as an unknown id); runs
 * the registered mutation guards (`insights.xray_suggestion`, resource id = suggestion id).
 */
export async function PATCH(req: Request, context: XrayRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const prepared = await prepareXraySuggestionRoute(req, context, [XRAY_MANAGE_FEATURE])
    if (prepared instanceof NextResponse) return prepared
    translate = prepared.translate
    const body = await readJsonSafe<unknown>(req, null)
    const parsed = xraySuggestionUpdateSchema.safeParse(body && typeof body === 'object' && !Array.isArray(body) ? body : {})
    if (!parsed.success) return xrayErrorResponse(prepared.translate, 'invalid_request', 400)
    const { suggestion, container, auth } = prepared
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub ?? '', tenantId: suggestion.tenantId, organizationId: suggestion.organizationId },
      input: {
        resourceKind: XRAY_SUGGESTION_RESOURCE_KIND,
        resourceId: suggestion.id,
        operation: 'update',
        mutationPayload: { ...parsed.data },
      },
    })
    if (!guarded.ok) return guarded.response
    const guardedInput = guarded.modifiedPayload
      ? xraySuggestionUpdateSchema.parse({ ...parsed.data, ...guarded.modifiedPayload })
      : parsed.data
    const commandInput: XraySuggestionUpdateCommandInput = xraySuggestionUpdateCommandSchema.parse({
      ...guardedInput,
      tenantId: suggestion.tenantId,
      organizationId: suggestion.organizationId,
      id: suggestion.id,
    })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const commandBus = container.resolve('commandBus') as CommandBus
    await commandBus.execute<XraySuggestionUpdateCommandInput, UpdateXraySuggestionResult>(XRAY_SUGGESTION_UPDATE_COMMAND_ID, {
      input: commandInput,
      ctx: {
        container,
        auth,
        organizationScope,
        selectedOrganizationId: suggestion.organizationId,
        organizationIds: [suggestion.organizationId],
        request: req,
      },
    })
    const em = (container.resolve('em') as EntityManager).fork()
    const saved = await findSuggestion(createXrayDatabase(em), suggestion.tenantId, suggestion.id)
    if (!saved) return xraySuggestionNotFound(prepared.translate)
    const response = xrayAnalyticsJson({ ok: true, result: toSuggestionView(saved, prepared.process) })
    await runAfterSuccessSafely(guarded)
    return response
  } catch (error) {
    if (isCrudHttpError(error)) {
      const { translate: translateWithFallback } = await resolveTranslations()
      return NextResponse.json(translateCrudErrorBody(error.body, translateWithFallback), { status: error.status })
    }
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (error instanceof z.ZodError && translate) return xrayErrorResponse(translate, 'invalid_request', 400)
    return xrayAnalyticsFailure(error, translate, 'xray.suggestions.update')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray suggestion',
  pathParams: xraySuggestionPathParamsSchema,
  methods: {
    PATCH: {
      summary: 'Change the status of a suggestion',
      description: 'Sets `dismissed`, `drafted` (with `draftedArtifactId`: a workflow definition of the suggestion\'s tenant and organization, usually the one just created from `GET …/draft`) or `open`. Send the last `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`; a stale token answers 409 with `code: optimistic_lock_conflict` (a mining pass that changed the suggestion moves its version too). A superseded suggestion cannot be changed (422 `suggestion_superseded`). Runs the registered mutation guards (`insights.xray_suggestion`). Mining never reverts a dismissal or a draft.',
      requestBody: { contentType: 'application/json', schema: xraySuggestionUpdateSchema },
      responses: [{ status: 200, description: 'Updated suggestion', schema: xraySuggestionResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body (`invalid_request`)', schema: xrayAnalyticsErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayAnalyticsErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no resolved tenant (`tenant_required`)', schema: xrayAnalyticsErrorSchema },
        { status: 404, description: 'Unknown suggestion, or one the caller may not see or manage (identical body, `suggestion_not_found`)', schema: xrayAnalyticsErrorSchema },
        { status: 409, description: 'The suggestion was changed meanwhile (optimistic lock)', schema: xrayAnalyticsErrorSchema },
        { status: 422, description: 'Superseded suggestion (`suggestion_superseded`), workflow definition not found in the organization (`drafted_artifact_not_found`), workflows unavailable (`workflows_unavailable`) or blocked by a mutation guard', schema: xrayAnalyticsErrorSchema },
      ],
    },
  },
}
