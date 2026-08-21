import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DefaultSalesOrderService } from '../salesOrderService'
import { SalesOrder } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<
  typeof findOneWithDecryption
>

describe('DefaultSalesOrderService.findByExternalReference', () => {
  const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('looks up a non-deleted order by external reference within the tenant scope, decrypting fields', async () => {
    const order = { id: 'order-1', externalReference: 'MAGENTO-100000123' } as SalesOrder
    findOneWithDecryptionMock.mockResolvedValue(order)
    const em = {} as any
    const service = new DefaultSalesOrderService(em)

    const result = await service.findByExternalReference('MAGENTO-100000123', scope)

    expect(result).toBe(order)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      SalesOrder,
      {
        externalReference: 'MAGENTO-100000123',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      },
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('returns null when no matching order exists', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const service = new DefaultSalesOrderService({} as any)

    const result = await service.findByExternalReference('MAGENTO-404', scope)

    expect(result).toBeNull()
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits to null without querying for a blank reference', async () => {
    const service = new DefaultSalesOrderService({} as any)

    const result = await service.findByExternalReference('', scope)

    expect(result).toBeNull()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })
})
