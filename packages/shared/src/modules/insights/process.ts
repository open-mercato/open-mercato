import type { EntityManager } from '@mikro-orm/postgresql'

export const PROCESS_CONFIG_VERSION = 1 as const

export const PROCESS_ACTIVITY_VALUE_PATTERN = /^[a-z0-9_.:-]{1,64}$/

export const PROCESS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}\.[a-z][a-z0-9_]{0,63}$/

export const PROCESS_DECLARATION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,47}$/

export const PROCESS_ENTITY_ID_PATTERN = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/

export const PROCESS_OTHER_VALUE = 'other'

export const PROCESS_NONE_VALUE = 'none'

export const PROCESS_RESERVED_VALUES = [PROCESS_OTHER_VALUE, PROCESS_NONE_VALUE] as const

export const PROCESS_MAX_DISTINCT_VALUES_PER_FIELD = 200

export const PROCESS_LEGACY_CAUSE_KIND = 'legacy'

export const PROCESS_FIELD_VALUE_KINDS = ['enum', 'dictionary', 'uuid', 'user'] as const

export type ProcessFieldValueKind = (typeof PROCESS_FIELD_VALUE_KINDS)[number]

export const PROCESS_ACTIVITY_KINDS = ['lifecycle', 'stage', 'followup', 'milestone'] as const

export type ProcessActivityKind = (typeof PROCESS_ACTIVITY_KINDS)[number]

export const PROCESS_LIFECYCLE_ACTIVITIES = ['created', 'deleted'] as const

export type ProcessLifecycleActivity = (typeof PROCESS_LIFECYCLE_ACTIVITIES)[number]

export const PROCESS_ACTOR_DIMENSION_KINDS = ['role', 'team'] as const

export type ProcessActorDimensionKind = (typeof PROCESS_ACTOR_DIMENSION_KINDS)[number]

export const PROCESS_CASE_STATUSES = ['open', 'completed', 'deleted'] as const

export type ProcessCaseStatus = (typeof PROCESS_CASE_STATUSES)[number]

/**
 * A field whose value changes are projected as process activities. Values are
 * identifiers only: a value that is not a UUID and does not match
 * `PROCESS_ACTIVITY_VALUE_PATTERN` is stored as `other`, and a missing value as `none`.
 * A `user` field (a user id, allowed in `followupFields` only) is stored as the same
 * per-tenant pseudonym as the projected actors. `snapshotPaths` are read from the audit
 * snapshots (`snapshot_before` / `snapshot_after`); `changeKeys` from the recorded `changes`
 * when a snapshot side is missing.
 */
export type ProcessFieldDescriptor = {
  key: string
  labelKey: string
  valueKind: ProcessFieldValueKind
  snapshotPaths: string[]
  changeKeys?: string[]
}

/**
 * A child record whose audit rows name the case root as their parent
 * (`parent_resource_kind` / `parent_resource_id`), e.g. a payment of an order.
 */
export type ProcessMilestoneDescriptor = {
  key: string
  labelKey: string
  resourceKind: string
  logResourceKinds?: string[]
  parentResourceKinds: string[]
  entityId: string
  lifecycle?: ProcessLifecycleActivity[]
  fields?: ProcessFieldDescriptor[]
}

/**
 * An audit row of another resource's command that ends this process's case, e.g. a quote
 * converted to an order: the conversion is logged on the order (`logResourceKinds`), with the
 * quote in `snapshot_before`. The case id is read from `snapshot_before` at `caseIdPaths`; the
 * case gets the lifecycle activity `key` and is completed. Undoing the command voids it again.
 */
export type ProcessExitDescriptor = {
  key: string
  labelKey: string
  commandIds: string[]
  logResourceKinds: string[]
  caseIdPaths: string[]
}

export type ProcessEndStateDescriptor = {
  field: string
  values: string[]
}

export type ProcessDescriptor = {
  processKey: string
  labelKey: string
  resourceKind: string
  logResourceKinds?: string[]
  entityId: string
  requiredFeatures: string[]
  stageFields: ProcessFieldDescriptor[]
  followupFields?: ProcessFieldDescriptor[]
  milestones?: ProcessMilestoneDescriptor[]
  exits?: ProcessExitDescriptor[]
  endStates?: ProcessEndStateDescriptor[]
}

export type ProcessActorDimensionContext = {
  em: EntityManager
  tenantId: string
  organizationId: string
}

/**
 * Resolves actor dimensions for a batch of user ids in one query. Returns, per user
 * id, the dimension ids (UUIDs) the user belongs to; unknown users are omitted.
 */
export type ProcessActorDimensionProvider = {
  kind: ProcessActorDimensionKind
  resolve: (ctx: ProcessActorDimensionContext, userIds: string[]) => Promise<Record<string, string[]>>
}

export type ProcessModuleConfig = {
  version: typeof PROCESS_CONFIG_VERSION
  processes?: ProcessDescriptor[]
  actorDimensions?: ProcessActorDimensionProvider[]
}

export type ProcessModuleConfigEntry = {
  moduleId: string
  config: ProcessModuleConfig
}

export function defineProcessConfig(config: ProcessModuleConfig): ProcessModuleConfig {
  return config
}
