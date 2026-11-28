import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { E } from '#generated/entities.ids.generated'
import { SalesDocumentAddress, SalesQuote } from '../../data/entities'
import '../documentAddresses'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (entityClass: unknown) => unknown }, entityClass: unknown) =>
    em.findOne(entityClass),
  ),
}))

const identifiers = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
}

function fixture() {
  const input = {
    ...identifiers,
    documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    documentKind: 'quote' as const,
    addressLine1: '1 Test Street',
  }
  const address = Object.assign(new SalesDocumentAddress(), input)
  const quote = Object.assign(new SalesQuote(), { id: input.documentId })
  const em = {
    findOne: jest.fn((entityClass: unknown) => entityClass === SalesDocumentAddress ? address : quote),
    fork: jest.fn().mockReturnThis(),
    create: jest.fn().mockReturnValue(address),
    persist: jest.fn().mockReturnThis(),
    remove: jest.fn().mockReturnThis(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const markOrmEntityChange = jest.fn()
  const ctx = {
    container: { resolve: (name: string) => name === 'em' ? em : { markOrmEntityChange } },
    auth: { tenantId: input.tenantId, orgId: input.organizationId },
    selectedOrganizationId: input.organizationId,
    organizationIds: [input.organizationId],
  } as unknown as CommandRuntimeContext
  return { input, address, em, ctx, markOrmEntityChange }
}

describe('sales document address indexing', () => {
  it.each([
    ['create', 'created'],
    ['update', 'updated'],
    ['delete', 'deleted'],
  ])('marks a scoped index change after %s flushes', async (command, action) => {
    const { input, address, em, ctx, markOrmEntityChange } = fixture()
    em.flush.mockImplementation(async () => {
      expect(markOrmEntityChange).not.toHaveBeenCalled()
    })

    const handler = commandRegistry.get('sales.document-addresses.' + command)
    expect(handler).toBeDefined()
    await handler?.execute(input, ctx)

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
    expect(markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action,
      identifiers,
      indexer: { entityType: E.sales.sales_document_address },
    }))
    expect(markOrmEntityChange.mock.calls[0][0].entity).toBe(address)
  })

  it('does not mark an index change when create fails to flush', async () => {
    const { input, em, ctx, markOrmEntityChange } = fixture()
    em.flush.mockRejectedValueOnce(new Error('test persistence failure'))

    const handler = commandRegistry.get('sales.document-addresses.create')
    expect(handler).toBeDefined()
    await expect(handler?.execute(input, ctx)).rejects.toThrow('test persistence failure')

    expect(markOrmEntityChange).not.toHaveBeenCalled()
  })
})
