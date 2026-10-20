import type { CausationEnvelope, CauseKind } from '@open-mercato/shared/lib/causation/types'
import type { ExplainFieldDescriptor, ExplainResourceDescriptor } from '@open-mercato/shared/modules/insights/explain'
import type { EngineHistoryEntry, EngineSubject } from '../types'

export const RECORD_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
export const ORG_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
export const USER_ID = 'cccccccc-0000-4000-8000-000000000001'
export const WORKFLOW_ID = 'dddddddd-0000-4000-8000-000000000001'
export const CORRELATION_ID = 'eeeeeeee-0000-4000-8000-000000000001'

export const DEAL_SUBJECT: EngineSubject = { resourceKinds: ['customers.deal'], resourceId: RECORD_ID }

let logSequence = 0

export function nextLogId(): string {
  logSequence += 1
  return `ffffffff-0000-4000-8000-${String(logSequence).padStart(12, '0')}`
}

export function envelope(kind: CauseKind, id: string | null = null, extra: Partial<CausationEnvelope> = {}): CausationEnvelope {
  return {
    correlationId: CORRELATION_ID,
    frames: [{ kind: 'user' }, { kind, ...(id ? { id } : {}) }],
    ...extra,
  }
}

type EntryOverrides = Partial<EngineHistoryEntry> & {
  status?: { from: unknown; to: unknown }
}

export function dealEntry(at: string, overrides: EntryOverrides = {}): EngineHistoryEntry {
  const { status, ...rest } = overrides
  const fromStatus = status ? status.from : 'open'
  const toStatus = status ? status.to : 'won'
  return {
    logId: nextLogId(),
    at,
    commandId: 'customers.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: USER_ID,
    resourceKind: 'customers.deal',
    resourceId: RECORD_ID,
    changedFields: ['deal.status'],
    snapshotBefore: { deal: { id: RECORD_ID, status: fromStatus } },
    snapshotAfter: { deal: { id: RECORD_ID, status: toStatus } },
    changes: { 'deal.status': { from: fromStatus, to: toStatus } },
    causeKind: 'workflow',
    causeId: WORKFLOW_ID,
    organizationId: ORG_ID,
    onBehalfOfUserId: null,
    parentResourceKind: null,
    parentResourceId: null,
    correlationId: CORRELATION_ID,
    causedByLogId: null,
    causation: envelope('workflow', WORKFLOW_ID),
    historyAction: null,
    sourceLogId: null,
    ...rest,
  }
}

export const STATUS_FIELD: ExplainFieldDescriptor = {
  key: 'status',
  labelKey: 'customers.deals.fields.status',
  valueKind: 'enum',
  snapshotPaths: ['deal.status'],
  changeKeys: ['deal.status'],
  currentPath: 'status',
  unloggedWriters: [{ id: 'customers.reconcile', labelKey: 'customers.explain.writers.reconcile' }],
}

export const VALUE_FIELD: ExplainFieldDescriptor = {
  key: 'valueAmount',
  labelKey: 'customers.deals.fields.valueAmount',
  valueKind: 'decimal',
  snapshotPaths: ['deal.valueAmount'],
  currentPath: 'valueAmount',
}

export function dealResource(overrides: Partial<ExplainResourceDescriptor> = {}): ExplainResourceDescriptor {
  return {
    resourceKind: 'customers.deal',
    labelKey: 'customers.deals.label',
    requiredFeatures: ['customers.deals.view'],
    loadCurrent: async () => null,
    fields: [STATUS_FIELD, VALUE_FIELD],
    customFields: { entityId: 'customers:customer_deal', snapshotContainers: ['custom'] },
    ...overrides,
  }
}

export const ALLOW_ALL = () => true
