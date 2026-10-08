import { z } from 'zod'
import { CAUSE_KINDS } from '@open-mercato/shared/lib/causation/types'
import { isValidHistoryTimestamp } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import {
  EXPLAIN_CONFIDENCES,
  EXPLAIN_GAP_REASONS,
  EXPLAIN_VALUE_KINDS,
  EXPLAIN_VERDICTS,
} from '@open-mercato/shared/modules/insights/explain'

export const EXPLAIN_PAGE_LIMIT_MAX = 100
export const EXPLAIN_PAGE_LIMIT_DEFAULT = 20
export const EXPLAIN_CURSOR_SEPARATOR = '_'

const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export type ExplainCursor = { at: string; id: string }

export function encodeExplainCursor(cursor: ExplainCursor): string {
  return `${cursor.at}${EXPLAIN_CURSOR_SEPARATOR}${cursor.id}`
}

export function decodeExplainCursor(value: string): ExplainCursor | null {
  if (!CURSOR_PATTERN.test(value)) return null
  const separatorIndex = value.lastIndexOf(EXPLAIN_CURSOR_SEPARATOR)
  const at = value.slice(0, separatorIndex)
  if (!isValidHistoryTimestamp(at)) return null
  return { at, id: value.slice(separatorIndex + 1).toLowerCase() }
}

const trimmedText = (max: number) => z.string().trim().min(1).max(max)

