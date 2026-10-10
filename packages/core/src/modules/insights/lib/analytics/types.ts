import { z } from 'zod'
import { PROCESS_CASE_STATUSES, PROCESS_KEY_PATTERN } from '@open-mercato/shared/modules/insights/process'
import { CASE_EVENT_LIMIT } from '../process/caseSummary'

export const XRAY_ANALYTICS_LIMITS = {
  maxWindowDays: 180,
  maxEvents: 200_000,
  maxEventsPerCase: CASE_EVENT_LIMIT,
  maxPageSize: 100,
  defaultPageSize: 50,
  maxVariants: 100,
  defaultVariants: 20,
  maxMapNodes: 200,
  maxMapEdges: 400,
  maxBottlenecks: 100,
  maxUnmappedActivities: 100,
  maxRawVariantHashes: 20,
  maxOrganizationIds: 1000,
  maxModels: 20,
} as const

export const XRAY_STATEMENT_TIMEOUT_MS = 5000

export const XRAY_ROLLUP_STATEMENT_TIMEOUT_MS = 30_000

export const XRAY_STATS_GUARDS = {
  minMedianN: 5,
  minP90N: 20,
  lowConfidenceN: 30,
  minDistinctActors: 3,
  defaultK: 10,
  minK: 5,
} as const

export const XRAY_DEFAULT_DEBOUNCE_SECONDS = 120

export const XRAY_DEFAULT_TIME_ZONE = 'UTC'

export const XRAY_CONFORMANCE_MIN_COVERAGE = 0.6

export const XRAY_WINDOW_KEYS = ['7d', '30d', '90d'] as const

export type XrayWindowKey = (typeof XRAY_WINDOW_KEYS)[number]

export const XRAY_WINDOW_DAYS: Record<XrayWindowKey, number> = { '7d': 7, '30d': 30, '90d': 90 }

export const XRAY_AGE_BUCKETS = ['lt_1d', '1d_7d', '7d_30d', '30d_90d', 'gte_90d'] as const

export type XrayAgeBucket = (typeof XRAY_AGE_BUCKETS)[number]

export const XRAY_BREAKDOWN_GROUPS = ['org', 'role', 'team', 'user'] as const

export type XrayBreakdownGroup = (typeof XRAY_BREAKDOWN_GROUPS)[number]

export const XRAY_NONE_GROUP = 'none'

export const XRAY_MAP_START = '__start__'

export const XRAY_MAP_END = '__end__'

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

const CAUSE_KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/

const VARIANT_HASH_PATTERN = /^[0-9a-f]{64}$/

const count = () => z.number().int().nonnegative()

/** A UUID in its canonical lower-case spelling (the database returns ids lower-case). */
const canonicalUuid = () => z.string().uuid().transform((value) => value.toLowerCase())

export const isoDateTimeSchema = z
  .string()
  .max(64)
  .regex(ISO_DATETIME_PATTERN)
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'invalid date-time' })

export const analyticsScopeSchema = z.object({
  tenantId: canonicalUuid(),
  organizationIds: z.array(canonicalUuid()).max(XRAY_ANALYTICS_LIMITS.maxOrganizationIds).nullable(),
})

export type AnalyticsScope = z.infer<typeof analyticsScopeSchema>

export const analyticsViewerSchema = z.object({
  userId: canonicalUuid().nullable(),
  features: z.array(z.string().min(1).max(200)).max(5000),
  canViewIndividuals: z.boolean(),
})

export type AnalyticsViewer = z.infer<typeof analyticsViewerSchema>

export const windowInputSchema = z.union([
  z.object({ windowKey: z.enum(XRAY_WINDOW_KEYS) }).strict(),
  z.object({ from: isoDateTimeSchema, to: isoDateTimeSchema }).strict(),
])

export type WindowInput = z.infer<typeof windowInputSchema>

export const analyticsFiltersSchema = z
  .object({
    causeKinds: z.array(z.string().regex(CAUSE_KIND_PATTERN)).min(1).max(20).optional(),
    actorRoleIds: z.array(canonicalUuid()).min(1).max(50).optional(),
    actorTeamIds: z.array(canonicalUuid()).min(1).max(50).optional(),
    includeSyncRun: z.boolean().optional(),
  })
  .strict()

