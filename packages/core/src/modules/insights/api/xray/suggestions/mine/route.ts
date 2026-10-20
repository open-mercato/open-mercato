import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards, type RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { xrayErrorSchema, xraySuggestionMineRequestSchema, xraySuggestionMineResponseSchema } from '../../../../data/validators'
import { XRAY_SUGGESTION_MINING_RESOURCE_KIND } from '../../../../lib/suggestions/constants'
import { requestXraySuggestionMining, type XraySuggestionMiningRequestResult } from '../../../../lib/suggestions/request'
import { resolveXrayRouteContext, xrayInternalError, xrayJson } from '../../../../lib/xrayRoutes'

const logger = createLogger('insights').child({ component: 'xray-suggestion-mining-route' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
}

async function runAfterSuccessSafely(guarded: RouteMutationGuardPassed): Promise<void> {
  try {
    await guarded.runAfterSuccess()
  } catch (error) {
    logger.error('[internal] X-Ray suggestion mining mutation guard after-success callback failed', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_guard_after_success_failed' })
  }
}

type RefusedMiningRequest = Exclude<XraySuggestionMiningRequestResult['status'], 'enqueued' | 'pending'>

/**
 * Requests an on-demand automation suggestion mining pass of the selected organization (ignoring
 * the 24-hour interval; at most one forced pass per 15 minutes). Runs the registered mutation
 * guards (`insights.xray_suggestion_mining`, resource id = the organization), then refuses with 409
 * `disabled` (settings or kill switch), `projection_incomplete` (backfill, rebuild or range scan
 * running), `no_processes` or `busy` (mining queue backlogged) before enqueueing. Idempotent: while
 * an earlier request's job is still pending, 202 is answered without enqueueing a second job.
 */
export async function POST(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req, metadata.POST.requireFeatures)
    if (context instanceof NextResponse) return context
    const { translate } = await resolveTranslations()
    const body = await readJsonSafe<unknown>(req, {})
    const parsed = xraySuggestionMineRequestSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return xrayJson({ error: translate('insights.xray.errors.invalid_request', 'Invalid request'), code: 'invalid_request' }, 400)
    }
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.auth.sub ?? '', tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: XRAY_SUGGESTION_MINING_RESOURCE_KIND,
        resourceId: context.scope.organizationId,
        operation: 'update',
        mutationPayload: { ...parsed.data },
      },
    })
    if (!guarded.ok) return guarded.response
    if (guarded.modifiedPayload) xraySuggestionMineRequestSchema.parse({ ...parsed.data, ...guarded.modifiedPayload })
    const requested = await requestXraySuggestionMining(context.container, context.scope)
    if (requested.status !== 'enqueued' && requested.status !== 'pending') {
      const messages: Record<RefusedMiningRequest, string> = {
        disabled: translate('insights.xray.errors.disabled', 'Process X-Ray ingest is disabled for this organization.'),
        projection_incomplete: translate('insights.xray.errors.projection_incomplete', 'The process projection is still catching up. Try again once the backfill has finished.'),
        no_processes: translate('insights.xray.errors.noProcesses', 'No module declares a process for Process X-Ray.'),
        busy: translate('insights.xray.errors.busy', 'Process X-Ray is busy. Try again in a moment.'),
      }
      return xrayJson({ error: messages[requested.status], code: requested.status }, 409)
    }
    const response = xrayJson({ ok: true, enqueued: true }, 202)
    await runAfterSuccessSafely(guarded)
    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return xrayJson({ error: translate('insights.xray.errors.invalid_request', 'Invalid request'), code: 'invalid_request' }, 400)
    }
    return xrayInternalError(error, 'xray.suggestions.mine')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Mine Process X-Ray automation suggestions now',
  methods: {
    POST: {
      summary: 'Enqueue an automation suggestion mining pass',
      description: 'Enqueues a mining pass of the selected organization now (normally the system tick mines each enabled, completely projected organization once a day). Runs the registered mutation guards (`insights.xray_suggestion_mining`, resource id = organization id). An organization whose X-Ray is disabled or whose projection is incomplete (backfill, rebuild or range scan running) is refused before anything is enqueued. Idempotent: while a pass requested earlier is still waiting or running, the request is answered 202 without enqueueing a second one. A pass runs at most once per 15 minutes per organization; a request within 15 minutes of the last pass is coalesced with it.',
      requestBody: { contentType: 'application/json', schema: xraySuggestionMineRequestSchema },
      responses: [{ status: 202, description: 'A mining pass is enqueued (by this request, or still pending from an earlier one)', schema: xraySuggestionMineResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request, no organization selected, or the organization is outside the caller\'s organizations or the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
        { status: 409, description: 'X-Ray is disabled for the organization (`disabled`), its projection is still catching up (`projection_incomplete`), no module declares a process (`no_processes`) or the mining queue is backlogged (`busy`)', schema: xrayErrorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: xrayErrorSchema },
      ],
    },
  },
}
