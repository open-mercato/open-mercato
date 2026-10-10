import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards, type RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { xrayErrorSchema, xraySuggestionMineRequestSchema, xraySuggestionMineResponseSchema } from '../../../../data/validators'
import { XRAY_FANOUT_MAX_BACKLOG, enqueueXraySuggestionMining, readXraySuggestionsBacklog } from '../../../../lib/projection/queue'
import { XRAY_SUGGESTION_MINING_RESOURCE_KIND } from '../../../../lib/suggestions/constants'
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

/**
 * Enqueues an on-demand automation suggestion mining pass of the selected organization (ignoring
 * the 24-hour interval; the job still skips a disabled or incompletely projected organization).
 * Runs the registered mutation guards (`insights.xray_suggestion_mining`, resource id = the
 * organization); refused with 409 `busy` while the mining queue is backlogged.
 */
export async function POST(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req)
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
    const backlog = await readXraySuggestionsBacklog()
    if (backlog !== null && backlog >= XRAY_FANOUT_MAX_BACKLOG) {
      return xrayJson({ error: translate('insights.xray.errors.busy', 'Process X-Ray is busy. Try again in a moment.'), code: 'busy' }, 409)
    }
    await enqueueXraySuggestionMining(context.scope, { force: true })
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
      description: 'Enqueues a mining pass of the selected organization now (normally the system tick mines each enabled, completely projected organization once a day). The pass still skips an organization whose X-Ray is disabled or whose projection is incomplete (backfill or rebuild running). Runs the registered mutation guards (`insights.xray_suggestion_mining`, resource id = organization id).',
      requestBody: { contentType: 'application/json', schema: xraySuggestionMineRequestSchema },
      responses: [{ status: 202, description: 'Mining pass enqueued', schema: xraySuggestionMineResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request, no organization selected, or the organization does not belong to the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
        { status: 409, description: 'The mining queue is backlogged (`busy`)', schema: xrayErrorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: xrayErrorSchema },
      ],
    },
  },
}
