import { z } from 'zod'
import { CAUSE_KINDS } from '@open-mercato/shared/lib/causation/types'
import { isValidHistoryTimestamp } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import {
  EXPLAIN_CONFIDENCES,
  EXPLAIN_GAP_REASONS,
  EXPLAIN_VALUE_KINDS,
  EXPLAIN_VERDICTS,
} from '@open-mercato/shared/modules/insights/explain'
import { canonicalIanaTimeZone } from '../lib/analytics/window'
import { PROCESS_KEY_PATTERN } from '@open-mercato/shared/modules/insights/process'
import {
  XRAY_ANALYTICS_LIMITS,
  bottlenecksResultSchema,
  caseListResultSchema,
  conformanceResultSchema,
  processMapResultSchema,
  processSummaryResultSchema,
  resolvedWindowSchema,
  reworkResultSchema,
  variantsResultSchema,
} from '../lib/analytics/types'
import { XRAY_SUGGESTION_MIN_SUPPORT_FLOOR } from '../lib/suggestions/constants'

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
  currentPath: z.string().nullable(),
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

export const ACCESS_EXPLAIN_FEATURE_LIMIT = 20
export const ACCESS_EXPLAIN_PATH_MAX_LENGTH = 2048

export const ACCESS_EXPLAIN_REASONS = [
  'missing_feature',
  'organization_out_of_scope',
  'user_acl_override',
  'module_disabled',
  'feature_removed',
  'not_determinable',
] as const

export type AccessExplainReason = (typeof ACCESS_EXPLAIN_REASONS)[number]

export const ACCESS_EXPLAIN_SOURCES = ['super_admin', 'user_acl', 'roles', 'api_key', 'none'] as const

export const ACCESS_EXPLAIN_CHANGE_KINDS = ['user_acl', 'role_acl', 'user_roles'] as const

const ACCESS_FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_:-]+)+$/
const FIRST_PRINTABLE_CHAR_CODE = 32
const DELETE_CHAR_CODE = 127

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < FIRST_PRINTABLE_CHAR_CODE || code === DELETE_CHAR_CODE) return true
  }
  return false
}

function isApplicationPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !hasControlCharacter(value)
}

export const accessExplainQuerySchema = z.object({
  features: z
    .array(z.string().trim().min(1).max(200).regex(ACCESS_FEATURE_ID_PATTERN, { message: 'Invalid feature id' }))
    .min(1)
    .max(ACCESS_EXPLAIN_FEATURE_LIMIT)
    .describe('Feature ids to explain, comma-separated or repeated (`features=a,b` or `features=a&features=b`); at most 20 concrete ids from the ACL catalog, no wildcards.'),
  path: z
    .string()
    .trim()
    .min(1)
    .max(ACCESS_EXPLAIN_PATH_MAX_LENGTH)
    .refine(isApplicationPath, { message: 'Invalid path' })
    .optional()
    .describe('Application path where the caller was denied access. When every feature is granted to the caller, the denial came from a rule outside RBAC and is reported as `not_determinable`; ignored when explaining another user.'),
  userId: z
    .string()
    .trim()
    .uuid()
    .optional()
    .describe('User to explain; defaults to the caller. Another user requires `insights.explain.access_detail` and `auth.users.list`.'),
})

export type AccessExplainQuery = z.infer<typeof accessExplainQuerySchema>

const accessReasonSchema = z.enum(ACCESS_EXPLAIN_REASONS)

export const accessRoleGrantSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  organizations: z.array(z.string()).nullable().describe('Organizations the role ACL is restricted to; null = every organization.'),
  appliesToOrganization: z.boolean().describe('Whether the role ACL applies at the evaluated organization.'),
  grantedFeatures: z.array(z.string()).describe('Requested features the role ACL grants (wildcard-aware).'),
})

export const accessRecentChangeSchema = z.object({
  logId: z.string(),
  at: z.string(),
  kind: z.enum(ACCESS_EXPLAIN_CHANGE_KINDS),
  resourceId: z.string().nullable(),
  commandId: z.string().nullable(),
  actionLabel: z.string().nullable(),
})

export const accessExplainDetailSchema = z.object({
  subject: z.object({ kind: z.enum(['user', 'api_key']), id: z.string(), isSelf: z.boolean() }),
  source: z.enum(ACCESS_EXPLAIN_SOURCES).describe('Where the principal\'s grants come from; a per-user ACL replaces role grants.'),
  organizationId: z.string().nullable().describe('Organization the decision was evaluated at.'),
  organizationAllowed: z.boolean(),
  aclOrganizations: z.array(z.string()).nullable(),
  features: z.array(z.object({ feature: z.string(), granted: z.boolean(), reason: accessReasonSchema.nullable() })),
  userAcl: z
    .object({
      isSuperAdmin: z.boolean(),
      organizations: z.array(z.string()).nullable(),
      grantedFeatures: z.array(z.string()),
    })
    .nullable(),
  roles: z.array(accessRoleGrantSchema),
  rolesThatWouldGrant: z.array(accessRoleGrantSchema).optional().describe('Tenant roles that would grant every requested feature; omitted without `auth.roles.list`.'),
  grantedOrganizationIds: z.array(z.string()).nullable().describe('Organizations where every requested feature is granted; null = every organization.'),
  organizationsRedacted: z.boolean().describe('True when organization ids outside the caller\'s scope were omitted.'),
  recentChanges: z.array(accessRecentChangeSchema).nullable().describe('Latest ACL and role-assignment audit entries; null without `audit_logs.view_tenant`.'),
  consistentWithFreshRead: z.boolean().describe('False when a cache-bypassing re-evaluation disagreed with the cached decision.'),
})

