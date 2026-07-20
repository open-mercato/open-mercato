import { getNotificationTypeOverrides } from '../typeOverrides'

const TENANT = '00000000-0000-0000-0000-000000000001'

type FakeRow = {
  notification_type_id: string
  channels: unknown
  non_opt_out: unknown
}

function makeEm(rows: FakeRow[]) {
  const recorded = { wheres: [] as Array<[string, string, unknown]> }
  const chain: any = {
    select: () => chain,
    where: (column: string, op: string, value: unknown) => {
      recorded.wheres.push([column, op, value])
      return chain
    },
    execute: async () => rows,
  }
  const db = { selectFrom: jest.fn(() => chain) }
  const em = { getKysely: () => db }
  return { em: em as never, db, recorded }
}

describe('getNotificationTypeOverrides (tenant-scoped notification_type_overrides read)', () => {
  it('returns an empty map without touching the DB when no type ids are given', async () => {
    const { em, db } = makeEm([])
    const result = await getNotificationTypeOverrides(em, TENANT, [])
    expect(result.size).toBe(0)
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('returns an empty map without touching the DB when the tenant id is empty', async () => {
    const { em, db } = makeEm([])
    const result = await getNotificationTypeOverrides(em, '', ['a.one'])
    expect(result.size).toBe(0)
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('scopes the query to the tenant and deduplicates type ids', async () => {
    const { em, recorded } = makeEm([])
    await getNotificationTypeOverrides(em, TENANT, ['a.one', 'a.one', '', 'b.two'])
    expect(recorded.wheres).toContainEqual(['tenant_id', '=', TENANT])
    expect(recorded.wheres).toContainEqual(['notification_type_id', 'in', ['a.one', 'b.two']])
  })

  it('maps stored channels + nonOptOut and keys by type id', async () => {
    const { em } = makeEm([
      { notification_type_id: 'a.one', channels: ['in_app', 'email'], non_opt_out: null },
      { notification_type_id: 'b.two', channels: null, non_opt_out: true },
      { notification_type_id: 'c.three', channels: ['push'], non_opt_out: false },
    ])
    const result = await getNotificationTypeOverrides(em, TENANT, ['a.one', 'b.two', 'c.three'])
    expect(result.get('a.one')).toEqual({ channels: ['in_app', 'email'], nonOptOut: null })
    expect(result.get('b.two')).toEqual({ channels: null, nonOptOut: true })
    expect(result.get('c.three')).toEqual({ channels: ['push'], nonOptOut: false })
  })

  it('drops rows that store neither override (all-null husk rows are treated as absent)', async () => {
    const { em } = makeEm([{ notification_type_id: 'a.one', channels: null, non_opt_out: null }])
    const result = await getNotificationTypeOverrides(em, TENANT, ['a.one'])
    expect(result.has('a.one')).toBe(false)
  })

  it('normalizes malformed jsonb (non-array channels, non-boolean non_opt_out) to null', async () => {
    const { em } = makeEm([
      { notification_type_id: 'a.one', channels: { bogus: true }, non_opt_out: 'yes' },
      { notification_type_id: 'b.two', channels: 'push', non_opt_out: true },
    ])
    const result = await getNotificationTypeOverrides(em, TENANT, ['a.one', 'b.two'])
    expect(result.has('a.one')).toBe(false)
    expect(result.get('b.two')).toEqual({ channels: null, nonOptOut: true })
  })
})
