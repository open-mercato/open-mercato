import type { RecordLockUiConflict } from '@open-mercato/enterprise/modules/record_locks/lib/clientLockStore'
import {
  isUuid,
  resolveConflictId,
  runAcceptIncoming,
  type AcceptIncomingFlow,
} from '../widgets/injection/record-locking/conflictResolution'

const RESOURCE_KIND = 'catalog.product'
const RESOURCE_ID = 'b0000000-0000-4000-8000-000000000001'
const REAL_CONFLICT_ID = 'a0000000-0000-4000-8000-000000000001'

function degradedConflict(): RecordLockUiConflict {
  return {
    id: 'unresolved',
    resourceKind: RESOURCE_KIND,
    resourceId: RESOURCE_ID,
    baseActionLogId: null,
    incomingActionLogId: null,
    allowIncomingOverride: false,
    canOverrideIncoming: false,
    resolutionOptions: [],
    changes: [],
  }
}

function recordLockConflict(): RecordLockUiConflict {
  return {
    ...degradedConflict(),
    id: REAL_CONFLICT_ID,
    allowIncomingOverride: true,
    canOverrideIncoming: true,
    resolutionOptions: ['accept_mine'],
  }
}

function makeFlow(overrides: Partial<AcceptIncomingFlow> = {}): {
  flow: AcceptIncomingFlow
  calls: string[]
  released: string[]
} {
  const calls: string[] = []
  const released: string[] = []
  const flow: AcceptIncomingFlow = {
    conflict: degradedConflict(),
    resourceKind: RESOURCE_KIND,
    resourceId: RESOURCE_ID,
    revalidateConflictId: async () => {
      calls.push('revalidate')
      return null
    },
    releaseIncoming: async (conflictId) => {
      calls.push('release')
      released.push(conflictId)
    },
    clearConflictState: () => {
      calls.push('clear')
    },
    reload: () => {
      calls.push('reload')
    },
    ...overrides,
  }
  return { flow, calls, released }
}

describe('isUuid / resolveConflictId', () => {
  test('rejects the degraded fallback conflict id', () => {
    expect(isUuid('unresolved')).toBe(false)
    expect(resolveConflictId(degradedConflict())).toBeNull()
  })

  test('accepts a genuine record-lock conflict id', () => {
    expect(isUuid(REAL_CONFLICT_ID)).toBe(true)
    expect(resolveConflictId(recordLockConflict())).toBe(REAL_CONFLICT_ID)
  })

  test('treats null/undefined conflicts as unresolvable', () => {
    expect(resolveConflictId(null)).toBeNull()
    expect(resolveConflictId(undefined)).toBeNull()
  })
})

describe('runAcceptIncoming', () => {
  test('resolves a degraded OSS-floor 409 by reloading without a record-lock release (regression for #3505)', async () => {
    const { flow, calls, released } = makeFlow()

    const outcome = await runAcceptIncoming(flow)

    expect(outcome).toBe('reloaded')
    expect(released).toHaveLength(0)
    expect(calls).toContain('clear')
    expect(calls).toContain('reload')
    // The action must never dead-end: state is cleared and the page reloads to load the incoming record.
    expect(calls[calls.length - 1]).toBe('reload')
  })

  test('releases a genuine record-lock conflict before reloading', async () => {
    const { flow, calls, released } = makeFlow({ conflict: recordLockConflict() })

    const outcome = await runAcceptIncoming(flow)

    expect(outcome).toBe('released')
    expect(released).toEqual([REAL_CONFLICT_ID])
    expect(calls).toEqual(['release', 'clear', 'reload'])
  })

  test('recovers a conflict id via revalidation when the local id is degraded', async () => {
    const { flow, calls, released } = makeFlow({
      revalidateConflictId: async () => {
        calls.push('revalidate')
        return REAL_CONFLICT_ID
      },
    })

    const outcome = await runAcceptIncoming(flow)

    expect(outcome).toBe('released')
    expect(released).toEqual([REAL_CONFLICT_ID])
    expect(calls).toEqual(['revalidate', 'release', 'clear', 'reload'])
  })

  test('skips entirely when there is no conflict or resource context', async () => {
    const { flow, calls } = makeFlow({ conflict: null })
    expect(await runAcceptIncoming(flow)).toBe('skipped')

    const missingResource = makeFlow({ resourceId: null })
    expect(await runAcceptIncoming(missingResource.flow)).toBe('skipped')

    expect(calls).toHaveLength(0)
    expect(missingResource.calls).toHaveLength(0)
  })
})
