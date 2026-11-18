import { buildPendingChange, previousTermOf } from '../lib/pendingChange'

describe('pending change serializer', () => {
  it('records the previous term of the lease', () => {
    expect(
      previousTermOf({ endsOn: '2027-06-30', startsOn: '2026-07-01', status: 'active', termMonths: 12, currentVersionId: 'version-1' }),
    ).toEqual({ endsOn: '2027-06-30', startsOn: '2026-07-01', status: 'active', termMonths: 12, currentVersionId: 'version-1' })
  })

  it('stores a missing current version as null', () => {
    expect(previousTermOf({ endsOn: '2027-06-30', startsOn: '2026-07-01', status: 'active', termMonths: 12 }).currentVersionId).toBeNull()
  })

  it('pins the pending end shape stored in pending_change', () => {
    const previous = previousTermOf({ endsOn: '2027-06-30', startsOn: '2026-07-01', status: 'active', termMonths: 12, currentVersionId: null })
    const change = buildPendingChange('end', 'change-1', previous, ['op-1', 'op-2'])
    expect(JSON.parse(JSON.stringify(change))).toStrictEqual({
      kind: 'end',
      changeId: 'change-1',
      previous: { endsOn: '2027-06-30', startsOn: '2026-07-01', status: 'active', termMonths: 12, currentVersionId: null },
      operationIds: ['op-1', 'op-2'],
    })
    expect(Object.keys(change)).toEqual(['kind', 'changeId', 'previous', 'operationIds'])
    expect(Object.keys(change.previous)).toEqual(['endsOn', 'startsOn', 'status', 'termMonths', 'currentVersionId'])
  })
})
