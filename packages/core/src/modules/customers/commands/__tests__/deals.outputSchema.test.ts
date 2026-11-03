jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

describe('deal command outputSchema', () => {
  const validOutput = { dealId: '5f0b2f2a-8f6f-4a2f-9a1e-3c1d2e4f5a6b' }

  it('declares an outputSchema on customers.deals.update that parses a valid output', () => {
    const outputSchema = commandRegistry.outputSchemaOf('customers.deals.update')

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse(validOutput).success).toBe(true)
  })

  it('rejects payloads that are not a { dealId: uuid } object', () => {
    const outputSchema = commandRegistry.outputSchemaOf('customers.deals.update')

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse({ dealId: 'not-a-uuid' }).success).toBe(false)
    expect(outputSchema!.safeParse({}).success).toBe(false)
    expect(outputSchema!.safeParse('junk').success).toBe(false)
    expect(outputSchema!.safeParse(null).success).toBe(false)
  })

  it('declares the same trivial outputSchema on customers.deals.create', () => {
    const outputSchema = commandRegistry.outputSchemaOf('customers.deals.create')

    expect(outputSchema).not.toBeNull()
    expect(outputSchema!.safeParse(validOutput).success).toBe(true)
    expect(outputSchema!.safeParse({ dealId: 'not-a-uuid' }).success).toBe(false)
  })
})
