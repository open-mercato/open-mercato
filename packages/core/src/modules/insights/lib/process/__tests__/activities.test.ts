import { deriveLogActivities, resolveFieldChange, type LogDerivation } from '../activities'
import {
  DEAL_ID,
  OTHER_USER_ID,
  PAYMENT_ID,
  STAGE_A,
  STAGE_B,
  USER_ID,
  WORKFLOW_ID,
  nextLogId,
  sourceEntry,
  testRegistry,
} from './processTestSupport'

const processes = testRegistry().processes

function events(derivation: LogDerivation) {
  if (derivation.kind !== 'events') throw new Error(`[internal] expected events, got ${derivation.kind}`)
  return derivation
}

function keys(derivation: LogDerivation): string[] {
  return events(derivation).activities.map((activity) => activity.activityKey)
}

describe('deriveLogActivities — case root', () => {
  it('projects a create as the lifecycle step followed by the initial stage values', () => {
    const derivation = deriveLogActivities(sourceEntry({
      actionType: 'create',
      snapshotBefore: null,
      snapshotAfter: { deal: { status: 'open', stageId: STAGE_A.toUpperCase(), ownerUserId: USER_ID, priority: 'low' } },
    }), processes)
    expect(keys(derivation)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`])
    expect(events(derivation).activities.map((activity) => activity.seq)).toEqual([0, 1, 2])
    expect(events(derivation).activities[0]).toEqual(expect.objectContaining({
      processKey: 'test.deal',
      caseKind: 'test.deal',
      caseId: DEAL_ID,
      activityKind: 'lifecycle',
      followupField: null,
      followupValue: null,
    }))
    expect(events(derivation).activities[1]).toEqual(expect.objectContaining({ activityKind: 'stage', followupField: 'status', followupValue: 'open' }))
  })

  it('projects only the fields an update changed, from the declared snapshot paths', () => {
    const derivation = deriveLogActivities(sourceEntry({
      snapshotBefore: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: USER_ID, priority: 'low' } },
      snapshotAfter: { deal: { status: 'won', stageId: STAGE_B, ownerUserId: OTHER_USER_ID, priority: 'low' } },
    }), processes)
    expect(keys(derivation)).toEqual(['status:won', `stageId:${STAGE_B}`, 'ownerUserId:changed'])
    const followup = events(derivation).activities[2]
    expect(followup).toEqual(expect.objectContaining({
      activityKind: 'followup',
      followupField: 'ownerUserId',
      followupValue: OTHER_USER_ID,
      valueKind: 'user',
      keyIncludesValue: false,
    }))
  })

  it('falls back to recorded changes when a snapshot side lacks the field', () => {
    const derivation = deriveLogActivities(sourceEntry({
      snapshotBefore: { other: true },
      snapshotAfter: { other: true },
      changes: { status: { from: 'open', to: 'lost' }, 'deal.priority': { from: 'low', to: 'low' } },
    }), processes)
    expect(keys(derivation)).toEqual(['status:lost'])
  })

  it('sanitizes values that are not identifiers', () => {
    const derivation = deriveLogActivities(sourceEntry({
      snapshotAfter: { deal: { status: 'Pending Review', stageId: 'not-a-uuid', ownerUserId: USER_ID, priority: 'low' } },
    }), processes)
    expect(keys(derivation)).toEqual(['status:other', 'stageId:other'])
  })

  it('counts a change between two non-identifier values as a change', () => {
    const derivation = deriveLogActivities(sourceEntry({
      snapshotBefore: { deal: { status: 'Draft A' } },
      snapshotAfter: { deal: { status: 'Draft B' } },
    }), processes)
    expect(keys(derivation)).toEqual(['status:other'])
  })

  it('projects a delete as the lifecycle step only', () => {
    const derivation = deriveLogActivities(sourceEntry({ actionType: 'delete', snapshotAfter: null }), processes)
    expect(keys(derivation)).toEqual(['deleted'])
  })

  it('skips rows that change nothing declared, rows of other kinds and failed rows', () => {
    expect(deriveLogActivities(sourceEntry(), processes)).toEqual({ kind: 'skip', reason: 'no_activity' })
    expect(deriveLogActivities(sourceEntry({ resourceKind: 'test.other' }), processes)).toEqual({ kind: 'skip', reason: 'no_match' })
    expect(deriveLogActivities(sourceEntry({ resourceId: 'not-a-uuid' }), processes)).toEqual({ kind: 'skip', reason: 'no_match' })
    expect(deriveLogActivities(sourceEntry({ executionState: 'failed' }), processes)).toEqual({ kind: 'skip', reason: 'failed' })
  })
})

describe('deriveLogActivities — milestones', () => {
  it('attributes a child row to the parent case through its parent resource kind', () => {
    const derivation = deriveLogActivities(sourceEntry({
      resourceKind: 'test.payment',
      resourceId: PAYMENT_ID,
      parentResourceKind: 'test.deal',
      parentResourceId: DEAL_ID,
      actionType: 'create',
      snapshotBefore: null,
      snapshotAfter: { id: PAYMENT_ID, status: 'pending' },
    }), processes)
    expect(keys(derivation)).toEqual(['payment.created', 'payment.status:pending'])
    expect(events(derivation).activities.every((activity) => activity.caseId === DEAL_ID && activity.activityKind === 'milestone')).toBe(true)
    expect(events(derivation).activities[1]).toEqual(expect.objectContaining({ followupField: 'payment.status', followupValue: 'pending' }))
  })

  it('projects child status changes and deletes, and ignores children of other parents', () => {
    const update = deriveLogActivities(sourceEntry({
      resourceKind: 'test.payment',
      resourceId: PAYMENT_ID,
      parentResourceKind: 'test.deal',
      parentResourceId: DEAL_ID,
      snapshotBefore: { status: 'pending' },
      snapshotAfter: { status: 'captured' },
    }), processes)
    expect(keys(update)).toEqual(['payment.status:captured'])
    const removal = deriveLogActivities(sourceEntry({
      resourceKind: 'test.payment',
      resourceId: PAYMENT_ID,
      parentResourceKind: 'test.deal',
      parentResourceId: DEAL_ID,
      actionType: 'delete',
      snapshotBefore: { status: 'captured' },
      snapshotAfter: null,
    }), processes)
    expect(keys(removal)).toEqual(['payment.deleted'])
    expect(deriveLogActivities(sourceEntry({
      resourceKind: 'test.payment',
      parentResourceKind: 'test.order',
      parentResourceId: DEAL_ID,
    }), processes)).toEqual({ kind: 'skip', reason: 'no_match' })
  })
})

describe('deriveLogActivities — undo, redo, causation', () => {
  it('turns a post-foundation undo trace into a void of the undone row', () => {
    const sourceLogId = nextLogId()
    const traceId = nextLogId()
    const derivation = deriveLogActivities(sourceEntry({ logId: traceId, causeKind: 'undo', causeId: sourceLogId.toUpperCase() }), processes)
    expect(derivation).toEqual({ kind: 'void', sourceLogId, voidedByLogId: traceId })
  })

  it('recognizes a legacy undo trace by its history context', () => {
    const sourceLogId = nextLogId()
    const derivation = deriveLogActivities(sourceEntry({ causeKind: null, historyAction: 'undo', sourceLogId }), processes)
    expect(derivation).toEqual(expect.objectContaining({ kind: 'void', sourceLogId }))
    expect(deriveLogActivities(sourceEntry({ causeKind: 'undo', causeId: 'not-a-log' }), processes))
      .toEqual({ kind: 'skip', reason: 'undo_without_source' })
  })

  it('projects events of rows already undone or redone as voided, and a redo row as new events', () => {
    const changed = {
      snapshotBefore: { deal: { status: 'open' } },
      snapshotAfter: { deal: { status: 'won' } },
    }
    expect(events(deriveLogActivities(sourceEntry({ ...changed, executionState: 'undone' }), processes)).base.voided).toBe(true)
    expect(events(deriveLogActivities(sourceEntry({ ...changed, executionState: 'redone' }), processes)).base.voided).toBe(true)
    const redo = events(deriveLogActivities(sourceEntry({ ...changed, causeKind: 'redo', causeId: nextLogId() }), processes))
    expect(redo.base.voided).toBe(false)
    expect(redo.base.causeKind).toBe('redo')
    expect(redo.activities.map((activity) => activity.activityKey)).toEqual(['status:won'])
  })

  it('buckets rows written before causation tracking as legacy and tags sync runs', () => {
    const changed = { snapshotBefore: { deal: { status: 'open' } }, snapshotAfter: { deal: { status: 'won' } } }
    const legacy = events(deriveLogActivities(sourceEntry({ ...changed, causeKind: null, causeId: 'ignored' }), processes))
    expect(legacy.base).toEqual(expect.objectContaining({ causeKind: 'legacy', causeId: null, viaSyncRun: false }))
    const nested = events(deriveLogActivities(sourceEntry({
      ...changed,
      causeKind: 'subscriber',
      causeId: 'data_sync:push',
      causation: { correlationId: nextLogId(), frames: [{ kind: 'sync_run', id: nextLogId() }, { kind: 'subscriber', id: 'data_sync:push' }] },
    }), processes))
    expect(nested.base).toEqual(expect.objectContaining({ causeKind: 'subscriber', causeId: 'data_sync:push', viaSyncRun: true }))
    const workflow = events(deriveLogActivities(sourceEntry({ ...changed, causeKind: 'workflow', causeId: WORKFLOW_ID }), processes))
    expect(workflow.base).toEqual(expect.objectContaining({ causeKind: 'workflow', causeId: WORKFLOW_ID }))
  })

  it('never copies the id of a person cause and drops system actors', () => {
    const changed = { snapshotBefore: { deal: { status: 'open' } }, snapshotAfter: { deal: { status: 'won' } } }
    const agent = events(deriveLogActivities(sourceEntry({ ...changed, causeKind: 'agent', causeId: USER_ID }), processes))
    expect(agent.base.causeId).toBeNull()
    const system = events(deriveLogActivities(sourceEntry({ ...changed, actorKind: 'system', actorUserId: null, causeKind: 'schedule' }), processes))
    expect(system.base.actorUserId).toBeNull()
    expect(system.base.occurredAt).toBe('2026-10-08T10:00:00.000000Z')
  })

  it('keeps a cause id only when it is an identifier or a UUID', () => {
    const changed = { snapshotBefore: { deal: { status: 'open' } }, snapshotAfter: { deal: { status: 'won' } } }
    const derive = (causeId: string | null) => events(deriveLogActivities(sourceEntry({ ...changed, causeKind: 'subscriber', causeId }), processes)).base.causeId
    expect(derive('customers.deal_won:notify')).toBe('customers.deal_won:notify')
    expect(derive(WORKFLOW_ID.toUpperCase())).toBe(WORKFLOW_ID)
    expect(derive('Jane Doe <jane@example.com>')).toBeNull()
    expect(derive('x'.repeat(65))).toBeNull()
    expect(derive('')).toBeNull()
    expect(derive(null)).toBeNull()
  })
})

describe('deriveLogActivities — conversions', () => {
  const converting = testRegistry({
    version: 1,
    processes: [
      {
        processKey: 'test.quote',
        labelKey: 'x',
        resourceKind: 'test.quote',
        entityId: 'test:quote',
        requiredFeatures: ['test.view'],
        stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['quote.status'], changeKeys: ['quote.status'] }],
        exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.quotes.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['quote.id'] }],
      },
      {
        processKey: 'test.order',
        labelKey: 'x',
        resourceKind: 'test.order',
        entityId: 'test:order',
        requiredFeatures: ['test.view'],
        stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['order.status'], changeKeys: ['status', 'order.status'] }],
      },
    ],
  }).processes

  it('starts the target case and ends the source case of a conversion logged on the target', () => {
    const quoteId = DEAL_ID
    const orderId = PAYMENT_ID
    const derivation = events(deriveLogActivities(sourceEntry({
      commandId: 'test.quotes.convert',
      resourceKind: 'test.order',
      resourceId: orderId,
      snapshotBefore: { quote: { id: quoteId, status: 'sent' }, lines: [] },
      snapshotAfter: { order: { id: orderId, status: 'confirmed' }, lines: [] },
    }), converting))
    expect(derivation.activities.map((activity) => [activity.processKey, activity.caseId, activity.activityKey, activity.seq])).toEqual([
      ['test.order', orderId, 'created', 0],
      ['test.order', orderId, 'status:confirmed', 1],
      ['test.quote', quoteId, 'converted', 0],
    ])
  })

  it('ignores an exit command logged on another resource kind', () => {
    const derivation = deriveLogActivities(sourceEntry({
      commandId: 'test.quotes.convert',
      resourceKind: 'test.invoice',
      resourceId: PAYMENT_ID,
      snapshotBefore: { quote: { id: DEAL_ID } },
      snapshotAfter: { invoice: { id: PAYMENT_ID } },
    }), converting)
    expect(derivation).toEqual({ kind: 'skip', reason: 'no_match' })
  })

  it('keeps an ordinary update an update and ignores exits of other commands', () => {
    const update = events(deriveLogActivities(sourceEntry({
      commandId: 'test.orders.update',
      resourceKind: 'test.order',
      resourceId: PAYMENT_ID,
      snapshotBefore: { order: { status: 'draft' } },
      snapshotAfter: { order: { status: 'confirmed' } },
    }), converting))
    expect(update.activities.map((activity) => activity.activityKey)).toEqual(['status:confirmed'])
  })
})

describe('resolveFieldChange', () => {
  it('reports no change without evidence on both sides', () => {
    const [process] = processes
    const status = process.stageFields[0]
    expect(resolveFieldChange(sourceEntry({ snapshotBefore: null, snapshotAfter: { deal: { status: 'won' } } }), status)).toBeUndefined()
    expect(resolveFieldChange(sourceEntry({ snapshotBefore: { deal: { status: null } }, snapshotAfter: { deal: { status: 'won' } } }), status))
      .toEqual({ value: 'won' })
  })
})
