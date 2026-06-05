import { readFileSync } from 'node:fs'

describe('message_reactions schema', () => {
  it('uses partial unique indexes for nullable reaction actors', () => {
    const migration = readFileSync(
      new URL('../../migrations/Migration20260526134719_communication_channels.ts', import.meta.url),
      'utf8',
    )

    expect(migration).toContain(
      'create unique index "message_reactions_internal_actor_uq"',
    )
    expect(migration).toContain('where "reacted_by_user_id" is not null')
    expect(migration).toContain(
      'create unique index "message_reactions_external_actor_uq"',
    )
    expect(migration).toContain('where "reacted_by_external_id" is not null')
    expect(migration).toContain('message_reactions_exactly_one_actor_chk')
    expect(migration).not.toContain('message_reactions_unique_per_reactor_uq')
  })

  it('keeps the migration snapshot aligned with reaction actor indexes', () => {
    const snapshot = JSON.parse(
      readFileSync(
        new URL('../../migrations/.snapshot-open-mercato.json', import.meta.url),
        'utf8',
      ),
    ) as {
      tables: Array<{
        name: string
        indexes: Array<{ keyName: string; expression?: string }>
        checks: Array<{ name: string; expression?: string }>
      }>
    }

    const reactions = snapshot.tables.find((table) => table.name === 'message_reactions')
    expect(reactions).toBeDefined()
    const indexes = new Map(
      reactions?.indexes.map((index) => [index.keyName, index.expression ?? '']) ?? [],
    )

    expect(indexes.get('message_reactions_internal_actor_uq')).toContain(
      'where "reacted_by_user_id" is not null',
    )
    expect(indexes.get('message_reactions_external_actor_uq')).toContain(
      'where "reacted_by_external_id" is not null',
    )
    expect(reactions?.checks.map((check) => check.name)).toContain(
      'message_reactions_exactly_one_actor_chk',
    )
    expect(indexes.has('message_reactions_unique_per_reactor_uq')).toBe(false)
  })
})
