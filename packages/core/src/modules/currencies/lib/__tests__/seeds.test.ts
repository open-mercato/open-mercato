import { seedExampleCurrencies } from '../seeds'

const TENANT = '33333333-3333-4333-8333-333333333333'
const ORG = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>

function buildEm(existing: Row[]) {
  const persisted: Row[] = []
  const em = {
    find: jest.fn(async () => existing),
    create: jest.fn((_entity: unknown, payload: Row) => ({ ...payload })),
    persist: jest.fn((row: Row) => {
      if (!existing.includes(row)) persisted.push(row)
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em, persisted }
}

function liveBaseCodes(rows: Row[]): string[] {
  return rows.filter((row) => row.isBase && !row.deletedAt).map((row) => String(row.code)).sort()
}

describe('seedExampleCurrencies base currency', () => {
  it('seeds USD as the base currency when the organization has none', async () => {
    const { em, persisted } = buildEm([])
    await seedExampleCurrencies(em as never, { tenantId: TENANT, organizationId: ORG })
    expect(liveBaseCodes(persisted)).toEqual(['USD'])
  })

  it('keeps an existing non-USD base currency as the only base', async () => {
    const existing: Row[] = [
      { code: 'CHF', name: 'Swiss Franc', isBase: true, deletedAt: null, tenantId: TENANT, organizationId: ORG },
    ]
    const { em, persisted } = buildEm(existing)
    await seedExampleCurrencies(em as never, { tenantId: TENANT, organizationId: ORG })
    expect(persisted.find((row) => row.code === 'USD')?.isBase).toBe(false)
    expect(liveBaseCodes([...existing, ...persisted])).toEqual(['CHF'])
  })

  it('treats a soft-deleted base row as no base', async () => {
    const existing: Row[] = [
      { code: 'CHF', name: 'Swiss Franc', isBase: true, deletedAt: new Date(), tenantId: TENANT, organizationId: ORG },
    ]
    const { em, persisted } = buildEm(existing)
    await seedExampleCurrencies(em as never, { tenantId: TENANT, organizationId: ORG })
    expect(liveBaseCodes(persisted)).toEqual(['USD'])
  })
})