export const accessExplainResponseSchema = z.object({
  decision: z.enum(['granted', 'denied']),
  required: z.array(z.object({ feature: z.string(), granted: z.boolean() })),
  reasons: z.array(accessReasonSchema),
  summary: explainSummarySchema.describe('Deterministic i18n summary (`key` + `params`) of the decision and its main reason.'),
  detail: accessExplainDetailSchema.nullable(),
  confidence: z.enum(EXPLAIN_CONFIDENCES),
})

export type AccessRoleGrantView = z.infer<typeof accessRoleGrantSchema>
export type AccessRecentChangeView = z.infer<typeof accessRecentChangeSchema>
export type AccessExplainDetail = z.infer<typeof accessExplainDetailSchema>
export type AccessExplainResponse = z.infer<typeof accessExplainResponseSchema>

export const XRAY_RETENTION_DAYS_MIN = 7
export const XRAY_RETENTION_DAYS_MAX = 3650
export const XRAY_K_ANONYMITY_FLOOR = 5
export const XRAY_STEP_MAP_MAX_ENTRIES = 500
export { XRAY_SUGGESTION_MIN_SUPPORT_FLOOR }
export const XRAY_SUGGESTION_MIN_SUPPORT_MAX = 100000

const xrayActivityStepMapSchema = z
  .record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(200))
  .refine((value) => Object.keys(value).length <= XRAY_STEP_MAP_MAX_ENTRIES, {
    message: `At most ${XRAY_STEP_MAP_MAX_ENTRIES} activity mappings are allowed`,
  })

export const xrayTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => canonicalIanaTimeZone(value) !== null, { message: 'Unknown IANA time zone' })

export const xraySettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Projects this organization\'s audited changes into Process X-Ray (default true).'),
    retentionDays: z.number().int().min(XRAY_RETENTION_DAYS_MIN).max(XRAY_RETENTION_DAYS_MAX).optional().describe('Days a case is kept after its last activity (default 365).'),
    kAnonymity: z.number().int().min(XRAY_K_ANONYMITY_FLOOR).max(1000).optional().describe('Minimum number of cases per reported cell (default 10, minimum 5).'),
    debounceSeconds: z.number().int().min(0).max(86400).optional().describe('Window in which a change and its correction collapse into one step at query time (default 120).'),
    individualsEnabled: z.boolean().optional().describe('Allows per-person breakdowns for users with `insights.xray.view_individuals` (default false).'),
    timeZone: xrayTimeZoneSchema.optional().describe('IANA time zone of the default 7/30/90-day windows and their precomputed rollups (default `UTC`); stored in its canonical spelling.'),
    suggestionMinSupport: z.number().int().min(XRAY_SUGGESTION_MIN_SUPPORT_FLOOR).max(XRAY_SUGGESTION_MIN_SUPPORT_MAX).nullable().optional().describe('Overrides the support threshold of automation suggestions for this organization (default `null` = 20 supporting trigger occurrences in 30 days, minimum 5).'),
    conformanceWorkflowId: z.string().uuid().nullable().optional().describe('Workflow definition the process is compared against.'),
    activityStepMap: xrayActivityStepMapSchema.nullable().optional().describe('Maps activity keys to workflow step ids for conformance.'),
  })
  .strict()

export type XraySettingsUpdateInput = z.infer<typeof xraySettingsUpdateSchema>

export const xraySettingsSaveSchema = xraySettingsUpdateSchema.extend({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type XraySettingsSaveInput = z.infer<typeof xraySettingsSaveSchema>

export const xraySettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int(),
  kAnonymity: z.number().int(),
  debounceSeconds: z.number().int(),
  individualsEnabled: z.boolean(),
  timeZone: z.string(),
  suggestionMinSupport: z.number().int().nullable().describe('Support threshold override of automation suggestions; null = the platform default (20).'),
  conformanceWorkflowId: z.string().uuid().nullable(),
  activityStepMap: z.record(z.string(), z.string()).nullable(),
  updatedAt: z.string().nullable().describe('Version token for optimistic locking; null until the settings are first saved.'),
})

export const xraySettingsResponseSchema = z.object({
  ok: z.literal(true),
  result: xraySettingsSchema,
})

export const xrayErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export const xrayBackfillRequestSchema = z.object({}).strict()

