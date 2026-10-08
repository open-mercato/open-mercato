import type { ProcessModuleConfig } from '@open-mercato/shared/modules/insights/process'
import type { ProcessSourceEntry } from '../activities'
import { buildProcessRegistrySnapshot, type ProcessRegistrySnapshot } from '../registry'

export const TENANT_ID = '11111111-0000-4000-8000-000000000001'
export const ORG_ID = '22222222-0000-4000-8000-000000000001'
export const OTHER_ORG_ID = '22222222-0000-4000-8000-000000000002'
export const DEAL_ID = '44444444-0000-4000-8000-000000000001'
export const ORDER_ID = '44444444-0000-4000-8000-000000000002'
export const PAYMENT_ID = '44444444-0000-4000-8000-000000000003'
export const USER_ID = '33333333-0000-4000-8000-000000000001'
export const OTHER_USER_ID = '33333333-0000-4000-8000-000000000002'
export const STAGE_A = '55555555-0000-4000-8000-00000000000a'
export const STAGE_B = '55555555-0000-4000-8000-00000000000b'
export const WORKFLOW_ID = '66666666-0000-4000-8000-000000000001'

let logCounter = 0

export function nextLogId(): string {
  logCounter += 1
  return `77777777-0000-4000-8000-${String(logCounter).padStart(12, '0')}`
}

export function testProcessConfig(): ProcessModuleConfig {
  return {
    version: 1,
    processes: [
      {
        processKey: 'test.deal',
        labelKey: 'test.process.deal',
        resourceKind: 'test.deal',
        entityId: 'test:deal',
        requiredFeatures: ['test.deals.view'],
        stageFields: [
          { key: 'status', labelKey: 'test.status', valueKind: 'dictionary', snapshotPaths: ['deal.status'], changeKeys: ['deal.status', 'status'] },
          { key: 'stageId', labelKey: 'test.stage', valueKind: 'uuid', snapshotPaths: ['deal.stageId'], changeKeys: ['deal.stageId'] },
        ],
        followupFields: [
          { key: 'ownerUserId', labelKey: 'test.owner', valueKind: 'user', snapshotPaths: ['deal.ownerUserId'], changeKeys: ['deal.ownerUserId'] },
          { key: 'priority', labelKey: 'test.priority', valueKind: 'enum', snapshotPaths: ['deal.priority'], changeKeys: ['deal.priority'] },
        ],
        milestones: [
          {
            key: 'payment',
            labelKey: 'test.payment',
            resourceKind: 'test.payment',
            parentResourceKinds: ['test.deal'],
            entityId: 'test:payment',
            lifecycle: ['created', 'deleted'],
            fields: [{ key: 'status', labelKey: 'test.payment.status', valueKind: 'dictionary', snapshotPaths: ['status'], changeKeys: ['status'] }],
          },
        ],
        endStates: [{ field: 'status', values: ['won', 'lost'] }],
      },
    ],
  }
}

export function testRegistry(config: ProcessModuleConfig = testProcessConfig()): ProcessRegistrySnapshot {
  return buildProcessRegistrySnapshot([{ moduleId: 'test', config }], [{ moduleId: 'test', maps: [] }])
}

export function sourceEntry(overrides: Partial<ProcessSourceEntry> = {}): ProcessSourceEntry {
  return {
    logId: overrides.logId ?? nextLogId(),
    cursorAt: '2026-10-08T10:00:00.000000Z',
    commandId: 'test.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: USER_ID,
    actorKind: 'user',
    resourceKind: 'test.deal',
    resourceId: DEAL_ID,
    parentResourceKind: null,
    parentResourceId: null,
    snapshotBefore: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: USER_ID, priority: 'low' } },
    snapshotAfter: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: USER_ID, priority: 'low' } },
    changes: null,
    causeKind: 'user',
    causeId: null,
    organizationId: ORG_ID,
    causation: null,
    historyAction: null,
    sourceLogId: null,
    ...overrides,
  }
}