export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>

export const analyticsRequestSchema = z.object({
  scope: analyticsScopeSchema,
  processKey: z.string().regex(PROCESS_KEY_PATTERN),
  window: windowInputSchema,
  timeZone: z.string().min(1).max(64).optional(),
  filters: analyticsFiltersSchema.default({}),
  viewer: analyticsViewerSchema,
})

export type AnalyticsRequestInput = z.input<typeof analyticsRequestSchema>

export type AnalyticsRequest = z.infer<typeof analyticsRequestSchema>

export const variantsRequestSchema = analyticsRequestSchema.extend({
  limit: z.number().int().min(1).max(XRAY_ANALYTICS_LIMITS.maxVariants).default(XRAY_ANALYTICS_LIMITS.defaultVariants),
})

export type VariantsRequestInput = z.input<typeof variantsRequestSchema>

export const breakdownRequestSchema = analyticsRequestSchema.extend({
  groupBy: z.enum(XRAY_BREAKDOWN_GROUPS).default('org'),
})

export type BreakdownRequestInput = z.input<typeof breakdownRequestSchema>

const modelStepSchema = z.string().min(1).max(200)

export const designedModelSchema = z
  .object({
    key: z.string().min(1).max(200),
    source: z.object({
      kind: z.enum(['workflow', 'sequence']),
      definitionId: z.string().min(1).max(200).nullable(),
      version: z.number().int().nullable(),
    }),
    steps: z.array(modelStepSchema).min(1).max(500),
    transitions: z.array(z.tuple([modelStepSchema, modelStepSchema])).max(5000),
    startSteps: z.array(modelStepSchema).min(1).max(500),
    endSteps: z.array(modelStepSchema).min(1).max(500),
    activityStepMap: z.record(z.string().min(1).max(200), modelStepSchema),
  })
  .superRefine((model, ctx) => {
    const steps = new Set(model.steps)
    const known = (step: string) => steps.has(step)
    if (!model.startSteps.every(known)) ctx.addIssue({ code: 'custom', message: 'startSteps must be declared steps', path: ['startSteps'] })
    if (!model.endSteps.every(known)) ctx.addIssue({ code: 'custom', message: 'endSteps must be declared steps', path: ['endSteps'] })
    if (!model.transitions.every(([from, to]) => known(from) && known(to))) {
      ctx.addIssue({ code: 'custom', message: 'transitions must connect declared steps', path: ['transitions'] })
    }
    if (!Object.values(model.activityStepMap).every(known)) {
      ctx.addIssue({ code: 'custom', message: 'activityStepMap must point at declared steps', path: ['activityStepMap'] })
    }
  })

export type DesignedProcessModel = z.infer<typeof designedModelSchema>

export const conformanceRequestSchema = analyticsRequestSchema.extend({
  models: z.array(designedModelSchema).min(1).max(XRAY_ANALYTICS_LIMITS.maxModels),
  caseModelKeys: z
    .record(z.string().uuid(), z.string().min(1).max(200))
    .transform((keys) => Object.fromEntries(Object.entries(keys).map(([caseId, modelKey]) => [caseId.toLowerCase(), modelKey])))
    .optional(),
  organizationModelKeys: z
    .record(z.string().uuid(), z.string().min(1).max(200))
    .transform((keys) => Object.fromEntries(Object.entries(keys).map(([organizationId, modelKey]) => [organizationId.toLowerCase(), modelKey])))
    .optional(),
})

export type ConformanceRequestInput = z.input<typeof conformanceRequestSchema>

/**
 * A case-id listing of the analytics population of the window. `variantHash` / `variantHashes`
 * drill into variants by the STORED `variant_hash` of the cases (the `rawVariantHashes` a
 * variants item reports, not its collapsed `variantHash`) and restrict the listing to cases
 * completed in the window, like the variants. A drill-down lists only a cell the analytics show
 * for the same scope, window, time zone, filters and viewer: the `activityKey` node of the map,
 * and every requested hash in the `rawVariantHashes` of a reported variant (variants at the
 * maximum limit). The listed population itself (narrower when statuses, an activity with a
 * variant, or one stored hash of a collapsed variant are requested) must pass the same k /
 * three-actor rule; otherwise the page is empty with `suppressed: true`.
 */
