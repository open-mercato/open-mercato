import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  xrayErrorSchema,
  xraySettingsResponseSchema,
  xraySettingsSaveSchema,
  xraySettingsUpdateSchema,
  type XraySettingsSaveInput,
} from '../../../data/validators'
import { XRAY_SETTINGS_SAVE_COMMAND_ID, type SaveXraySettingsResult } from '../../../commands/xray-settings'
import { XRAY_SETTINGS_RESOURCE_KIND, findXraySettingsRecord, loadXraySettings, type XraySettingsSnapshot } from '../../../lib/projection/settings'
import { invalidateXrayAnalytics } from '../../../lib/analytics/index'
import { resolveXrayRouteContext, xrayInternalError, xrayJson, type XrayRouteContext } from '../../../lib/xrayRoutes'

const logger = createLogger('insights').child({ component: 'xray-settings-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['insights.xray.manage'] },
}

/**
 * Drops the organization's cached analytics and marks its rollups stale after a settings save
 * (privacy thresholds, debounce, time zone, enabled flag). Never fails the save: results keyed by
 * the old settings fingerprint are not served anyway, and the rest expire on their own.
 */
async function invalidateAnalyticsAfterSave(context: XrayRouteContext): Promise<void> {
  try {
    await invalidateXrayAnalytics(context.container, context.scope)
  } catch (error) {
    logger.warn('[internal] Could not invalidate the X-Ray analytics after a settings save', { organizationId: context.scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_analytics_invalidation_failed', attributes: { reason: 'settings' } })
  }
}

function toResult(settings: XraySettingsSnapshot) {
  return {
    enabled: settings.enabled,
    retentionDays: settings.retentionDays,
    kAnonymity: settings.kAnonymity,
    debounceSeconds: settings.debounceSeconds,
    individualsEnabled: settings.individualsEnabled,
    timeZone: settings.timeZone,
    suggestionMinSupport: settings.suggestionMinSupport,
    conformanceWorkflowId: settings.conformanceWorkflowId,
    activityStepMap: settings.activityStepMap,
    updatedAt: settings.updatedAt,
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req, metadata.GET.requireFeatures)
    if (context instanceof NextResponse) return context
    const em = (context.container.resolve('em') as EntityManager).fork()
    const settings = await loadXraySettings(em, context.scope)
    return xrayJson({ ok: true, result: toResult(settings) })
  } catch (error) {
    return xrayInternalError(error, 'xray.settings.get')
  }
}

export async function PUT(req: Request) {
  try {
    const context = await resolveXrayRouteContext(req, metadata.PUT.requireFeatures)
    if (context instanceof NextResponse) return context
    const { translate } = await resolveTranslations()
    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = xraySettingsUpdateSchema.safeParse(body && typeof body === 'object' && !Array.isArray(body) ? body : {})
    if (!parsed.success) {
      return xrayJson({ error: translate('insights.xray.errors.invalidSettings', 'Invalid Process X-Ray settings'), code: 'invalid_settings' }, 400)
    }
    const em = (context.container.resolve('em') as EntityManager).fork()
    const existing = await findXraySettingsRecord(em, context.scope)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.auth.sub ?? '', tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: XRAY_SETTINGS_RESOURCE_KIND,
        resourceId: existing?.id ?? null,
        operation: existing ? 'update' : 'create',
        mutationPayload: { ...parsed.data },
      },
    })
    if (!guarded.ok) return guarded.response
    const guardedInput = guarded.modifiedPayload
      ? xraySettingsUpdateSchema.parse({ ...parsed.data, ...guarded.modifiedPayload })
      : parsed.data
    const commandInput: XraySettingsSaveInput = xraySettingsSaveSchema.parse({
      ...guardedInput,
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
    })
    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<XraySettingsSaveInput, SaveXraySettingsResult>(XRAY_SETTINGS_SAVE_COMMAND_ID, {
      input: commandInput,
      ctx: context.commandContext,
    })
    await invalidateAnalyticsAfterSave(context)
    await guarded.runAfterSuccess()
    return xrayJson({ ok: true, result: toResult(result) })
  } catch (error) {
    if (isCrudHttpError(error)) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(translateCrudErrorBody(error.body, translate), { status: error.status })
    }
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    if (error instanceof z.ZodError) return xrayJson({ error: 'invalid_settings', code: 'invalid_settings' }, 400)
    return xrayInternalError(error, 'xray.settings.put')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray settings',
  description: 'Per-organization Process X-Ray settings (ingest switch, retention, privacy thresholds, conformance mapping).',
  methods: {
    GET: {
      summary: 'Get Process X-Ray settings',
      description: 'Returns the effective settings of the selected organization; `updatedAt` is null until they are first saved.',
      responses: [{ status: 200, description: 'Effective settings', schema: xraySettingsResponseSchema }],
      errors: [
        { status: 400, description: 'No organization is selected, or it is outside the caller\'s organizations or the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update Process X-Ray settings',
      description: 'Partially updates the settings. Send the last `updatedAt` in `x-om-ext-optimistic-lock-expected-updated-at`; a stale token answers 409 with `code: optimistic_lock_conflict`. `timeZone` must be an IANA zone (stored canonically). `suggestionMinSupport` (5 … 100000, or null for the default 20) lowers or raises the support threshold of automation suggestions. A `conformanceWorkflowId` must be a workflow definition of the same tenant and organization. A successful save invalidates the organization\'s cached analytics and rollups.',
      requestBody: { contentType: 'application/json', schema: xraySettingsUpdateSchema },
      responses: [{ status: 200, description: 'Saved settings', schema: xraySettingsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid settings, no organization selected, or an organization outside the caller\'s organizations or the tenant', schema: xrayErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayErrorSchema },
        { status: 403, description: 'Missing `insights.xray.manage` or no organization access', schema: xrayErrorSchema },
        { status: 409, description: 'The settings were changed by someone else (optimistic lock)', schema: xrayErrorSchema },
        { status: 422, description: 'The conformance workflow is not a definition of this tenant and organization (`conformance_workflow_not_found`), or the workflows module is unavailable (`workflows_unavailable`)', schema: xrayErrorSchema },
      ],
    },
  },
}