export const xrayBackfillResponseSchema = z.object({
  ok: z.literal(true),
  progressJobId: z.string().uuid().nullable(),
  scanId: z.string().uuid(),
  scheduleRegistered: z.boolean().describe('Whether the system ingest tick (one scheduler schedule for every organization) is registered; false when the scheduler module is absent or the registration failed.'),
})

const xrayScanSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['backfill', 'reconcile', 'full_reconcile']),
  processKeys: z.array(z.string()).nullable().describe('Processes a per-process rebuild scan is limited to; null when the scan covers every process.'),
  from: z.string().nullable(),
  until: z.string().nullable(),
  position: z.string().nullable(),
  processed: z.number().int(),
  progressJobId: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const xrayContractChangeSchema = z.object({
  at: z.string().nullable(),
  changed: z.array(z.string()),
  added: z.array(z.string()),
  removed: z.array(z.string()).describe('Processes no longer registered (module disabled): their rows stay until retention prunes them and are not shown.'),
})

export const xrayStatusResponseSchema = z.object({
  organizationId: z.string().uuid(),
  ingestEnabled: z.boolean().describe('False when the `insights_xray_ingest` feature toggle is off.'),
  settings: xraySettingsSchema,
  registry: z.object({
    ready: z.boolean(),
    contractHash: z.string(),
    processes: z.array(z.object({ processKey: z.string(), labelKey: z.string(), moduleId: z.string() })).describe('Registered processes whose required features the caller holds in the organization.'),
    rejected: z.number().int().describe('Declarations rejected at boot (see the server log).'),
  }),
  cursor: z
    .object({
      status: z.enum(['idle', 'backfilling']),
      contractMatches: z.boolean().describe('Every registered process is projected under a recorded contract and no per-process rebuild is queued or running.'),
      rebuildingProcessKeys: z.array(z.string()).describe('Processes whose rows were cleared after a contract change (declaration, derivation or tenant encryption map) and are being re-projected.'),
      contractChange: xrayContractChangeSchema.nullable().describe('The last per-process contract transition.'),
      computedThrough: z.string().nullable().describe('Audit rows up to this time are projected (the incremental position).'),
      coverageFrom: z.string().nullable().describe('Audit rows from this time on are projected; earlier history is missing until a backfill or the weekly full reconciliation covers it (never earlier than the retention window).'),
      historyScanned: z.boolean().describe('Whether a backfill or full reconciliation of every process has completed since the cursor was created or reset.'),
      historyScannedAt: z.string().nullable(),
      stateWatermark: z.string().nullable(),
      scan: xrayScanSchema.nullable(),
      lastReconciledAt: z.string().nullable(),
      lastFullReconciledAt: z.string().nullable(),
      lastPrunedAt: z.string().nullable(),
      lastRunAt: z.string().nullable(),
      lastError: z.string().nullable(),
      undecryptableRows: z.number().int().describe('Audit rows the incremental pass skipped because their encrypted columns are sealed under another key than the tenant key in use (each row counted once).'),
      overlapTimeouts: z.number().int().describe('Overlap re-reads (late-committed rows) that ended on their statement timeout; the nightly reconciliation covers them.'),
      lastOverlapTimeoutAt: z.string().nullable(),
      leaseActive: z.boolean(),
    })
    .nullable(),
  processes: z.array(z.object({
    processKey: z.string(),
    n: z.number().int().nullable().describe('Projected, non-voided events (null when the counts timed out).'),
    voidedEvents: z.number().int().nullable(),
    cases: z.number().int().nullable(),
    openCases: z.number().int().nullable(),
    firstOccurredAt: z.string().nullable().describe('Earliest projected activity of the process.'),
    lastOccurredAt: z.string().nullable(),
  })).describe('Registered processes whose required features the caller holds in the organization.'),
  countsTimedOut: z.boolean().describe('True when the per-process counts exceeded their time limit; the counts are then null.'),
  computedThrough: z.string().nullable(),
  coverageFrom: z.string().nullable(),
})

export type XrayStatusResponse = z.infer<typeof xrayStatusResponseSchema>

export const XRAY_ANALYTICS_PAGE_SIZE_MAX = 100
export const XRAY_ANALYTICS_PAGE_SIZE_DEFAULT = 50
export const XRAY_VARIANTS_LIMIT_MAX = 100
export const XRAY_VARIANTS_LIMIT_DEFAULT = 20
export const XRAY_BREAKDOWN_GROUP_VALUES = ['org', 'role', 'team', 'user'] as const
export const XRAY_CASE_STATUS_VALUES = ['open', 'completed', 'deleted'] as const

const XRAY_CSV_MAX_LENGTH = 4000

const xrayWindowFields = {
  window: z.enum(['7d', '30d', '90d']).optional().describe('Default window (calendar days in the time zone, today included); `30d` when neither `window` nor `from`/`to` is given.'),
  from: z.string().max(64).optional().describe('Start of a custom window (ISO 8601 date-time); requires `to`. At most 180 days; longer windows answer 422 `window_too_large`.'),
  to: z.string().max(64).optional().describe('End (exclusive) of a custom window (ISO 8601 date-time); requires `from`.'),
  timeZone: z.string().max(64).optional().describe('IANA time zone of the window; defaults to the organizations\' configured X-Ray time zone (UTC when they differ).'),
}