export const listCasesRequestSchema = analyticsRequestSchema.extend({
  pageSize: z.number().int().min(1).max(XRAY_ANALYTICS_LIMITS.maxPageSize).default(XRAY_ANALYTICS_LIMITS.defaultPageSize),
  cursor: z.string().min(1).max(400).nullable().optional(),
  statuses: z.array(z.enum(PROCESS_CASE_STATUSES)).min(1).max(PROCESS_CASE_STATUSES.length).optional(),
  variantHash: z.string().regex(VARIANT_HASH_PATTERN).optional(),
  variantHashes: z.array(z.string().regex(VARIANT_HASH_PATTERN)).min(1).max(XRAY_ANALYTICS_LIMITS.maxRawVariantHashes).optional(),
  activityKey: z.string().min(1).max(200).optional(),
})

export type ListCasesRequestInput = z.input<typeof listCasesRequestSchema>

export const resolvedWindowSchema = z.object({
  from: z.string(),
  to: z.string(),
  windowKey: z.enum(XRAY_WINDOW_KEYS).nullable(),
  timeZone: z.string(),
})

export type ResolvedWindowView = z.infer<typeof resolvedWindowSchema>

export const causeCountsSchema = z.object({
  human: count(),
  automated: count(),
  legacy: count(),
  other: count(),
  byKind: z.record(z.string(), count()),
})

export type CauseCounts = z.infer<typeof causeCountsSchema>

export const durationStatsSchema = z.object({
  n: count(),
  medianMs: z.number().nonnegative().nullable(),
  p90Ms: z.number().nonnegative().nullable(),
  lowConfidence: z.boolean(),
})

export type DurationStats = z.infer<typeof durationStatsSchema>

export const ageHistogramSchema = z.array(z.object({ bucket: z.enum(XRAY_AGE_BUCKETS), count: count() }))

export type AgeHistogram = z.infer<typeof ageHistogramSchema>

export const suppressionSummarySchema = z.object({
  cells: count(),
  minCases: count(),
  minActors: count(),
  complementary: count(),
})

export type SuppressionSummary = z.infer<typeof suppressionSummarySchema>

export const eventCountsSchema = z.object({
  raw: count(),
  collapsed: count(),
  debounced: count(),
  corrected: count(),
})

export type EventCounts = z.infer<typeof eventCountsSchema>

const envelopeShape = {
  processKey: z.string(),
  organizationIds: z.array(z.string()).nullable(),
  window: resolvedWindowSchema,
  n: count(),
  lowConfidence: z.boolean(),
  computedThrough: z.string().nullable(),
  incomplete: z.boolean(),
  kAnonymity: count(),
  suppressed: suppressionSummarySchema,
  source: z.enum(['live', 'rollup']),
}

export const analyticsEnvelopeSchema = z.object(envelopeShape)

export type AnalyticsEnvelope = z.infer<typeof analyticsEnvelopeSchema>

export const processMapResultSchema = z.object({
  ...envelopeShape,
  events: eventCountsSchema,
  casesStarted: count(),
  casesEnded: count(),
  truncatedCases: count(),
  nodes: z.array(z.object({
    activityKey: z.string(),
    activityKind: z.string(),
    raw: count(),
    collapsed: count(),
    cases: count(),
    causes: causeCountsSchema,
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    raw: count(),
    collapsed: count(),
    cases: count(),
    causes: causeCountsSchema,
  })),
  omitted: z.object({ nodes: count(), edges: count() }),
})

export type ProcessMapResult = z.infer<typeof processMapResultSchema>

