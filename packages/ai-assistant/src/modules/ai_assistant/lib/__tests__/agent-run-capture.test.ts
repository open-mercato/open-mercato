import { readPendingActionId } from '../agent-run-capture'

const PENDING_ACTION_ID = '5f0c6a2e-8b1d-4c3a-9e7f-1a2b3c4d5e6f'

describe('readPendingActionId', () => {
  it('reads a UUID pendingActionId from a mutation tool result object or JSON string', () => {
    expect(readPendingActionId({ pendingActionId: PENDING_ACTION_ID }, true)).toBe(PENDING_ACTION_ID)
    expect(readPendingActionId(JSON.stringify({ pendingActionId: PENDING_ACTION_ID }), true)).toBe(PENDING_ACTION_ID)
  })

  it('ignores pendingActionId on non-mutation tool results', () => {
    expect(readPendingActionId({ pendingActionId: PENDING_ACTION_ID }, false)).toBeNull()
  })

  it.each([
    ['not-a-uuid'],
    ['   '],
    [`${PENDING_ACTION_ID}-extra`],
    [42],
  ])('rejects a non-UUID pendingActionId %p', (value) => {
    expect(readPendingActionId({ pendingActionId: value }, true)).toBeNull()
  })

  it('returns null for results without a pendingActionId', () => {
    expect(readPendingActionId('plain text', true)).toBeNull()
    expect(readPendingActionId(null, true)).toBeNull()
    expect(readPendingActionId([PENDING_ACTION_ID], true)).toBeNull()
  })
})