const xrayFilterFields = {
  causeKinds: z.string().max(XRAY_CSV_MAX_LENGTH).optional().describe('Comma-separated cause kinds (`user`, `workflow`, `legacy`, …).'),
  actorRoleIds: z.string().max(XRAY_CSV_MAX_LENGTH).optional().describe('Comma-separated role ids; refused with 422 `filter_too_narrow` when a value or the filtered population covers fewer than k cases or three actors.'),
  actorTeamIds: z.string().max(XRAY_CSV_MAX_LENGTH).optional().describe('Comma-separated team ids (same rule as `actorRoleIds`).'),
  includeSyncRun: z.string().max(8).optional().describe('`true` includes `sync_run` steps in duration statistics.'),
}

function windowSelectionIssue(value: { window?: string; from?: string; to?: string }, ctx: z.RefinementCtx): void {
  const custom = value.from !== undefined || value.to !== undefined
  if (custom && (value.from === undefined || value.to === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'from and to must be given together', path: [value.from === undefined ? 'from' : 'to'] })
  }
  if (custom && value.window !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'window cannot be combined with from/to', path: ['window'] })
  }
}

export const xrayProcessesQuerySchema = z.object(xrayWindowFields).superRefine(windowSelectionIssue)

export const xrayAnalyticsQuerySchema = z.object({ ...xrayWindowFields, ...xrayFilterFields }).superRefine(windowSelectionIssue)

export type XrayAnalyticsQuery = z.infer<typeof xrayAnalyticsQuerySchema>

export const xrayVariantsQuerySchema = z
  .object({
    ...xrayWindowFields,
    ...xrayFilterFields,
    limit: z.coerce.number().int().min(1).max(XRAY_VARIANTS_LIMIT_MAX).optional().describe(`Most frequent variants returned (default ${XRAY_VARIANTS_LIMIT_DEFAULT}, at most ${XRAY_VARIANTS_LIMIT_MAX}).`),
  })
  .superRefine(windowSelectionIssue)

export const xrayBreakdownQuerySchema = z
  .object({
    ...xrayWindowFields,
    ...xrayFilterFields,
    groupBy: z.enum(XRAY_BREAKDOWN_GROUP_VALUES).optional().describe('`org` (default), `role`, `team`, or `user` (requires `insights.xray.view_individuals` and the organization setting `individualsEnabled`; every read writes an access log row first).'),
  })
  .superRefine(windowSelectionIssue)

export const xrayConformanceQuerySchema = z
  .object({
    ...xrayWindowFields,
    ...xrayFilterFields,
    sequence: z.string().max(XRAY_CSV_MAX_LENGTH).optional().describe('Comma-separated expected activity keys (an ad-hoc designed sequence). Without it, each organization\'s configured conformance workflow (`conformanceWorkflowId` + `activityStepMap`) is used.'),
  })
  .superRefine(windowSelectionIssue)

export const xrayCasesQuerySchema = z
  .object({
    ...xrayWindowFields,
    ...xrayFilterFields,
    pageSize: z.coerce.number().int().min(1).max(XRAY_ANALYTICS_PAGE_SIZE_MAX).optional().describe(`Page size (default ${XRAY_ANALYTICS_PAGE_SIZE_DEFAULT}, at most ${XRAY_ANALYTICS_PAGE_SIZE_MAX}).`),
    cursor: z.string().min(1).max(400).optional().describe('`nextCursor` of the previous page.'),
    status: z.string().max(100).optional().describe('Comma-separated case statuses (`open`, `completed`, `deleted`).'),
    variantHash: z.string().regex(/^[0-9a-f]{64}$/).optional().describe('A stored variant hash (`rawVariantHashes` of a variant): cases completed in the window with that variant.'),
    variantHashes: z.string().max(XRAY_CSV_MAX_LENGTH).optional().describe(`Comma-separated stored variant hashes (at most ${XRAY_ANALYTICS_LIMITS.maxRawVariantHashes}, e.g. every \`rawVariantHashes\` of one variant): cases completed in the window with any of them; combined with \`variantHash\`. Every hash must belong to a variant the variants report shows.`),
    activityKey: z.string().min(1).max(200).optional().describe('Cases with this activity in the window.'),
  })
  .superRefine(windowSelectionIssue)