export const variantsResultSchema = z.object({
  ...envelopeShape,
  distinctVariants: z.object({ raw: count(), collapsed: count() }),
  truncatedCases: count(),
  items: z.array(z.object({
    variantHash: z.string(),
    rawVariantHashes: z.array(z.string()),
    rawVariantHashesTruncated: z.boolean(),
    activityKeys: z.array(z.string()),
    cases: count(),
    share: z.number().min(0).max(1),
    cycleTime: durationStatsSchema,
  })),
  omitted: z.object({ variants: count(), cases: count() }),
})

export type VariantsResult = z.infer<typeof variantsResultSchema>

const completedDurationsSchema = z.object({
  empty: z.boolean(),
  stats: durationStatsSchema,
  histogram: ageHistogramSchema,
  excludedSyncRun: count(),
})

const openDurationsSchema = z.object({
  empty: z.boolean(),
  censored: z.literal(true),
  asOf: z.string(),
  stats: durationStatsSchema,
  histogram: ageHistogramSchema,
})

export const durationsResultSchema = z.object({
  ...envelopeShape,
  includeSyncRun: z.boolean(),
  truncatedCases: count(),
  completed: completedDurationsSchema.nullable(),
  open: openDurationsSchema.nullable(),
  byOrganization: z.array(z.object({
    organizationId: z.string(),
    completed: completedDurationsSchema.nullable(),
    open: openDurationsSchema.nullable(),
  })),
})

export type DurationsResult = z.infer<typeof durationsResultSchema>

export const bottlenecksResultSchema = z.object({
  ...envelopeShape,
  includeSyncRun: z.boolean(),
  transitions: z.object({ raw: count(), collapsed: count(), measured: count(), excludedSyncRun: count() }),
  items: z.array(z.object({
    from: z.string(),
    to: z.string(),
    transitions: count(),
    rawTransitions: count(),
    cases: count(),
    wait: durationStatsSchema,
    totalWaitMs: z.number().nonnegative().nullable(),
  })),
  omitted: count(),
})

export type BottlenecksResult = z.infer<typeof bottlenecksResultSchema>

export const reworkResultSchema = z.object({
  ...envelopeShape,
  rework: count(),
  reworkRaw: count(),
  corrections: count(),
  debounced: count(),
  casesWithRework: count(),
  casesWithReworkRaw: count(),
  reworkRate: z.number().min(0).max(1).nullable(),
  reworkRateLowerBound: z.number().min(0).max(1).nullable(),
  truncatedCases: count(),
  byStage: z.array(z.object({
    activityKey: z.string(),
    rework: count(),
    reworkRaw: count(),
    corrections: count(),
    cases: count(),
  })),
})

export type ReworkResult = z.infer<typeof reworkResultSchema>

export const breakdownResultSchema = z.object({
  ...envelopeShape,
  groupBy: z.enum(XRAY_BREAKDOWN_GROUPS),
  perPerson: z.boolean(),
  overlapping: z.boolean(),
  includeSyncRun: z.boolean(),
  items: z.array(z.object({
    organizationId: z.string(),
    group: z.string(),
    raw: count(),
    collapsed: count(),
    cases: count(),
    actors: count(),
    causes: causeCountsSchema,
    stepWait: durationStatsSchema,
  })),
})

export type BreakdownResult = z.infer<typeof breakdownResultSchema>

export const CONFORMANCE_DEVIATION_KINDS = ['invalid_start', 'invalid_transition', 'invalid_end'] as const

export type ConformanceDeviationKind = (typeof CONFORMANCE_DEVIATION_KINDS)[number]

export const conformanceModelResultSchema = z.object({
  key: z.string(),
  source: z.object({
    kind: z.enum(['workflow', 'sequence']),
    definitionId: z.string().nullable(),
    version: z.number().int().nullable(),
  }),
  n: count(),
  conformingCases: count().nullable(),
  fitness: z.number().min(0).max(1).nullable(),
  fitnessLowerBound: z.number().min(0).max(1).nullable(),
  lowConfidence: z.boolean(),
  transitions: z.object({ total: count(), allowed: count() }).nullable(),
  deviations: z.array(z.object({
    kind: z.enum(CONFORMANCE_DEVIATION_KINDS),
    from: z.string().nullable(),
    to: z.string().nullable(),
    cases: count(),
  })),
})

