import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AiModelFactoryError, createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsErrorSchema, dashboardsTag } from '../../../openapi'
import { buildAnalyticsCatalogResponse, type AnalyticsCatalogResponse } from '../../catalog/route'
import { aggregateFunctionSchema, dateGranularitySchema, dateRangePresetSchema } from '../../../widgets/data/schema'
import type { AnalyticsRegistry } from '../../../../services/analyticsRegistry'

const logger = createLogger('dashboards').child({ component: 'custom-metric-ai' })

const AI_TIMEOUT_MS = 15_000
const TEMPORAL_VISUALIZATIONS = new Set(['line', 'bar'])

type AiModel = Parameters<typeof generateObject>[0]['model']

export const customMetricAiConfigSchema = z.object({
  entityType: z.string().min(1),
  metricField: z.string().nullable(),
  aggregate: aggregateFunctionSchema,
  groupByField: z.string().nullable(),
  granularity: dateGranularitySchema.nullable(),
  limit: z.number().int().min(1).max(20),
  visualization: z.enum(['kpi', 'line', 'bar', 'donut', 'table']),
  title: z.string(),
  dateRangeMode: z.enum(['global', 'custom']).default('global'),
  dateRangePreset: dateRangePresetSchema.nullable().default(null),
})

type CustomMetricAiConfig = z.infer<typeof customMetricAiConfigSchema>

export const customMetricAiRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
})

const customMetricAiResponseSchema = z.object({
  config: customMetricAiConfigSchema.nullable(),
  aiAvailable: z.boolean(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['dashboards.catalog.view'] },
}

type RbacFeatureService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string; organizationId?: string | null },
  ) => Promise<boolean>
}

function asAiModel(model: unknown): AiModel {
  return model as AiModel
}

