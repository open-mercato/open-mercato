import type { EntityManager } from '@mikro-orm/postgresql'
import type { CausationEnvelope, CauseKind } from '../../lib/causation/types'

export const EXPLAIN_CONFIG_VERSION = 1 as const

export const EXPLAIN_VERDICTS = ['explained', 'partially_explained', 'unexplained', 'no_history', 'pending'] as const

export type ExplainVerdict = (typeof EXPLAIN_VERDICTS)[number]

export const EXPLAIN_CONFIDENCES = ['proven', 'inferred', 'unknown'] as const

export const EXPLAIN_GAP_REASONS = ['unlogged_change', 'current_differs', 'missing_snapshot'] as const

export type ExplainGapReason = (typeof EXPLAIN_GAP_REASONS)[number]

export const EXPLAIN_VALUE_KINDS = [
  'text',
  'number',
  'decimal',
  'money',
  'boolean',
  'date',
  'datetime',
  'enum',
  'dictionary',
  'user',
  'reference',
  'json',
  'custom_field',
] as const

export type ExplainValueKind = (typeof EXPLAIN_VALUE_KINDS)[number]

export type ExplainConfidence = (typeof EXPLAIN_CONFIDENCES)[number]

export type ExplainScope = {
  tenantId: string
  organizationIds: string[] | null
}

export type ExplainResolveService = <TService>(name: string) => TService | undefined

export type ExplainLoadContext = {
  em: EntityManager
  resolve: ExplainResolveService
  scope: ExplainScope
  userId: string | null
  locale: string | null
}

export type ExplainUnloggedWriter = {
  id: string
  labelKey: string
}

export type ExplainFieldDescriptor = {
  key: string
  labelKey: string
  valueKind: ExplainValueKind
  snapshotPaths: string[]
  changeKeys?: string[]
  currentPath?: string
  requiredFeatures?: string[]
  derived?: { dependsOn: string[] }
  provider?: string
  referenceKind?: string
  unloggedWriters?: ExplainUnloggedWriter[]
}

export type ExplainCustomFieldsDescriptor = {
  entityId: string
  snapshotContainers?: string[]
  allowKeys?: string[]
  requiredFeatures?: string[]
}

export type ExplainCollectionDescriptor = {
  key: string
  labelKey: string
  snapshotPath: string
  itemIdPath: string
  currentPath?: string
  requiredFeatures?: string[]
  itemResourceKinds?: string[]
  fields: ExplainFieldDescriptor[]
}

export type ExplainResourceDescriptor = {
  resourceKind: string
  logResourceKinds?: string[]
  labelKey: string
  formEntityIds?: string[]
  requiredFeatures: string[]
  loadCurrent: (ctx: ExplainLoadContext, id: string) => Promise<Record<string, unknown> | null>
  fields: ExplainFieldDescriptor[]
  customFields?: ExplainCustomFieldsDescriptor
  collections?: ExplainCollectionDescriptor[]
  noHistory?: { reasonKey: string }
  recordHref?: (id: string) => string | null
  listRecordIds?: (ctx: ExplainLoadContext, options: { limit: number; afterId: string | null }) => Promise<string[]>
}

export type ExplainCauseDetail = {
  kind: CauseKind
  id: string
  label: string | null
  labelKey?: string | null
  href: string | null
  organizationId: string | null
}

export type ExplainCauseResolver = {
  kind: CauseKind
  requiredFeatures: string[]
  resolve: (ctx: ExplainLoadContext, ids: string[]) => Promise<ExplainCauseDetail[]>
}

export type ExplainReferenceDetail = {
  kind: string
  id: string
  label: string | null
  href: string | null
  organizationId: string | null
  facts?: Record<string, string | number | boolean | null>
}

export type ExplainReferenceResolver = {
  kind: string
  requiredFeatures: string[]
  resolve: (ctx: ExplainLoadContext, ids: string[]) => Promise<ExplainReferenceDetail[]>
}

export type ExplainHistoryEntry = {
  logId: string
  at: string
  commandId: string | null
  actionType: string | null
  executionState: string | null
  actorUserId: string | null
  resourceKind: string | null
  resourceId: string | null
  changedFields: string[] | null
  snapshotBefore: unknown
  snapshotAfter: unknown
  changes: Record<string, unknown> | null
  causeKind: CauseKind | null
  causeId: string | null
  organizationId?: string | null
  actionLabel?: string | null
  onBehalfOfUserId?: string | null
  parentResourceKind?: string | null
  parentResourceId?: string | null
  correlationId?: string | null
  causedByLogId?: string | null
  causation?: CausationEnvelope | null
}

export type ExplainProviderFact = {
  key: string
  params?: Record<string, string | number | boolean | null>
  confidence: ExplainConfidence
  reference?: { kind: string; id: string } | null
}

export type ExplainProviderContext = ExplainLoadContext & {
  resource: ExplainResourceDescriptor
  field: ExplainFieldDescriptor
  current: Record<string, unknown>
  itemId: string | null
  history: ExplainHistoryEntry[]
  resolveReference: (kind: string, ids: string[]) => Promise<ExplainReferenceDetail[]>
}

export type ExplainFieldProvider = {
  id: string
  explain: (ctx: ExplainProviderContext) => Promise<ExplainProviderFact[]>
}

export type ExplainModuleConfig = {
  version: typeof EXPLAIN_CONFIG_VERSION
  resources?: ExplainResourceDescriptor[]
  causeResolvers?: ExplainCauseResolver[]
  referenceResolvers?: ExplainReferenceResolver[]
  providers?: ExplainFieldProvider[]
}

export type ExplainModuleConfigEntry = {
  moduleId: string
  config: ExplainModuleConfig
}

export function defineExplainConfig(config: ExplainModuleConfig): ExplainModuleConfig {
  return config
}
