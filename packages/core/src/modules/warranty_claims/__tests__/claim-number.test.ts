import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaimNumberGenerator } from '../services/claimNumberGenerator'
import type { WarrantyClaimType } from '../data/validators'

const TENANT_ONE = '11111111-1111-4111-8111-111111111111'
const TENANT_TWO = '22222222-2222-4222-8222-222222222222'
const ORG_ONE = '33333333-3333-4333-8333-333333333333'
const ORG_TWO = '44444444-4444-4444-8444-444444444444'

type MockConnection = {
  execute: jest.Mock<Promise<Array<{ sequence: string }>>, [string, unknown[]]>
}

function makeEntityManager(sequences: string[]): { em: EntityManager; connection: MockConnection } {
  const remaining = [...sequences]
  const connection: MockConnection = {
    execute: jest.fn(async () => [{ sequence: remaining.shift() ?? '1' }]),
  }
  const em = {
    getConnection: () => connection,
    findOne: jest.fn(async () => null),
  } as unknown as EntityManager
  return { em, connection }
}

describe('WarrantyClaimNumberGenerator', () => {
  test.each<Array<[WarrantyClaimType, string]>>([
    ['warranty', 'WTY'],
    ['return', 'RMA'],
    ['core_return', 'COR'],
    ['vendor_recovery', 'VRC'],
  ])('uses the prefix for %s claims', async (claimType, prefix) => {
    const { em } = makeEntityManager(['7'])
    const generator = new WarrantyClaimNumberGenerator(em)

    await expect(generator.generate({ claimType, tenantId: TENANT_ONE, organizationId: ORG_ONE }))
      .resolves
      .toEqual({ number: `${prefix}-000007`, prefix, sequence: 7 })
  })

  test('zero-pads generated sequence numbers to six digits', async () => {
    const { em } = makeEntityManager(['42'])
    const generator = new WarrantyClaimNumberGenerator(em)

    const generated = await generator.generate({
      claimType: 'warranty',
      tenantId: TENANT_ONE,
      organizationId: ORG_ONE,
    })

    expect(generated.number).toBe('WTY-000042')
  })

  test('passes tenant, organization, and type into the sequence upsert', async () => {
    const { em, connection } = makeEntityManager(['1', '1', '1'])
    const generator = new WarrantyClaimNumberGenerator(em)

    await generator.generate({ claimType: 'warranty', tenantId: TENANT_ONE, organizationId: ORG_ONE })
    await generator.generate({ claimType: 'warranty', tenantId: TENANT_TWO, organizationId: ORG_ONE })
    await generator.generate({ claimType: 'return', tenantId: TENANT_ONE, organizationId: ORG_TWO })

    expect(connection.execute.mock.calls.map(([, params]) => params.slice(0, 3))).toEqual([
      [ORG_ONE, TENANT_ONE, 'warranty'],
      [ORG_ONE, TENANT_TWO, 'warranty'],
      [ORG_TWO, TENANT_ONE, 'return'],
    ])
  })
})