function resolveAiModel(container: AwilixContainer): AiModel | null {
  try {
    const factory = createModelFactory(container)
    return asAiModel(factory.resolveModel({ moduleId: 'dashboards' }).model)
  } catch (err) {
    if (err instanceof AiModelFactoryError && err.code === 'no_provider_configured') return null
    return null
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function buildSystemPrompt(catalog: AnalyticsCatalogResponse): string {
  return [
    'You configure a dashboard metric widget from a natural-language request by a business operator.',
    'You may only use entity types and fields present in the provided catalog. Never invent entity types, fields, aggregates, or visualizations.',
    `Catalog (the only allowed vocabulary): ${JSON.stringify(catalog)}`,
    'Rules:',
    '- entityType MUST be one of the catalog entityType values.',
    '- For aggregate "count", metricField may be any field on the chosen entity (prefer its "id" field). For "sum", "avg", "min", or "max", metricField MUST be a field whose aggregates array includes that aggregate.',
    '- visualization "kpi" has no grouping: set groupByField and granularity to null.',
    '- visualization "line" requires groupByField to be a groupable timestamp field and a granularity (day, week, month, quarter, or year).',
    '- visualization "bar" may use either a groupable timestamp field with granularity, or a groupable non-timestamp categorical field. If the user asks for "per day", "by week", "daily", "grouped by days", or similar time wording, choose the entity dateField/timestamp field and set granularity accordingly. Do not replace explicit temporal grouping with customer, channel, product, or status grouping.',
    '- visualization "donut" or "table" require groupByField to be a groupable non-timestamp field; set granularity to null; limit is between 1 and 20.',
    '- dateRangeMode is "global" and dateRangePreset is null unless the request names a specific supported preset. For "last 7 days", "last 30 days", or "last 90 days", set dateRangeMode to "custom" and dateRangePreset to last_7_days, last_30_days, or last_90_days.',
    '- title is a short human-readable label for the metric.',
    'Return only JSON matching the schema.',
  ].join('\n')
}

function normalizePromptText(prompt: string): string {
  return prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function inferVisualization(prompt: string): CustomMetricAiConfig['visualization'] | null {
  const normalized = normalizePromptText(prompt)
  if (/\b(line|liniow(?:y|a|e|ego)|wykres liniowy)\b/.test(normalized)) return 'line'
  if (/\b(bar|column|slupk(?:owy|owa|owe|owego)?|kolumn(?:owy|owa|owe|owego)?)\b/.test(normalized)) return 'bar'
  if (/\b(donut|pierscieniow(?:y|a|e|ego)|kolo(?:wy|wa|we|wego)?|pie chart)\b/.test(normalized)) return 'donut'
  if (/\b(table|tabela|tabelaryczn(?:y|a|e|ego)?)\b/.test(normalized)) return 'table'
  return null
}

function inferGranularity(prompt: string): CustomMetricAiConfig['granularity'] | null {
  const normalized = normalizePromptText(prompt)
  if (/\b(day|daily|days|dzien|dziennie|dnia|dni)\b/.test(normalized)) return 'day'
  if (/\b(week|weekly|weeks|tydzien|tygodnia|tygodnie|tygodniowo)\b/.test(normalized)) return 'week'
  if (/\b(month|monthly|months|miesiac|miesiaca|miesiecy|miesiecznie)\b/.test(normalized)) return 'month'
  if (/\b(quarter|quarterly|quarters|kwartal|kwartalu|kwartalnie)\b/.test(normalized)) return 'quarter'
  if (/\b(year|yearly|years|rok|roku|lata|rocznie)\b/.test(normalized)) return 'year'
  return null
}

function inferDateRangePreset(prompt: string): CustomMetricAiConfig['dateRangePreset'] {
  const normalized = normalizePromptText(prompt)
  if (/\b(last|past|ostatni\w*|ostatnie|ostatnich)\s+(7|seven|siedem)\s+(day|days|dni|dzien|dnia)\b/.test(normalized)) return 'last_7_days'
  if (/\b(last|past|ostatni\w*|ostatnie|ostatnich)\s+(30|thirty|trzydziesci)\s+(day|days|dni|dzien|dnia)\b/.test(normalized)) return 'last_30_days'
  if (/\b(last|past|ostatni\w*|ostatnie|ostatnich)\s+(90|ninety|dziewiecdziesiat)\s+(day|days|dni|dzien|dnia)\b/.test(normalized)) return 'last_90_days'
  return null
}

function findTimestampGroupField(
  entity: AnalyticsCatalogResponse['entities'][number],
): string | null {
  const timestampFields = entity.fields.filter((field) => field.groupable && field.kind === 'timestamp')
  if (entity.dateField && timestampFields.some((field) => field.field === entity.dateField)) {
    return entity.dateField
  }
  return timestampFields[0]?.field ?? null
}

function fieldKind(
  entity: AnalyticsCatalogResponse['entities'][number],
  fieldName: string | null,
): AnalyticsCatalogResponse['entities'][number]['fields'][number]['kind'] | null {
  return entity.fields.find((field) => field.field === fieldName)?.kind ?? null
}

function applyPromptHints(
  config: CustomMetricAiConfig,
  entity: AnalyticsCatalogResponse['entities'][number],
  prompt: string,
): CustomMetricAiConfig {
  const visualization = inferVisualization(prompt)
  const granularity = inferGranularity(prompt)
  const dateRangePreset = inferDateRangePreset(prompt)
  const next: CustomMetricAiConfig = {
    ...config,
    visualization: visualization ?? config.visualization,
    dateRangeMode: dateRangePreset ? 'custom' : config.dateRangeMode,
    dateRangePreset: dateRangePreset ?? config.dateRangePreset,
  }

  if (granularity) {
    const timestampField = findTimestampGroupField(entity)
    if (timestampField) {
      next.groupByField = timestampField
      next.granularity = granularity
      if (!TEMPORAL_VISUALIZATIONS.has(next.visualization)) {
        next.visualization = 'bar'
      }
    }
  }

  if (fieldKind(entity, next.groupByField) !== 'timestamp' && next.visualization !== 'line') {
    next.granularity = null
  }

  return next
}

export function sanitizeAiConfig(raw: unknown, catalog: AnalyticsCatalogResponse, prompt = ''): CustomMetricAiConfig | null {
  const parsed = customMetricAiConfigSchema.safeParse(raw)
  if (!parsed.success) return null
  const entity = catalog.entities.find((candidate) => candidate.entityType === parsed.data.entityType)
  if (!entity) return null
  const fieldNames = new Set(entity.fields.map((field) => field.field))
  const metricField = parsed.data.metricField && fieldNames.has(parsed.data.metricField) ? parsed.data.metricField : null
  const groupByField = parsed.data.groupByField && fieldNames.has(parsed.data.groupByField) ? parsed.data.groupByField : null
  return applyPromptHints({ ...parsed.data, metricField, groupByField }, entity, prompt)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = customMetricAiRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')
  const rbacService = container.resolve<RbacFeatureService>('rbacService')
  const { translate } = await resolveTranslations()

  const catalog = await buildAnalyticsCatalogResponse(
    analyticsRegistry,
    (features) => {
      if (features.length === 0) return Promise.resolve(true)
      return rbacService.userHasAllFeatures(String(auth.sub ?? ''), features, {
        tenantId: auth.tenantId ?? '',
        organizationId: auth.orgId ?? null,
      })
    },
    translate,
  )

  if (catalog.entities.length === 0) {
    return NextResponse.json({ config: null, aiAvailable: true })
  }

  const model = resolveAiModel(container)
  if (!model) {
    return NextResponse.json({ config: null, aiAvailable: false })
  }

  try {
    const result = await withTimeout(
      generateObject({
        model,
        schema: customMetricAiConfigSchema,
        system: buildSystemPrompt(catalog),
        prompt: parsed.data.prompt,
        temperature: 0.2,
      }),
      AI_TIMEOUT_MS,
      `[internal] custom-metric AI generation timed out after ${AI_TIMEOUT_MS}ms`,
    )
    return NextResponse.json({ config: sanitizeAiConfig(result.object, catalog, parsed.data.prompt), aiAvailable: true })
  } catch (err) {
    logger.error('Custom metric AI generation failed', { err })
    return NextResponse.json({ config: null, aiAvailable: true })
  }
}

const customMetricAiPostDoc: OpenApiMethodDoc = {
  summary: 'Generate a custom metric widget configuration from a prompt',
  description:
    'Turns a natural-language request into a proposed Custom Metric widget configuration grounded in the analytics catalog the caller may query. Returns a draft configuration for the wizard to preview and edit; grants nothing beyond what the caller could build manually. Degrades to config:null when no AI provider is configured.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: customMetricAiRequestSchema,
    description: 'Natural-language description of the metric to build.',
  },
  responses: [
    {
      status: 200,
      description: 'Proposed configuration (or null when unavailable or not resolvable).',
      schema: customMetricAiResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid payload', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.catalog.view feature', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Dashboard custom metric AI generation endpoint',
  methods: {
    POST: customMetricAiPostDoc,
  },
}