const XRAY_WORKFLOW_INPUT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export const xrayWorkflowDraftRequestSchema = z
  .object({
    ...xrayWindowFields,
    commandId: z.string().trim().min(1).max(200).describe('Workflow-safe UPDATE_ENTITY command that updates the case root (e.g. `customers.deals.update`); the caller must hold its features.'),
    recordIdInputKey: z.string().regex(XRAY_WORKFLOW_INPUT_KEY_PATTERN).optional().describe('Command input key receiving `{{context.recordId}}` (default `id`).'),
    inputKeys: z
      .record(z.string().regex(XRAY_WORKFLOW_INPUT_KEY_PATTERN), z.string().regex(XRAY_WORKFLOW_INPUT_KEY_PATTERN))
      .refine((value) => Object.keys(value).length <= 50, { message: 'At most 50 input key mappings are allowed' })
      .optional()
      .describe('Stage field key → command input key (default: the field key).'),
    workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/).optional().describe('Workflow id of the draft (default derived from the process and the variant).'),
    workflowName: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .superRefine(windowSelectionIssue)

export type XrayWorkflowDraftRequest = z.infer<typeof xrayWorkflowDraftRequestSchema>

export const xrayProcessPathParamsSchema = z.object({
  processKey: z.string().regex(PROCESS_KEY_PATTERN).describe('Registered process key, e.g. `customers.deal`.'),
})

export const xrayVariantPathParamsSchema = xrayProcessPathParamsSchema.extend({
  hash: z.string().regex(/^[0-9a-f]{64}$/).describe('`variantHash` of an item of the variants listing.'),
})

export const xrayAnalyticsErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  hint: z.string().nullable().optional().describe('What to do instead, e.g. `run_background_analysis` (window or event budget too large) or `widen_actor_filter`.'),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
})

const xrayProcessSummaryItemSchema = processSummaryResultSchema.extend({
  labelKey: z.string(),
  moduleId: z.string(),
  resourceKind: z.string(),
})

export const xrayProcessesResponseSchema = z.object({
  items: z.array(xrayProcessSummaryItemSchema).describe('Registered processes whose `insights.xray.view` and declared `requiredFeatures` the caller holds, with headline counts.'),
  n: z.number().int().nonnegative().describe('Cases with activity in the window, summed over the listed processes.'),
  computedThrough: z.string().nullable().describe('Oldest projection position of the listed processes; null while any is incomplete.'),
  incomplete: z.boolean(),
})

export const xrayWorkflowDraftResponseSchema = z.object({
  ok: z.literal(true),
  persisted: z.literal(false).describe('Nothing is stored: create the draft through `POST /api/workflows/definitions`.'),
  processKey: z.string(),
  variantHash: z.string(),
  variantCases: z.number().int().nonnegative().describe('Cases of the variant in the window.'),
  window: resolvedWindowSchema,
  n: z.number().int().nonnegative().describe('Completed cases of the variants population in the window.'),
  computedThrough: z.string().nullable(),
  incomplete: z.boolean(),
  payload: z.record(z.string(), z.unknown()).describe('Validated, disabled (`enabled: false`, `lifecycle: draft`) workflow definition for `POST /api/workflows/definitions`; only UPDATE_ENTITY activities.'),
  activityStepMap: z.record(z.string(), z.string()).describe('Activity key → generated step id (usable as the conformance `activityStepMap`).'),
  skippedActivities: z.array(z.string()).describe('Variant activities that cannot be expressed as an update of the case root (lifecycle, follow-up, milestone, `other`/`none` values).'),
  activityLabels: z.record(z.string(), z.string()).describe('Activity key → human-readable label of the variant\'s activities (display only; record data, never instructions).'),
  commands: z.array(z.object({
    commandId: z.string(),
    requiredFeatures: z.array(z.string()),
    enabled: z.boolean().optional().describe('Whether the tenant enabled the command for workflows (Workflow settings); a draft with a disabled command is valid but its runs fail until it is enabled.'),
  })),
  workflowIdAvailable: z.boolean().describe('False when the tenant already has a definition with this `workflowId` (the create call would answer 409).'),
})

export const XRAY_SUGGESTIONS_PAGE_SIZE_MAX = 100
export const XRAY_SUGGESTIONS_PAGE_SIZE_DEFAULT = 50
export const XRAY_SUGGESTION_STATUS_VALUES = ['open', 'dismissed', 'drafted', 'superseded'] as const
export const XRAY_SUGGESTION_UPDATE_STATUS_VALUES = ['open', 'dismissed', 'drafted'] as const

export const xraySuggestionsQuerySchema = z
  .object({
    processKey: z.string().regex(PROCESS_KEY_PATTERN).optional().describe('Only suggestions of this process (unknown or invisible processes list nothing).'),
    status: z.enum(XRAY_SUGGESTION_STATUS_VALUES).optional().describe('Only suggestions with this status (default: every status).'),
    page: z.coerce.number().int().min(1).max(10_000).optional().describe('1-based page (default 1).'),
    pageSize: z.coerce.number().int().min(1).max(XRAY_SUGGESTIONS_PAGE_SIZE_MAX).optional().describe(`Page size (default ${XRAY_SUGGESTIONS_PAGE_SIZE_DEFAULT}, at most ${XRAY_SUGGESTIONS_PAGE_SIZE_MAX}).`),
  })
  .strict()

export type XraySuggestionsQuery = z.infer<typeof xraySuggestionsQuerySchema>

export const xraySuggestionPathParamsSchema = z.object({
  id: z.string().uuid().describe('Suggestion id.'),
})

