import { planProjectCodeMigration } from '../migrateProjectCodes'

type Row = { id: string; name: string; code: string }

const rows = (...items: Row[]) => items as never

describe('planProjectCodeMigration', () => {
  it('shortens long codes and keeps the sequence numbers out of it', () => {
    const { changes } = planProjectCodeMigration(
      rows(
        { id: 'a', name: 'Ergo Hestia Korpo', code: 'ERGO-HESTIA-KORPO' },
        { id: 'b', name: 'Apollo — Website Redesign', code: 'APOLLO' },
      ),
      new Map([['a', 4], ['b', 213]]),
    )
    expect(changes.map((change) => [change.fromCode, change.toCode])).toEqual([
      ['ERGO-HESTIA-KORPO', 'EHK'],
      ['APOLLO', 'AWR'],
    ])
    expect(changes[1].taskCount).toBe(213)
  })

  it('leaves an already-short code exactly as it is', () => {
    // A three-character code was chosen by a person, not derived.
    const { changes, skipped } = planProjectCodeMigration(
      rows({ id: 'a', name: 'HBH', code: 'HBH' }),
      new Map(),
    )
    expect(changes).toHaveLength(0)
    expect(skipped).toBe(1)
  })

  it('reserves surviving codes before assigning new ones', () => {
    // A project keeping `EHK` must not have it taken by one being shortened.
    const { changes } = planProjectCodeMigration(
      rows(
        { id: 'a', name: 'Something Else Entirely', code: 'EHK' },
        { id: 'b', name: 'Ergo Hestia Korpo', code: 'ERGO-HESTIA-KORPO' },
      ),
      new Map(),
    )
    expect(changes).toHaveLength(1)
    expect(changes[0].toCode).toBe('EHK2')
  })

  it('resolves collisions between two projects being shortened together', () => {
    const { changes } = planProjectCodeMigration(
      rows(
        { id: 'a', name: 'Apollo Programme', code: 'APOLLO-PROGRAMME' },
        { id: 'b', name: 'Apollo Platform', code: 'APOLLO-PLATFORM' },
      ),
      new Map(),
    )
    const codes = changes.map((change) => change.toCode)
    expect(new Set(codes).size).toBe(codes.length)
    // Two words take the first three letters of the joined slug, so both want
            // APO; the second one extends rather than picking a different stem.
    expect(codes).toEqual(['APO', 'APO2'])
  })

  it('is stable across runs regardless of query order', () => {
    const input = rows(
      { id: 'b', name: 'Apollo Platform', code: 'APOLLO-PLATFORM' },
      { id: 'a', name: 'Apollo Programme', code: 'APOLLO-PROGRAMME' },
    )
    const first = planProjectCodeMigration(input, new Map())
    const second = planProjectCodeMigration(
      rows(
        { id: 'a', name: 'Apollo Programme', code: 'APOLLO-PROGRAMME' },
        { id: 'b', name: 'Apollo Platform', code: 'APOLLO-PLATFORM' },
      ),
      new Map(),
    )
    const byId = (result: ReturnType<typeof planProjectCodeMigration>) =>
      Object.fromEntries(result.changes.map((change) => [change.projectId, change.toCode]))
    expect(byId(first)).toEqual(byId(second))
  })
})
