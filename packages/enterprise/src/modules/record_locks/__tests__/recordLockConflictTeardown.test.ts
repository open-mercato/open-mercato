import type { RecordLockFormState, RecordLockUiConflict } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'
import { shouldPreserveConflictOnTeardown } from '../widgets/injection/record-locking/widget.client'

const conflict: RecordLockUiConflict = {
  id: 'a0000000-0000-4000-8000-000000000001',
  resourceKind: 'catalog.product',
  resourceId: 'b0000000-0000-4000-8000-000000000001',
  baseActionLogId: null,
  incomingActionLogId: null,
  allowIncomingOverride: false,
  canOverrideIncoming: false,
  resolutionOptions: [],
  changes: [],
}

const stateWithConflict: RecordLockFormState = {
  formId: 'record-lock:catalog.product:b0000000-0000-4000-8000-000000000001',
  resourceKind: 'catalog.product',
  resourceId: 'b0000000-0000-4000-8000-000000000001',
  conflict,
  pendingConflictId: conflict.id,
}

describe('shouldPreserveConflictOnTeardown (#8797)', () => {
  test('preserves a pending, unresolved conflict across an incidental teardown', () => {
    // Before the fix, a primary-ownership handoff or a transient unmount
    // (e.g. a collapsing form panel) unconditionally wiped the form state,
    // dismissing the conflict dialog before the user could click
    // "Keep editing". This is the guard that stops that from happening.
    expect(shouldPreserveConflictOnTeardown(stateWithConflict)).toBe(true)
  })

  test('does not block teardown when there is no pending conflict', () => {
    const stateWithoutConflict: RecordLockFormState = {
      ...stateWithConflict,
      conflict: null,
      pendingConflictId: null,
    }
    expect(shouldPreserveConflictOnTeardown(stateWithoutConflict)).toBe(false)
  })

  test('treats a missing form state as nothing to preserve', () => {
    expect(shouldPreserveConflictOnTeardown(null)).toBe(false)
    expect(shouldPreserveConflictOnTeardown(undefined)).toBe(false)
  })
})
