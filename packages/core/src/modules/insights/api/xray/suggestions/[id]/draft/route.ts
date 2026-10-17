import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  xrayAnalyticsErrorSchema,
  xraySuggestionDraftQuerySchema,
  xraySuggestionDraftResponseSchema,
  xraySuggestionPathParamsSchema,
} from '../../../../../data/validators'
import { createDeclaredEventCatalog } from '../../../../../lib/suggestions/draft'
import { prepareSuggestionDraft } from '../../../../../lib/suggestions/draftability'
import { resolveWorkflowDraftService } from '../../../../../lib/workflowsBridge'
import { XRAY_VIEW_FEATURE } from '../../../../../lib/xrayAnalyticsAccess'
import { parseXrayQuery, xrayAnalyticsFailure, xrayAnalyticsJson, xrayErrorResponse, type XrayRouteParams } from '../../../../../lib/xrayAnalyticsRoutes'
import { prepareXraySuggestionRoute, suggestionRuleOf } from '../../../../../lib/xraySuggestionRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

/**
 * The suggestion as a validated DISABLED draft workflow (event trigger + UPDATE_ENTITY steps),
 * recomputed now (trigger / condition expressibility over the trigger event's declared payload,
 * declared update command, workflows draft policy) and only when the caller holds the command's
 * features at the suggestion's organization (else `draftable: false`, `command_forbidden`).
 * Persists nothing, so no mutation guard runs.
 */
export async function GET(req: Request, context: XrayRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const prepared = await prepareXraySuggestionRoute(req, context, [XRAY_VIEW_FEATURE])
    if (prepared instanceof NextResponse) return prepared
    translate = prepared.translate
    const t = prepared.translate
    const query = parseXrayQuery(req, xraySuggestionDraftQuerySchema)
    if (!query) return xrayErrorResponse(t, 'invalid_request', 400)
    const { suggestion, process } = prepared
    const rule = suggestionRuleOf(suggestion)
    const base = { ok: true as const, persisted: false as const, suggestionId: suggestion.id, processKey: suggestion.processKey }
    if (!rule) return xrayAnalyticsJson({ ...base, draftable: false, reason: 'draft_invalid' })
    const processLabel = t(process.labelKey)
    const fieldLabels = new Map([...process.stageFields, ...process.followupFields].map((field) => [field.key, t(field.labelKey)]))
    const followup = rule.followups[0]
    const outcome = await prepareSuggestionDraft({
      process,
      rule,
      catalog: createDeclaredEventCatalog(),
      service: resolveWorkflowDraftService(prepared.container),
      scope: { tenantId: prepared.access.tenantId, organizationId: suggestion.organizationId },
      workflowId: query.workflowId,
      labels: {
        workflowName: query.workflowName ?? t('insights.xray.suggestions.draft.name', {
          process: processLabel,
          field: fieldLabels.get(followup.field) ?? followup.field,
          value: followup.value,
        }),
        description: t('insights.xray.suggestions.draft.description', { process: processLabel }),
        triggerName: t('insights.xray.suggestions.draft.trigger', { process: processLabel }),
        start: t('insights.xray.workflowDraft.start'),
        end: t('insights.xray.workflowDraft.end'),
        recordId: t('insights.xray.workflowDraft.recordId'),
        stepName: (fieldKey, value) => t('insights.xray.workflowDraft.stepName', { field: fieldLabels.get(fieldKey) ?? fieldKey, value }),
      },
    })
    if (!outcome.draftable) {
      return xrayAnalyticsJson({
        ...base,
        draftable: false,
        reason: outcome.reason,
        ...(outcome.issues.length > 0 ? { issues: outcome.issues } : {}),
      })
    }
    for (const command of outcome.commands) {
      const allowed = await prepared.rbac.userHasAllFeatures(prepared.auth.sub as string, command.requiredFeatures, {
        tenantId: prepared.access.tenantId,
        organizationId: suggestion.organizationId,
      })
      if (!allowed) return xrayAnalyticsJson({ ...base, draftable: false, reason: 'command_forbidden' })
    }
    return xrayAnalyticsJson({
      ...base,
      draftable: true,
      reason: null,
      payload: outcome.payload,
      commands: outcome.commands,
      workflowIdAvailable: outcome.workflowIdAvailable,
    })
  } catch (error) {
    return xrayAnalyticsFailure(error, translate, 'xray.suggestions.draft')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray suggestion workflow draft',
  pathParams: xraySuggestionPathParamsSchema,
  methods: {
    GET: {
      summary: 'Build a disabled draft workflow from a suggestion',
      description: 'Turns a visible suggestion into a DISABLED draft workflow definition (`enabled: false`, `lifecycle: draft`): an event trigger on the case root\'s `created` event (the record id mapped into `{{context.recordId}}`, the condition as an `eq` filter when the event payload declares it) and one AUTOMATED step with a single UPDATE_ENTITY activity of the process\'s declared workflow-safe update command setting the follow-up field. Recomputed on every call; validated by the workflows module (definition schema, draft policy: only UPDATE_ENTITY / WAIT / SET_VARIABLE, catalogued workflow-safe commands). When the suggestion cannot be drafted, or the caller lacks the command\'s features at the suggestion\'s organization, answers 200 with `draftable: false` and `reason`. PERSISTS NOTHING: the browser creates the draft through `POST /api/workflows/definitions` as the user, then marks the suggestion `drafted`.',
      query: xraySuggestionDraftQuerySchema,
      responses: [{ status: 200, description: 'Validated draft payload (not persisted) or the reason it cannot be drafted', schema: xraySuggestionDraftResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query (`invalid_request`)', schema: xrayAnalyticsErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayAnalyticsErrorSchema },
        { status: 403, description: 'Missing `insights.xray.view` or no resolved tenant (`tenant_required`)', schema: xrayAnalyticsErrorSchema },
        { status: 404, description: 'Unknown suggestion, or one the caller may not see (identical body, `suggestion_not_found`)', schema: xrayAnalyticsErrorSchema },
      ],
    },
  },
}