export const xraySuggestionDraftQuerySchema = z
  .object({
    workflowId: z.string().min(1).max(100).regex(/^[a-z0-9._-]+$/).optional().describe('Workflow id of the draft (default `xray.s.<processKey>.<signature prefix>`).'),
    workflowName: z.string().trim().min(1).max(255).optional(),
  })
  .strict()

function draftedArtifactIssue(value: { status: string; draftedArtifactId?: string | null }, ctx: z.RefinementCtx): void {
  if (value.status === 'drafted' && !value.draftedArtifactId) {
    ctx.addIssue({ code: 'custom', message: 'draftedArtifactId is required when the status is drafted', path: ['draftedArtifactId'] })
  }
  if (value.status !== 'drafted' && value.draftedArtifactId) {
    ctx.addIssue({ code: 'custom', message: 'draftedArtifactId is only accepted with the drafted status', path: ['draftedArtifactId'] })
  }
}

const xraySuggestionUpdateFields = {
  status: z.enum(XRAY_SUGGESTION_UPDATE_STATUS_VALUES).describe('`dismissed`, `drafted` (with `draftedArtifactId`) or `open` (reopen). A superseded suggestion cannot be changed.'),
  draftedArtifactId: z.string().uuid().nullable().optional().describe('The workflow definition created from the draft; must belong to the suggestion\'s tenant and organization.'),
}

export const xraySuggestionUpdateSchema = z.object(xraySuggestionUpdateFields).strict().superRefine(draftedArtifactIssue)

export type XraySuggestionUpdateInput = z.infer<typeof xraySuggestionUpdateSchema>

export const xraySuggestionUpdateCommandSchema = z
  .object({
    ...xraySuggestionUpdateFields,
    tenantId: z.string().uuid(),
    organizationId: z.string().uuid(),
    id: z.string().uuid(),
  })
  .strict()
  .superRefine(draftedArtifactIssue)

export type XraySuggestionUpdateCommandInput = z.infer<typeof xraySuggestionUpdateCommandSchema>

export const xraySuggestionMineRequestSchema = z.object({}).strict()

export const xraySuggestionSchema = z.object({
  id: z.string().uuid(),
  processKey: z.string(),
  processLabelKey: z.string(),
  organizationId: z.string().uuid(),
  status: z.enum(XRAY_SUGGESTION_STATUS_VALUES),
  trigger: z.object({
    activityKey: z.string(),
    activityKind: z.string(),
    field: z.string().nullable(),
    value: z.string().nullable(),
    eventId: z.string().nullable().describe('Workflow trigger event when the trigger is expressible (only the creation of the case root is).'),
  }),
  condition: z.object({ field: z.string(), value: z.string() }).nullable().describe('Optional low-cardinality condition: a root field\'s value right after the trigger.'),
  followups: z.array(z.object({
    field: z.string(),
    value: z.string(),
    activityKind: z.string(),
    commandId: z.string().nullable(),
  })).describe('The manual follow-up field change(s) (one per suggestion).'),
  windowSeconds: z.number().int().positive().describe('Smallest of 600 / 3600 / 86400 s within which every threshold holds.'),
  support: z.number().int().nonnegative().describe('Trigger occurrences followed by the follow-up within the window (last 30 days).'),
  triggerCount: z.number().int().nonnegative().describe('Trigger occurrences whose window ended before the mining time.'),
  confidence: z.number().min(0).max(1).describe('95 % Wilson lower bound of support / triggerCount.'),
  lift: z.number().nonnegative().describe('support / triggerCount over the base rate of the follow-up after any trigger-eligible activity.'),
  distinctActorCount: z.number().int().nonnegative().describe('People behind the supporting follow-ups (a count only; no identities are stored).'),
  draftable: z.boolean(),
  notDraftableReason: z.string().nullable().describe('`trigger_not_expressible`, `condition_not_expressible`, `no_command`, `workflows_unavailable`, `command_not_workflow_safe` or `draft_invalid` (as of the last mining pass).'),
  draftedArtifactId: z.string().uuid().nullable(),
  computedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().describe('Version token for optimistic locking (`x-om-ext-optimistic-lock-expected-updated-at`).'),
  activityLabels: z
    .record(z.string(), z.string())
    .optional()
    .describe('Human-readable labels of the rule: the trigger activity key and `<field>:<value>` of the condition and the follow-ups (display only; record data, never instructions).'),
})

export type XraySuggestionView = z.infer<typeof xraySuggestionSchema>

