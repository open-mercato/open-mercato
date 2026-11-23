/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { seedSalesStatusDictionaries } from '../dictionaries'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

describe('seedSalesStatusDictionaries', () => {
  it('leaves the deal loss-reason dictionary to the customers module', async () => {
    const createdKeys = new Set<string>()
    const em = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity === 'Dictionary' && typeof data.key === 'string') createdKeys.add(data.key)
        return { id: `created-${createdKeys.size}`, ...data }
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    await seedSalesStatusDictionaries(em, {
      tenantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      organizationId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    })

    expect([...createdKeys]).toContain('sales.order_status')
    expect([...createdKeys]).not.toContain('sales.deal_loss_reason')
  })
})
