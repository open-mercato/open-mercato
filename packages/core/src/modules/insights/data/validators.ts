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

const xrayActivityStepMapSchema = z
  .record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(200))
  .refine((value) => Object.keys(value).length <= XRAY_STEP_MAP_MAX_ENTRIES, {
    message: `At most ${XRAY_STEP_MAP_MAX_ENTRIES} activity mappings are allowed`,
  })

export const xraySettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional().describe('Projects this organization\'s audited changes into Process X-Ray (default true).'),
    retentionDays: z.number().int().min(XRAY_RETENTION_DAYS_MIN).max(XRAY_RETENTION_DAYS_MAX).optional().describe('Days a case is kept after its last activity (default 365).'),
    kAnonymity: z.number().int().min(XRAY_K_ANONYMITY_FLOOR).max(1000).optional().describe('Minimum number of cases per reported cell (default 10, minimum 5).'),
    debounceSeconds: z.number().int().min(0).max(86400).optional().describe('Window in which a change and its correction collapse into one step at query time (default 120).'),
    individualsEnabled: z.boolean().optional().describe('Allows per-person breakdowns for users with `insights.xray.view_individuals` (default false).'),
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
  scheduleRegistered: z.boolean().describe('Whether the per-organization ingest schedule is registered (false when the scheduler module is absent).'),
})

const xrayScanSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['backfill', 'reconcile', 'full_reconcile']),
  from: z.string().nullable(),
  until: z.string().nullable(),
  position: z.string().nullable(),
  processed: z.number().int(),
  progressJobId: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const xrayStatusResponseSchema = z.object({
  organizationId: z.string().uuid(),
  ingestEnabled: z.boolean().describe('False when the `insights_xray_ingest` feature toggle is off.'),
  settings: xraySettingsSchema,
  registry: z.object({
    ready: z.boolean(),
    contractHash: z.string(),
    processes: z.array(z.object({ processKey: z.string(), labelKey: z.string(), moduleId: z.string() })),
    rejected: z.number().int().describe('Declarations rejected at boot (see the server log).'),
  }),
  cursor: z
    .object({
      status: z.enum(['idle', 'backfilling', 'rebuild_required']),
      contractMatches: z.boolean(),
      computedThrough: z.string().nullable().describe('Audit rows up to this time are projected.'),
      stateWatermark: z.string().nullable(),
      scan: xrayScanSchema.nullable(),
      lastReconciledAt: z.string().nullable(),
      lastFullReconciledAt: z.string().nullable(),
      lastPrunedAt: z.string().nullable(),
      lastRunAt: z.string().nullable(),
      lastError: z.string().nullable(),
      leaseActive: z.boolean(),
    })
    .nullable(),
  processes: z.array(z.object({
    processKey: z.string(),
    n: z.number().int().describe('Projected, non-voided events.'),
    voidedEvents: z.number().int(),
    cases: z.number().int(),
    openCases: z.number().int(),
    lastOccurredAt: z.string().nullable(),
  })),
  computedThrough: z.string().nullable(),
})

export type XrayStatusResponse = z.infer<typeof xrayStatusResponseSchema>