export const explainQuerySchema = z.object({
  resourceKind: trimmedText(200).describe('Registered explain resource kind, e.g. `customers.deal`.'),
  resourceId: trimmedText(200).describe('Identifier of the record to explain.'),
  field: trimmedText(200)
    .optional()
    .describe('Field to explain (`status`, `cf:<key>` for custom fields, `<collection>.<field>` with `itemId`). Omit for the overview.'),
  itemId: trimmedText(200).optional().describe('Collection item identifier, required for `<collection>.<field>` fields.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(EXPLAIN_PAGE_LIMIT_MAX)
    .default(EXPLAIN_PAGE_LIMIT_DEFAULT)
    .describe('Maximum number of chain entries to return (1-100, default 20).'),
  before: z
    .string()
    .trim()
    .refine((value) => decodeExplainCursor(value) !== null, { message: 'Invalid cursor' })
    .optional()
    .describe('Pagination cursor returned as `page.nextBefore` (`<ISO timestamp>_<log id>`).'),
})

export type ExplainQuery = z.infer<typeof explainQuerySchema>

export const explainLogQuerySchema = z.object({
  logId: z.string().trim().uuid().describe('Audit log entry identifier.'),
})

export type ExplainLogQuery = z.infer<typeof explainLogQuerySchema>

const scalarParamSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const paramsSchema = z.record(z.string(), scalarParamSchema)

export const explainValueSchema = z.object({
  value: z.unknown().describe('Raw value; null when redacted.'),
  display: z.string().nullable().describe('Resolved label for reference/dictionary values, when available.'),
  valueKind: z.enum(EXPLAIN_VALUE_KINDS),
  source: z
    .enum(['snapshot', 'implicit', 'changes', 'synthesized'])
    .describe('Where the value was read from. `synthesized` marks an undo trace value copied from the undone entry, not read from the record.'),
  redacted: z.boolean(),
})

export const explainCauseFrameSchema = z.object({
  kind: z.enum(CAUSE_KINDS),
  id: z.string().nullable(),
  ref: z.string().nullable(),
  label: z.string().nullable(),
  href: z.string().nullable(),
  available: z.boolean(),
})

export const explainCauseSchema = explainCauseFrameSchema.extend({
  labelKey: z.string().nullable(),
  legacy: z.boolean(),
  derivedFromActor: z.boolean(),
  frames: z.array(explainCauseFrameSchema),
})

export const explainActorSchema = z.object({
  kind: z.enum(['user', 'api_key', 'system']),
  id: z.string().nullable(),
  label: z.string().nullable(),
  isSelf: z.boolean(),
  redacted: z.boolean(),
})

export const explainPrincipalSchema = z.object({
  id: z.string().nullable(),
  label: z.string().nullable(),
  isSelf: z.boolean(),
  redacted: z.boolean(),
})

export const explainCausedBySchema = z.object({
  logId: z.string().nullable(),
  available: z.boolean(),
})

export const explainChainEntrySchema = z.object({
  logId: z.string(),
  at: z.string(),
  state: z.enum(['done', 'undone', 'redone']),
  action: z.string().nullable(),
  commandId: z.string().nullable(),
  from: explainValueSchema.nullable(),
  to: explainValueSchema.nullable(),
  actor: explainActorSchema,
  onBehalfOf: explainPrincipalSchema.nullable(),
  cause: explainCauseSchema,
  origin: explainCauseSchema.optional(),
  causedBy: explainCausedBySchema.nullable(),
  correlationId: z.string().nullable(),
  undoneBy: z.string().nullable(),
  confidence: z.enum(EXPLAIN_CONFIDENCES),
  orderUncertain: z.boolean().optional(),
  stale: z.boolean().optional(),
})

export const explainGapSchema = z.object({
  afterLogId: z.string().nullable(),
  beforeLogId: z.string().nullable(),
  reason: z.enum(EXPLAIN_GAP_REASONS),
  at: z.string().nullable(),
})

export const explainHintSchema = z.object({
  key: z.string(),
  params: paramsSchema,
  confidence: z.enum(EXPLAIN_CONFIDENCES).optional(),
  reference: z.object({ kind: z.string(), id: z.string(), label: z.string().nullable(), href: z.string().nullable() }).nullable().optional(),
})

export const explainSummarySchema = z.object({
  key: z.string(),
  params: paramsSchema,
})

export type ExplainDependencyView = {
  field: string
  labelKey: string | null
  verdict: (typeof EXPLAIN_VERDICTS)[number] | null
  confidence: (typeof EXPLAIN_CONFIDENCES)[number]
  lastChangeAt: string | null
  dependencies: ExplainDependencyView[]
}

export const explainDependencySchema: z.ZodType<ExplainDependencyView> = z.lazy(() =>
  z.object({
    field: z.string(),
    labelKey: z.string().nullable(),
    verdict: z.enum(EXPLAIN_VERDICTS).nullable(),
    confidence: z.enum(EXPLAIN_CONFIDENCES),
    lastChangeAt: z.string().nullable(),
    dependencies: z.array(explainDependencySchema),
  }),
)

export const explainViewerSchema = z.object({
  canSeeActors: z.boolean(),
  canSeePastValues: z.boolean(),
  canSeeOwnValues: z.boolean(),
})

export const explainPageSchema = z.object({
  limit: z.number().int(),
  nextBefore: z.string().nullable(),
  scanned: z.number().int(),
  truncated: z.boolean(),
  continuation: z.boolean(),
})

export const explainFieldResponseSchema = z.object({
  resourceKind: z.string(),
  resourceId: z.string(),
  field: z.string(),
  itemId: z.string().nullable(),
  labelKey: z.string(),
  current: z.object({ value: z.unknown(), display: z.string().nullable(), valueKind: z.enum(EXPLAIN_VALUE_KINDS) }),
  verdict: z.enum(EXPLAIN_VERDICTS),
  confidence: z.enum(EXPLAIN_CONFIDENCES),
  summary: explainSummarySchema,
  chain: z.array(explainChainEntrySchema),
  gaps: z.array(explainGapSchema),
  hints: z.array(explainHintSchema),
  dependencies: z.array(explainDependencySchema),
  page: explainPageSchema,
  viewer: explainViewerSchema,
})

export const explainCoverageSchema = z.object({
  scanned: z.number().int(),
  truncated: z.boolean(),
  legacyRows: z.number().int(),
  causeKinds: z.record(z.string(), z.number().int()),
  noHistory: z.object({ reasonKey: z.string() }).nullable(),
  unloggedWriters: z.array(z.object({ field: z.string(), id: z.string(), labelKey: z.string() })),
})

export const explainOverviewResponseSchema = z.object({
  resourceKind: z.string(),
  resourceId: z.string(),
  fields: z.array(z.object({
    field: z.string(),
    labelKey: z.string(),
    valueKind: z.enum(EXPLAIN_VALUE_KINDS),
    verdict: z.enum(EXPLAIN_VERDICTS),
    confidence: z.enum(EXPLAIN_CONFIDENCES),
    lastChangeAt: z.string().nullable(),
  })),
  coverage: explainCoverageSchema,
  viewer: explainViewerSchema,
})

const descriptorFieldSchema = z.object({
  key: z.string(),
  labelKey: z.string(),
  valueKind: z.enum(EXPLAIN_VALUE_KINDS),
  derived: z.boolean(),
  dependsOn: z.array(z.string()),
  provider: z.string().nullable(),
})

export const explainDescriptorsResponseSchema = z.object({
  resources: z.array(z.object({
    resourceKind: z.string(),
    labelKey: z.string(),
    formEntityIds: z.array(z.string()),
    fields: z.array(descriptorFieldSchema),
    collections: z.array(z.object({ key: z.string(), labelKey: z.string(), fields: z.array(descriptorFieldSchema) })),
    customFields: z.object({ entityId: z.string(), allowKeys: z.array(z.string()).nullable() }).nullable(),
    noHistory: z.object({ reasonKey: z.string() }).nullable(),
  })),
})

export const explainLogResponseSchema = z.object({
  logId: z.string(),
  at: z.string(),
  resourceKind: z.string().nullable(),
  resourceId: z.string().nullable(),
  commandId: z.string().nullable(),
  action: z.string().nullable(),
  state: z.enum(['done', 'undone', 'redone']),
  actor: explainActorSchema,
  onBehalfOf: explainPrincipalSchema.nullable(),
  cause: explainCauseSchema,
  origin: explainCauseSchema.optional(),
  causedBy: explainCausedBySchema.nullable(),
  correlationId: z.string().nullable(),
  confidence: z.enum(EXPLAIN_CONFIDENCES),
  viewer: explainViewerSchema,
})

export const explainErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
})

export type ExplainValueView = z.infer<typeof explainValueSchema>
export type ExplainCauseFrameView = z.infer<typeof explainCauseFrameSchema>
export type ExplainCauseView = z.infer<typeof explainCauseSchema>
export type ExplainActorView = z.infer<typeof explainActorSchema>
export type ExplainPrincipalView = z.infer<typeof explainPrincipalSchema>
export type ExplainCausedByView = z.infer<typeof explainCausedBySchema>
export type ExplainChainEntryView = z.infer<typeof explainChainEntrySchema>
export type ExplainGapView = z.infer<typeof explainGapSchema>
export type ExplainHintView = z.infer<typeof explainHintSchema>
export type ExplainViewerView = z.infer<typeof explainViewerSchema>
export type ExplainFieldResponse = z.infer<typeof explainFieldResponseSchema>
export type ExplainOverviewResponse = z.infer<typeof explainOverviewResponseSchema>
export type ExplainDescriptorsResponse = z.infer<typeof explainDescriptorsResponseSchema>
export type ExplainLogResponse = z.infer<typeof explainLogResponseSchema>
