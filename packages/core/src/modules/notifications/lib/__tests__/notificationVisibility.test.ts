import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
} from 'kysely'
import { inAppVisibleFilter, inAppVisibleSql, isInAppVisible } from '../notificationVisibility'
import { IN_APP_CHANNEL } from '../strategies/in-app-delivery-strategy'

function createKysely(): Kysely<any> {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
}

describe('inAppVisibleFilter (MikroORM fragment)', () => {
  it('matches null channels OR a channels array containing in_app', () => {
    expect(inAppVisibleFilter()).toEqual({
      $or: [
        { channels: null },
        { channels: { $contains: [IN_APP_CHANNEL] } },
      ],
    })
  })
})

describe('isInAppVisible (in-memory counterpart)', () => {
  it('treats null/undefined channels as visible (legacy / all-channels)', () => {
    expect(isInAppVisible(null)).toBe(true)
    expect(isInAppVisible(undefined)).toBe(true)
  })

  it('is visible only when the resolved set includes in_app', () => {
    expect(isInAppVisible([IN_APP_CHANNEL, 'email'])).toBe(true)
    expect(isInAppVisible(['push', 'email'])).toBe(false)
    expect(isInAppVisible([])).toBe(false)
  })
})

describe('inAppVisibleSql (raw Kysely predicate)', () => {
  it('compiles to the same `IS NULL OR @> jsonb` containment MikroORM emits', () => {
    const compiled = inAppVisibleSql().compile(createKysely())

    expect(compiled.sql).toBe('("channels" is null or "channels" @> $1::jsonb)')
    expect(compiled.parameters).toEqual([JSON.stringify([IN_APP_CHANNEL])])
  })

  it('honours a custom, code-controlled column reference', () => {
    const compiled = inAppVisibleSql('n.channels').compile(createKysely())

    expect(compiled.sql).toBe('("n"."channels" is null or "n"."channels" @> $1::jsonb)')
    expect(compiled.parameters).toEqual([JSON.stringify([IN_APP_CHANNEL])])
  })
})
