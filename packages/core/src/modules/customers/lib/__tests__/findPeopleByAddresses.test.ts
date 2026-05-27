import { normalizeAddresses, findPeopleByAddresses } from '../findPeopleByAddresses'

describe('normalizeAddresses', () => {
  it('lowercases, trims, dedupes', () => {
    const out = normalizeAddresses(['Alice@Example.com', ' alice@example.com ', 'BOB@x.io'])
    expect(out.sort()).toEqual(['alice@example.com', 'bob@x.io'])
  })
  it('filters out non-strings and obviously invalid shapes', () => {
    const out = normalizeAddresses([null as any, undefined as any, 'not-an-email', 'a@b'])
    expect(out).toEqual(['a@b'])
  })
  it('returns empty array for empty input', () => {
    expect(normalizeAddresses([])).toEqual([])
    expect(normalizeAddresses(undefined as any)).toEqual([])
  })
})

describe('findPeopleByAddresses', () => {
  /**
   * Build an EM mock that resolves `findOne` based on the WHERE clause.
   * Each row in `rows` represents an existing CustomerEntity (kind='person').
   */
  function makeEm(rows: Array<{ id: string; primaryEmail: string | null; tenantId: string }>) {
    const em: any = {
      findOne: jest.fn().mockImplementation(async (_entity: unknown, where: any) => {
        const target = String(where.primaryEmail ?? '')
        const tenant = String(where.tenantId ?? '')
        const kind = String(where.kind ?? '')
        if (kind !== 'person') return null
        return rows.find((r) => r.primaryEmail === target && r.tenantId === tenant) ?? null
      }),
    }
    return em
  }

  it('returns empty array when address list is empty', async () => {
    const em = makeEm([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1' }])
    const out = await findPeopleByAddresses(em, [], 'tenant-1')
    expect(out).toEqual([])
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('matches one row when caller uses upper-case', async () => {
    const em = makeEm([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1' }])
    const out = await findPeopleByAddresses(em, ['ALICE@EXAMPLE.COM'], 'tenant-1')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: 'p1', email: 'alice@example.com' })
  })

  it('returns one row per matching person when multiple addresses match different people', async () => {
    const em = makeEm([
      { id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1' },
      { id: 'p2', primaryEmail: 'bob@example.com', tenantId: 'tenant-1' },
    ])
    const out = await findPeopleByAddresses(em, ['alice@example.com', 'bob@example.com'], 'tenant-1')
    expect(out.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('dedupes when same Person matches via duplicate addresses (defensive)', async () => {
    const em = makeEm([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1' }])
    const out = await findPeopleByAddresses(em, ['alice@example.com', 'Alice@Example.com'], 'tenant-1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p1')
  })

  it('passes the tenantId through to the EM filter', async () => {
    const em = makeEm([])
    await findPeopleByAddresses(em, ['x@y.io'], 'tenant-42')
    const where = (em.findOne.mock.calls[0] as any[])[1]
    expect(where.tenantId).toBe('tenant-42')
    expect(where.kind).toBe('person')
  })

  it('returns empty when no person matches in the given tenant', async () => {
    const em = makeEm([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-other' }])
    const out = await findPeopleByAddresses(em, ['alice@example.com'], 'tenant-1')
    expect(out).toEqual([])
  })
})
