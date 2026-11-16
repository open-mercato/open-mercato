import type { EntityManager } from '@mikro-orm/postgresql'
import { seedCatalogPriceKinds } from '../seeds'

type PriceKindRow = {
  id: string
  tenantId: string
  organizationId: string | null
  code: string
  title: string
  displayMode: 'including-tax' | 'excluding-tax'
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

function makeRow(overrides: Partial<PriceKindRow> & Pick<PriceKindRow, 'id' | 'code' | 'title'>): PriceKindRow {
  return {
    tenantId: TENANT_ID,
    organizationId: null,
    displayMode: 'excluding-tax',
    currencyCode: 'EUR',
    isPromotion: false,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function createFakeEm(rows: PriceKindRow[]) {
  const persisted: PriceKindRow[] = []
  const em = {
    find: jest.fn(async (_entity: unknown, where: { tenantId: string }) =>
      rows.filter((row) => row.tenantId === where.tenantId),
    ),
    create: jest.fn((_entity: unknown, data: Omit<PriceKindRow, 'id'>) => ({ id: `new-${data.code}`, ...data })),
    persist: jest.fn((row: PriceKindRow) => {
      persisted.push(row)
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, find: em.find, persisted }
}

describe('seedCatalogPriceKinds', () => {
  it('creates regular and sale for a tenant without price kinds', async () => {
    const { em, persisted } = createFakeEm([])

    await seedCatalogPriceKinds(em, { tenantId: TENANT_ID, organizationId: ORG_A })

    expect(persisted.map((row) => row.code).sort()).toEqual(['regular', 'sale'])
    expect(persisted.every((row) => row.organizationId === ORG_A && row.tenantId === TENANT_ID)).toBe(true)
    expect(persisted.find((row) => row.code === 'sale')?.isPromotion).toBe(true)
  })

  it('leaves tenant-defined price kinds and edited defaults untouched on re-run', async () => {
    const contract = makeRow({ id: 'contract', code: 'contract', title: 'Contract price' })
    const regular = makeRow({
      id: 'regular',
      code: 'regular',
      title: 'List price',
      organizationId: ORG_A,
      currencyCode: 'PLN',
      isActive: false,
    })
    const sale = makeRow({ id: 'sale', code: 'sale', title: 'Promo', isPromotion: true, deletedAt: CREATED_AT, isActive: false })
    const snapshot = [contract, regular, sale].map((row) => ({ ...row }))
    const { em, find, persisted } = createFakeEm([contract, regular, sale])

    await seedCatalogPriceKinds(em, { tenantId: TENANT_ID, organizationId: ORG_B })

    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0]?.[1]).toStrictEqual({ tenantId: TENANT_ID })
    expect([contract, regular, sale]).toEqual(snapshot)
    expect(persisted).toEqual([])
  })

  it('treats existing codes case-insensitively and only adds the missing default', async () => {
    const regular = makeRow({ id: 'regular', code: 'Regular', title: 'Regular' })
    const snapshot = { ...regular }
    const { em, persisted } = createFakeEm([regular])

    await seedCatalogPriceKinds(em, { tenantId: TENANT_ID, organizationId: null })

    expect(regular).toEqual(snapshot)
    expect(persisted.map((row) => row.code)).toEqual(['sale'])
    expect(persisted[0]?.organizationId).toBeNull()
  })
})
