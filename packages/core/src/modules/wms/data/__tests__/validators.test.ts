/** @jest-environment node */

import { z } from 'zod'
import {
  inventoryAdjustSchema,
  productInventoryProfileCreateSchema,
  warehouseLocationCreateSchema,
} from '../validators'

describe('wms validator rules', () => {
  const scoped = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
  }

  it('rejects expiration tracking profiles unless FEFO is selected', () => {
    expect(() =>
      productInventoryProfileCreateSchema.parse({
        ...scoped,
        catalogProductId: '33333333-3333-4333-8333-333333333333',
        catalogVariantId: '44444444-4444-4444-8444-444444444444',
        defaultUom: 'pcs',
        trackExpiration: true,
        defaultStrategy: 'fifo',
      }),
    ).toThrow(/FEFO is required when expiration tracking is enabled/i)

    expect(
      productInventoryProfileCreateSchema.parse({
        ...scoped,
        catalogProductId: '33333333-3333-4333-8333-333333333333',
        catalogVariantId: '44444444-4444-4444-8444-444444444444',
        defaultUom: 'pcs',
        trackExpiration: true,
        defaultStrategy: 'fefo',
      }),
    ).toMatchObject({
      defaultStrategy: 'fefo',
      trackExpiration: true,
    })
  })

  it('rejects negative location capacities', () => {
    expect(() =>
      warehouseLocationCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        code: 'BIN-A1',
        type: 'bin',
        capacityUnits: -1,
      }),
    ).toThrow(z.ZodError)

    expect(() =>
      warehouseLocationCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        code: 'BIN-A1',
        type: 'bin',
        capacityWeight: -0.01,
      }),
    ).toThrow(z.ZodError)
  })

  it('rejects zero-quantity inventory adjustments', () => {
    expect(() =>
      inventoryAdjustSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        locationId: '66666666-6666-4666-8666-666666666666',
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        delta: 0,
        reason: 'No-op adjustment',
        referenceType: 'manual',
        referenceId: '88888888-8888-4888-8888-888888888888',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toThrow(/non-zero/i)
  })
})