export type ConformanceModelResult = z.infer<typeof conformanceModelResultSchema>

export const CONFORMANCE_REFUSAL_REASONS = ['insufficient_coverage', 'no_cases'] as const

export type ConformanceRefusalReason = (typeof CONFORMANCE_REFUSAL_REASONS)[number]

export const conformanceResultSchema = z.discriminatedUnion('status', [
  z.object({
    ...envelopeShape,
    status: z.literal('refused'),
    reason: z.enum(CONFORMANCE_REFUSAL_REASONS),
    coverage: z.number().min(0).max(1).nullable(),
    minCoverage: z.number(),
    truncatedCases: count(),
  }),
  z.object({
    ...envelopeShape,
    status: z.literal('ok'),
    coverage: z.number().min(0).max(1),
    minCoverage: z.number(),
    truncatedCases: count(),
    unresolvedCases: count(),
    models: z.array(conformanceModelResultSchema),
    unmappedActivities: z.array(z.object({ activityKey: z.string(), events: count() })),
  }),
])

export type ConformanceResult = z.infer<typeof conformanceResultSchema>

/**
 * Headline figures of one process: `n` is the number of cases with a non-voided event in the
 * window (always returned, like every `n`); `openCases` are the cases open at `openCasesAsOf`
 * (the window end, or now if earlier), withheld (`null`) when fewer than k but not zero, like
 * the open-case cell of the durations.
 */
export const processSummaryResultSchema = z.object({
  processKey: z.string(),
  organizationIds: z.array(z.string()).nullable(),
  window: resolvedWindowSchema,
  n: count(),
  lowConfidence: z.boolean(),
  computedThrough: z.string().nullable(),
  incomplete: z.boolean(),
  kAnonymity: count(),
  openCases: count().nullable(),
  openCasesAsOf: z.string(),
})

export type ProcessSummaryResult = z.infer<typeof processSummaryResultSchema>

export const caseListResultSchema = z.object({
  processKey: z.string(),
  organizationIds: z.array(z.string()).nullable(),
  window: resolvedWindowSchema,
  n: count(),
  computedThrough: z.string().nullable(),
  incomplete: z.boolean(),
  suppressed: z.boolean().describe('True when the drill-down (`activityKey`, `variantHash` / `variantHashes`) targets a cell the map or the variants do not show for the same scope, window, time zone, filters and viewer (fewer than k cases or three actors, complementary suppression, or beyond the display caps): the page is then empty (`items: []`, `nextCursor: null`, `n: 0`). Always false without a drill-down.'),
  items: z.array(z.object({ caseId: z.string(), organizationId: z.string() })),
  nextCursor: z.string().nullable(),
})

export type CaseListResult = z.infer<typeof caseListResultSchema>

export const XRAY_ROLLUP_METRICS_VERSION = 2

export const rollupMetricsSchema = z.object({
  version: z.literal(XRAY_ROLLUP_METRICS_VERSION),
  contractHash: z.string(),
  settingsFingerprint: z.string(),
  timeZone: z.string(),
  results: z.object({
    map: processMapResultSchema,
    variants: variantsResultSchema,
    durations: durationsResultSchema,
    bottlenecks: bottlenecksResultSchema,
    rework: reworkResultSchema,
  }),
})

export type RollupMetrics = z.infer<typeof rollupMetricsSchema>

export type RollupOperation = keyof RollupMetrics['results']

/**
 * Effective per-organization analytics settings (from `insights_process_settings`). A missing
 * `enabled` means enabled; a missing `timeZone` means UTC.
 */
export type AnalyticsOrgSettings = {
  kAnonymity: number
  debounceSeconds: number
  individualsEnabled: boolean
  enabled?: boolean
  timeZone?: string
}

/**
 * Settings of every organization an analytics call covers, folded to the strictest values.
 * `timeZone` is the organizations' common time zone (UTC when they differ or none is covered).
 */
export type ScopeSettings = {
  organizationIds: string[]
  kAnonymity: number
  debounceMsByOrganization: ReadonlyMap<string, number>
  individualsEnabled: boolean
  timeZone: string
  fingerprint: string
}
