/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../lib/wmsIntegrationToggles', () => ({
  resolveWmsIntegrationToggleEnabled: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveWmsIntegrationToggleEnabled } from '../../lib/wmsIntegrationToggles'
import handle, { buildProcurementGoodsReceiptSourceKey } from '../procurement-goods-receipt-created'

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)
const resolveToggleMock = jest.mocked(resolveWmsIntegrationToggleEnabled)

describe('procurement-goods-receipt-created subscriber', () => {
  const execute = jest.fn(async () => ({ result: { asnId: 'asn-1' } }))

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    resolveToggleMock.mockReset()
    execute.mockClear()
  })

  function createCtx() {
    return {
      resolve: (name: string) => {
        if (name === 'featureTogglesService') return {}
        if (name === 'em') {
          return {
            fork: () => ({}),
          }
        }
        if (name === 'commandBus') return { execute }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    }
  }

  const goodsReceiptId = '44444444-4444-4444-8444-444444444444'
  const sourceKey = buildProcurementGoodsReceiptSourceKey(goodsReceiptId)

  it('no-ops when the procurement integration toggle is disabled', async () => {
    resolveToggleMock.mockResolvedValue(false)
    await handle(
      {
        id: 'gr-1',
        warehouseId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      createCtx(),
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('creates a draft ASN when enabled and payload is usable', async () => {
    resolveToggleMock.mockResolvedValue(true)
    findOneWithDecryptionMock.mockResolvedValue(null)

    await handle(
      {
        id: goodsReceiptId,
        warehouseId: '11111111-1111-4111-8111-111111111111',
        vendorId: '55555555-5555-4555-8555-555555555555',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        lines: [
          {
            catalogVariantId: '66666666-6666-4666-8666-666666666666',
            expectedQty: 4,
          },
        ],
      },
      createCtx(),
    )

    expect(execute).toHaveBeenCalledWith(
      'wms.asns.create',
      expect.objectContaining({
        input: expect.objectContaining({
          warehouseId: '11111111-1111-4111-8111-111111111111',
          status: 'draft',
          referenceNumber: goodsReceiptId,
          sourceKey,
          lines: [
            expect.objectContaining({
              catalogVariantId: '66666666-6666-4666-8666-666666666666',
              expectedQty: 4,
            }),
          ],
        }),
      }),
    )
  })

  it('skips create when an ASN already exists for the goods receipt source key', async () => {
    resolveToggleMock.mockResolvedValue(true)
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: 'existing-asn', status: 'in_transit' })

    await handle(
      {
        id: goodsReceiptId,
        warehouseId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      createCtx(),
    )

    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        sourceKey,
        deletedAt: null,
      }),
      undefined,
      expect.anything(),
    )
    expect(findOneWithDecryptionMock.mock.calls[0]?.[2]).not.toHaveProperty('status')
    expect(execute).not.toHaveBeenCalled()
  })

  it('skips create for legacy ASNs matched by referenceNumber = goodsReceiptId', async () => {
    resolveToggleMock.mockResolvedValue(true)
    findOneWithDecryptionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'legacy-asn', status: 'draft' })

    await handle(
      {
        id: goodsReceiptId,
        warehouseId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      createCtx(),
    )

    expect(findOneWithDecryptionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        referenceNumber: goodsReceiptId,
        deletedAt: null,
      }),
      undefined,
      expect.anything(),
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('treats unique-constraint create races as idempotent success', async () => {
    resolveToggleMock.mockResolvedValue(true)
    findOneWithDecryptionMock.mockResolvedValue(null)
    execute.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))

    await expect(
      handle(
        {
          id: goodsReceiptId,
          warehouseId: '11111111-1111-4111-8111-111111111111',
          tenantId: '22222222-2222-4222-8222-222222222222',
          organizationId: '33333333-3333-4333-8333-333333333333',
        },
        createCtx(),
      ),
    ).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledWith(
      'wms.asns.create',
      expect.objectContaining({
        input: expect.objectContaining({ sourceKey }),
      }),
    )
  })

  it('uses free-form referenceNumber for display but still keys uniqueness on goods receipt id', async () => {
    resolveToggleMock.mockResolvedValue(true)
    findOneWithDecryptionMock.mockResolvedValue(null)

    await handle(
      {
        id: goodsReceiptId,
        referenceNumber: 'PO-12345',
        warehouseId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
      },
      createCtx(),
    )

    expect(execute).toHaveBeenCalledWith(
      'wms.asns.create',
      expect.objectContaining({
        input: expect.objectContaining({
          referenceNumber: 'PO-12345',
          sourceKey,
        }),
      }),
    )
  })
})