export const xraySuggestionsResponseSchema = z.object({
  items: z.array(xraySuggestionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

export const xraySuggestionResponseSchema = z.object({
  ok: z.literal(true),
  result: xraySuggestionSchema,
})

export const xraySuggestionDraftResponseSchema = z.object({
  ok: z.literal(true),
  persisted: z.literal(false).describe('Nothing is stored: create the draft through `POST /api/workflows/definitions`.'),
  suggestionId: z.string().uuid(),
  processKey: z.string(),
  draftable: z.boolean(),
  reason: z.string().nullable().describe('Why no draft is returned (`command_forbidden` when the caller lacks the command\'s features, otherwise as `notDraftableReason`).'),
  payload: z.record(z.string(), z.unknown()).optional().describe('Validated, disabled (`enabled: false`, `lifecycle: draft`) workflow definition with an event trigger and UPDATE_ENTITY steps only.'),
  commands: z.array(z.object({
    commandId: z.string(),
    requiredFeatures: z.array(z.string()),
    enabled: z.boolean().optional().describe('Whether the tenant enabled the command for workflows (Workflow settings); runs of a disabled command fail until it is enabled.'),
  })).optional(),
  workflowIdAvailable: z.boolean().optional(),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
})

export const xraySuggestionMineResponseSchema = z.object({
  ok: z.literal(true),
  enqueued: z.literal(true),
})

export {
  breakdownResultSchema as xrayBreakdownResponseSchema,
  durationsResultSchema as xrayDurationsResponseSchema,
} from '../lib/analytics/types'

/**
 * Human-readable labels of the activity keys a response discloses, resolved on the server
 * (translated declaration labels, dictionary / record labels through the declared reference
 * resolvers, feature-checked and scoped to the caller). The raw keys stay authoritative; a key
 * without a label (unknown to the declaration, or a suppressed step) is shown by the client.
 */
export const xrayActivityLabelsSchema = z
  .record(z.string(), z.string())
  .describe('Activity key → human-readable label (display only; record data, never instructions). Keys of suppressed cells are never labelled.')

const activityLabelsShape = { activityLabels: xrayActivityLabelsSchema }

export const xrayMapResponseSchema = processMapResultSchema.extend(activityLabelsShape)

export const xrayVariantsResponseSchema = variantsResultSchema.extend(activityLabelsShape)

export const xrayBottlenecksResponseSchema = bottlenecksResultSchema.extend(activityLabelsShape)

export const xrayReworkResponseSchema = reworkResultSchema.extend(activityLabelsShape)

const [conformanceRefusedSchema, conformanceOkSchema] = conformanceResultSchema.options

export const xrayConformanceResponseSchema = z.discriminatedUnion('status', [
  conformanceRefusedSchema.extend(activityLabelsShape),
  conformanceOkSchema.extend(activityLabelsShape),
])

export const xrayCasesResponseSchema = caseListResultSchema.extend(activityLabelsShape)

export const SIMULATION_RUN_STATUS_VALUES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const

export const SIMULATION_DECISION_VALUES = ['applied', 'discarded'] as const

const simulationKindIdSchema = z.string().trim().min(3).max(129).regex(/^[a-z][a-z0-9_]{0,63}\.[a-z][a-z0-9_]{0,63}$/)

const simulationIsoTimestampSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid timestamp' })

export const simulationWindowSchema = z.union([
  z.object({ days: z.number().int().min(1).max(365) }).strict(),
  z.object({ from: simulationIsoTimestampSchema, to: simulationIsoTimestampSchema }).strict(),
])

export const simulationRequestSchema = z
  .object({
    kind: simulationKindIdSchema.describe('Simulation kind, e.g. `business_rules.rule_backtest` (see `GET /api/insights/simulations/capabilities`).'),
    artifactId: z.string().trim().min(1).max(200).nullable().optional().describe('Id of the artifact the proposal changes; null/absent for an unsaved artifact (apply = create).'),
    proposal: z.unknown().describe('The proposed artifact definition, validated by the owning module (rule backtest: the full business rule definition).'),
    window: simulationWindowSchema.optional().describe('History window: `{ days }` ending now (default 90, max 365) or an absolute `{ from, to }` of at most 365 days.'),
  })
  .strict()

export type SimulationRequestBody = z.infer<typeof simulationRequestSchema>

export const simulationRequestCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: simulationKindIdSchema,
  artifactId: z.string().trim().min(1).max(200).nullable(),
  proposal: z.unknown(),
  windowFrom: simulationIsoTimestampSchema,
  windowTo: simulationIsoTimestampSchema,
})

export type SimulationRequestCommandInput = z.infer<typeof simulationRequestCommandSchema>

export const simulationRunPathParamsSchema = z.object({
  id: z.string().uuid(),
})

export const simulationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const simulationCancelCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  runId: z.string().uuid(),
  userId: z.string().uuid(),
  allowForeign: z.boolean(),
})

export type SimulationCancelCommandInput = z.infer<typeof simulationCancelCommandSchema>

export const simulationDecisionSchema = z.object({
  decision: z.enum(SIMULATION_DECISION_VALUES),
}).strict()

export const simulationDecisionCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  runId: z.string().uuid(),
  userId: z.string().uuid(),
  decision: z.enum(SIMULATION_DECISION_VALUES),
})

export type SimulationDecisionCommandInput = z.infer<typeof simulationDecisionCommandSchema>

export const simulationErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

const simulationSampleSchema = z.object({
  id: z.string(),
  href: z.string().nullable(),
})

