import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  xrayVariantPathParamsSchema,
  xrayWorkflowDraftRequestSchema,
  xrayWorkflowDraftResponseSchema,
} from '../../../../../../data/validators'
import { XRAY_ANALYTICS_LIMITS } from '../../../../../../lib/analytics/types'
import { XRAY_DRAFT_DEFAULT_RECORD_ID_INPUT_KEY, buildVariantWorkflowDraft } from '../../../../../../lib/analytics/variantDraft'
import { resolveWorkflowDraftService } from '../../../../../../lib/workflowsBridge'
import {
  analyticsInputOf,
  readRouteParam,
  runXrayAnalyticsRoute,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../../../lib/xrayAnalyticsRoutes'
import { xrayJson } from '../../../../../../lib/xrayRoutes'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

const VARIANT_HASH_PATTERN = /^[0-9a-f]{64}$/

type FeatureChecker = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

function isFeatureChecker(value: unknown): value is FeatureChecker {
  return Boolean(value) && typeof value === 'object' && typeof (value as { userHasAllFeatures?: unknown }).userHasAllFeatures === 'function'
}

export async function POST(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.workflow_draft', async (route) => {
    const translate = route.translate
    const hash = await readRouteParam(context, 'hash')
    const body = await readJsonSafe<unknown>(req, null)
    const parsed = xrayWorkflowDraftRequestSchema.safeParse(body && typeof body === 'object' && !Array.isArray(body) ? body : {})
    if (!hash || !VARIANT_HASH_PATTERN.test(hash) || !parsed.success) return xrayErrorResponse(translate, 'invalid_request', 400)
    const request = parsed.data
    const recordIdInputKey = request.recordIdInputKey ?? XRAY_DRAFT_DEFAULT_RECORD_ID_INPUT_KEY
    if (Object.values(request.inputKeys ?? {}).includes(recordIdInputKey)) return xrayErrorResponse(translate, 'invalid_request', 400)
    const organizationId = route.access.rbacOrganizationId ?? route.access.organizationIds?.[0] ?? null
    if (!organizationId) return xrayErrorResponse(translate, 'organization_required', 400)
    const service = resolveWorkflowDraftService(route.container)
    if (!service) return xrayErrorResponse(translate, 'workflows_unavailable', 422)
    const variants = await route.analytics.getVariants({
      ...analyticsInputOf(route, request),
      limit: XRAY_ANALYTICS_LIMITS.maxVariants,
    })
    const variant = variants.items.find((item) => item.variantHash === hash)
    if (!variant) return xrayErrorResponse(translate, 'variant_not_found', 404)
    const processLabel = translate(route.process.labelKey)
    const fieldLabels = new Map(route.process.stageFields.map((field) => [field.key, translate(field.labelKey)]))
    const draft = buildVariantWorkflowDraft({
      process: route.process,
      variantHash: variant.variantHash,
      activityKeys: variant.activityKeys,
      commandId: request.commandId,
      recordIdInputKey,
      inputKeys: request.inputKeys,
      workflowId: request.workflowId,
      workflowName: request.workflowName,
      labels: {
        workflowName: translate('insights.xray.workflowDraft.name', { process: processLabel, variant: variant.variantHash.slice(0, 8) }),
        description: translate('insights.xray.workflowDraft.description', { process: processLabel }),
        start: translate('insights.xray.workflowDraft.start'),
        end: translate('insights.xray.workflowDraft.end'),
        recordId: translate('insights.xray.workflowDraft.recordId'),
        stepName: (fieldKey, value) => translate('insights.xray.workflowDraft.stepName', { field: fieldLabels.get(fieldKey) ?? fieldKey, value }),
      },
    })
    if (!draft) return xrayErrorResponse(translate, 'variant_not_draftable', 422)
    const validation = await service.validateDraftDefinition(draft.payload, { tenantId: route.access.tenantId, organizationId })
    if (!validation.ok) {
      return xrayJson({
        error: translate('insights.xray.errors.workflow_draft_invalid'),
        code: 'workflow_draft_invalid',
        hint: null,
        issues: validation.issues.map((issue) => ({ path: issue.path, code: issue.code })),
      }, 422)
    }
    const rbac = route.container.resolve('rbacService')
    if (!isFeatureChecker(rbac)) return xrayErrorResponse(translate, 'command_forbidden', 403)
    for (const command of validation.commands) {
      const allowed = await rbac.userHasAllFeatures(route.auth.sub, command.requiredFeatures, {
        tenantId: route.access.tenantId,
        organizationId: route.access.rbacOrganizationId,
      })
      if (!allowed) return xrayErrorResponse(translate, 'command_forbidden', 403)
    }
    return xrayAnalyticsJson({
      ok: true,
      persisted: false,
      processKey: route.process.processKey,
      variantHash: variant.variantHash,
      variantCases: variant.cases,
      window: variants.window,
      n: variants.n,
      computedThrough: variants.computedThrough,
      incomplete: variants.incomplete,
      payload: validation.payload,
      activityStepMap: draft.activityStepMap,
      skippedActivities: draft.skippedActivities,
      commands: validation.commands,
      workflowIdAvailable: validation.workflowIdAvailable,
    })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray variant workflow draft',
  pathParams: xrayVariantPathParamsSchema,
  methods: {
    POST: {
      summary: 'Build a disabled draft workflow from a variant',
      description: 'Turns a visible variant (an item of `GET …/variants` for the same window; suppressed or unknown variants answer 404 `variant_not_found`) into a DISABLED draft workflow definition (`enabled: false`, `lifecycle: draft`): one AUTOMATED step per stage activity, each with a single UPDATE_ENTITY activity of the given workflow-safe command setting the stage field on `{{context.recordId}}`. The payload is validated by the workflows module (definition schema, draft policy, no credential-bearing activity, catalogued workflow-safe commands) and the caller must hold the command\'s features. PERSISTS NOTHING, so no mutation guard runs: the browser creates the draft through `POST /api/workflows/definitions` as the user (guards, audit, optimistic lock). `activityStepMap` maps the variant\'s activities to the generated steps (usable for conformance).',
      requestBody: { contentType: 'application/json', schema: xrayWorkflowDraftRequestSchema },
      responses: [{ status: 200, description: 'Validated draft payload (not persisted)', schema: xrayWorkflowDraftResponseSchema }],
      errors: xrayAnalyticsErrorDocs({
        forbidden: 'Also the caller lacks the features of the command (`command_forbidden`).',
        notFound: 'Also a variant that is not visible in the window (`variant_not_found`).',
        unprocessable: 'Also: the workflows module is unavailable (`workflows_unavailable`), the variant has no stage activity to express (`variant_not_draftable`) or the draft fails the workflows validation (`workflow_draft_invalid`, with `issues`).',
      }),
    },
  },
}
