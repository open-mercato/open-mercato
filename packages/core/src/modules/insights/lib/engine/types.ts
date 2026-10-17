import type { CausationFrame, CauseKind } from '@open-mercato/shared/lib/causation/types'
import type {
  ExplainConfidence,
  ExplainGapReason,
  ExplainHistoryEntry,
  ExplainUnloggedWriter,
  ExplainValueKind,
  ExplainVerdict,
} from '@open-mercato/shared/modules/insights/explain'

export const EXPLAIN_PENDING_GRACE_MS = 2 * 60 * 1000
export const EXPLAIN_ORDER_UNCERTAIN_MS = 5
export const EXPLAIN_DERIVED_MAX_DEPTH = 2

export type EngineHistoryEntry = ExplainHistoryEntry & {
  historyAction?: string | null
  sourceLogId?: string | null
}

export type ValueSource = 'snapshot' | 'implicit' | 'changes' | 'synthesized' | 'none'

export type ResolvedValue = {
  known: boolean
  value: unknown
  source: ValueSource
}

export type FieldTargetCollection = {
  key: string
  snapshotPath: string
  itemIdPath: string
  currentPath: string | null
  itemId: string
  itemResourceKinds: string[]
}

export type FieldTarget = {
  key: string
  labelKey: string
  valueKind: ExplainValueKind
  snapshotPaths: string[]
  changeKeys: string[]
  currentPath: string | null
  customFieldKey: string | null
  customFieldContainers: string[]
  collection: FieldTargetCollection | null
  derived: { dependsOn: string[] } | null
  provider: string | null
  referenceKind: string | null
  unloggedWriters: ExplainUnloggedWriter[]
}

export type EngineSubject = {
  resourceKinds: string[]
  resourceId: string
}

export type EngineCause = {
  kind: CauseKind
  id: string | null
  ref: string | null
  legacy: boolean
  derivedFromActor: boolean
  envelopeVerified: boolean
  frames: CausationFrame[]
}

export type EngineChainState = 'done' | 'undone' | 'redone'

export type EngineChainEntry = {
  logId: string
  at: string
  cursorAt: string | null
  state: EngineChainState
  actionType: string | null
  commandId: string | null
  from: ResolvedValue
  to: ResolvedValue
  actorUserId: string | null
  onBehalfOfUserId: string | null
  organizationId: string | null
  cause: EngineCause
  origin: EngineCause | null
  causedByLogId: string | null
  correlationId: string | null
  undoneBy: string | null
  stale: boolean
  orderUncertain: boolean
  adjacentGap: boolean
  danglingCausedBy: boolean
  confidence: ExplainConfidence
}

export type EngineGap = {
  afterLogId: string | null
  beforeLogId: string | null
  reason: ExplainGapReason
  at: string | null
}

export type EngineHintParams = Record<string, string | number | boolean | null>

export type EngineHint = {
  key: string
  params: EngineHintParams
}

export type EngineSummary = {
  key: string
  params: EngineHintParams
}

export type EngineDependency = {
  field: string
  labelKey: string | null
  verdict: ExplainVerdict | null
  confidence: ExplainConfidence
  lastChangeAt: string | null
  dependencies: EngineDependency[]
}

export type EngineEvaluationContext = {
  current: ResolvedValue
  currentUpdatedAt: string | null
  now: Date
  graceMs?: number
  truncated: boolean
  continuation: boolean
  danglingLogIds?: ReadonlySet<string>
  noHistoryReasonKey?: string | null
}

export type EngineFieldResult = {
  field: string
  verdict: ExplainVerdict
  confidence: ExplainConfidence
  summary: EngineSummary
  chain: EngineChainEntry[]
  gaps: EngineGap[]
  hints: EngineHint[]
  lastChangeAt: string | null
  dependencies: EngineDependency[]
}

export type EngineDependencyTarget =
  | { kind: 'field'; target: FieldTarget }
  | { kind: 'collection'; key: string; labelKey: string; snapshotPath: string; itemResourceKinds: string[] }