const simulationResultCellSchema = z.object({
  key: z.string(),
  count: z.number().int().nullable().describe('Null when suppressed.'),
  suppressed: z.enum(['below_k', 'complementary']).nullable().describe('`below_k`: fewer than k records; `complementary`: hidden so a suppressed cell cannot be derived from the total.'),
  samples: z.array(simulationSampleSchema).describe('Sample record ids still visible to the caller (resolved live).'),
})

const simulationResultGroupSchema = z.object({
  key: z.string(),
  labelKey: z.string().nullable(),
  sampleResourceKind: z.string().nullable(),
  total: z.number().int().nullable(),
  suppressed: z.boolean(),
  cells: z.array(simulationResultCellSchema),
  warnings: z.array(z.string()).describe('i18n keys'),
  flags: z.array(z.string()),
})

export const simulationRunSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  kindLabelKey: z.string().nullable(),
  status: z.enum(SIMULATION_RUN_STATUS_VALUES),
  artifactKind: z.string(),
  artifactId: z.string().nullable(),
  progressJobId: z.string().uuid().nullable(),
  fidelity: z.string().nullable(),
  errorCode: z.string().nullable(),
  windowFrom: z.string(),
  windowTo: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  expiresAt: z.string(),
})

export const simulationDecisionViewSchema = z.object({
  decision: z.enum(SIMULATION_DECISION_VALUES),
  verified: z.boolean().nullable(),
  artifactId: z.string().nullable(),
  artifactUpdatedAtAfter: z.string().nullable(),
  createdAt: z.string(),
})

export const SIMULATION_EXECUTION_VALUES = ['queued', 'inline'] as const

const simulationResultSummarySchema = z.object({
  warnings: z.array(z.string()).describe('i18n keys shown prominently (e.g. a self-lockout warning)'),
  counts: z.record(z.string(), z.number().int()).describe('Kind-level counts that are not record counts (e.g. `pages_lost`)'),
  lists: z.record(z.string(), z.array(z.string())).describe('Catalog identifiers (e.g. feature ids) — never record values'),
})

export const simulationRunDetailSchema = simulationRunSummarySchema.extend({
  execution: z.enum(SIMULATION_EXECUTION_VALUES).describe('`inline` runs were computed at request time from the live configuration (no history window).'),
  hasLiveRecords: z.boolean().describe('Whether `GET …/{id}/records` lists the records this completed run concerns.'),
  cellKeys: z.array(z.string()),
  proposal: z.unknown().describe('The caller\'s own proposal.'),
  result: z.object({
    k: z.number().int(),
    truncated: z.boolean(),
    groups: z.array(simulationResultGroupSchema),
    summary: simulationResultSummarySchema.nullable(),
  }).nullable(),
  coverage: z.record(z.string(), z.number()).nullable(),
  caveats: z.array(z.string()).describe('i18n keys'),
  budgets: z.object({
    maxRecords: z.number(),
    maxDurationMs: z.number(),
    recordsUsed: z.number().nullable().describe('Null when any group or cell of the result is suppressed (it could reveal a suppressed count).'),
    elapsedMs: z.number(),
  }),
  decisions: z.array(simulationDecisionViewSchema),
  applyHref: z.string().nullable(),
  canDecide: z.boolean(),
})

export const simulationRunResponseSchema = z.object({
  ok: z.literal(true),
  result: simulationRunDetailSchema,
})

export const simulationListResponseSchema = z.object({
  items: z.array(simulationRunSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

export const simulationRequestResponseSchema = z.object({
  ok: z.literal(true),
  runId: z.string().uuid(),
  progressJobId: z.string().uuid().nullable(),
  status: z.enum(SIMULATION_RUN_STATUS_VALUES),
  deduplicated: z.boolean(),
})

export const simulationCapabilitiesResponseSchema = z.object({
  canRun: z.boolean(),
  kinds: z.array(z.object({
    kind: z.string(),
    artifactKind: z.string(),
    labelKey: z.string(),
    cellKeys: z.array(z.string()),
    execution: z.enum(SIMULATION_EXECUTION_VALUES),
  })),
  limits: z.object({
    defaultWindowDays: z.number().int(),
    maxWindowDays: z.number().int(),
    maxRecords: z.number().int(),
    maxDurationMs: z.number().int(),
  }),
})

export const simulationDecisionResponseSchema = z.object({
  ok: z.literal(true),
  decision: simulationDecisionViewSchema,
})

export const simulationRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

const simulationLiveRecordSchema = z.object({
  id: z.string(),
  type: z.string().describe('Kind-defined record type, e.g. `user` or `api_key`'),
  label: z.string().nullable(),
  href: z.string().nullable(),
  groupKeys: z.array(z.string()),
  counts: z.record(z.string(), z.number().int()),
})

export const simulationRecordsResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(simulationLiveRecordSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
  notes: z.array(z.string()).describe('i18n keys'),
  groupLabels: z.record(z.string(), z.string()).describe('Display names of result groups, resolved live'),
})

export const simulationCancelResponseSchema = z.object({
  ok: z.literal(true),
  runId: z.string().uuid(),
  status: z.enum(SIMULATION_RUN_STATUS_VALUES),
})
