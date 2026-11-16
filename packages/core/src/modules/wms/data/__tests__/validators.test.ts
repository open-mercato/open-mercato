/** @jest-environment node */

import { z } from 'zod'
import {
  asnCreatePublicSchema,
  asnCreateSchema,
  asnReceiveLineSchema,
  asnUpdateSchema,
  inventoryAdjustSchema,
  inventoryCycleCountSchema,
  productInventoryProfileCreateSchema,
  putawayTaskCompleteSchema,
  putawayTaskCreateFromBalanceSchema,
  putawayTaskCreateSchema,
  putawayTaskUpdateSchema,
  receivingLineCreateSchema,
  receivingLineUpdateSchema,
  scanPutawaySchema,
  scanReceiveSchema,
  scanResolveLocationSchema,
  scanResolveLotSchema,
  warehouseCreateSchema,
  warehouseLocationCreateSchema,
  warehouseUpdateSchema,
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

  it('rejects inactive warehouses marked as primary', () => {
    expect(() =>
      warehouseCreateSchema.parse({
        ...scoped,
        name: 'Inactive Primary',
        code: 'INACTIVE-PRIMARY',
        isPrimary: true,
        isActive: false,
      }),
    ).toThrow(/Inactive warehouses cannot be marked as primary/i)

    expect(() =>
      warehouseUpdateSchema.parse({
        id: '33333333-3333-4333-8333-333333333333',
        isPrimary: true,
        isActive: false,
      }),
    ).toThrow(/Inactive warehouses cannot be marked as primary/i)
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

  it('requires warehouse and expectedAt for ASN create', () => {
    expect(() =>
      asnCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
      }),
    ).toThrow(z.ZodError)

    expect(
      asnCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        expectedAt: '2026-08-12T12:00:00.000Z',
        vendorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lines: [
          {
            catalogVariantId: '77777777-7777-4777-8777-777777777777',
            expectedQty: 10,
          },
        ],
      }),
    ).toMatchObject({
      warehouseId: '55555555-5555-4555-8555-555555555555',
      lines: [{ expectedQty: 10 }],
    })
  })

  it('public ASN create omits sourceKey so clients cannot spoof procurement linkage', () => {
    const parsed = asnCreatePublicSchema.parse({
      ...scoped,
      warehouseId: '55555555-5555-4555-8555-555555555555',
      expectedAt: '2026-08-12T12:00:00.000Z',
      sourceKey: 'procurement.goods_receipt:spoof',
    })
    expect(parsed).not.toHaveProperty('sourceKey')
    expect(
      asnCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        expectedAt: '2026-08-12T12:00:00.000Z',
        sourceKey: 'procurement.goods_receipt:ok',
      }).sourceKey,
    ).toBe('procurement.goods_receipt:ok')
  })

  it('ASN create/update status may only be draft or in_transit', () => {
    expect(() =>
      asnCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        expectedAt: '2026-08-12T12:00:00.000Z',
        status: 'received',
      }),
    ).toThrow(z.ZodError)

    expect(() =>
      asnUpdateSchema.parse({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'closed',
      }),
    ).toThrow(z.ZodError)

    expect(
      asnUpdateSchema.parse({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'in_transit',
      }),
    ).toMatchObject({ status: 'in_transit' })
  })

  it('requires positive expectedQty on receiving lines', () => {
    expect(() =>
      receivingLineCreateSchema.parse({
        ...scoped,
        asnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        expectedQty: 0,
      }),
    ).toThrow(z.ZodError)
  })

  it('rejects lifecycle fields on receiving-line and putaway CRUD updates (422 before strip)', () => {
    // Schema still strips unknown keys if they reach parse — routes/commands MUST
    // call assert*LifecycleFieldsForbidden on the raw body first.
    expect(
      receivingLineUpdateSchema.parse({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ...scoped,
        expectedQty: 8,
        receivedQty: 3,
        qcStatus: 'passed',
        rejectionReason: 'ignored',
      }),
    ).toMatchObject({ expectedQty: 8 })
    expect(
      receivingLineUpdateSchema.parse({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        expectedQty: 8,
        receivedQty: 3,
        qcStatus: 'passed',
      }),
    ).not.toHaveProperty('receivedQty')
    // asnId is not updatable via line CRUD (parent linkage is fixed at create).
    expect(
      receivingLineUpdateSchema.parse({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        asnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expectedQty: 8,
      }),
    ).not.toHaveProperty('asnId')

    expect(
      putawayTaskUpdateSchema.parse({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        priority: 2,
        status: 'done',
        assignedTo: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toEqual({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      priority: 2,
    })
  })

  it('accepts ASN receive absolute target / idempotency key for retry safety', () => {
    const base = {
      ...scoped,
      asnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      receivedQty: 4,
      performedBy: '99999999-9999-4999-8999-999999999999',
    }
    expect(
      asnReceiveLineSchema.parse({
        ...base,
        qcStatus: 'passed',
        targetStagingLocationId: '66666666-6666-4666-8666-666666666666',
        targetReceivedQty: 4,
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toMatchObject({
      targetReceivedQty: 4,
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
  })

  it('rejects ASN receive without targetReceivedQty for QC-pass and QC-fail', () => {
    const base = {
      ...scoped,
      asnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      receivedQty: 4,
      performedBy: '99999999-9999-4999-8999-999999999999',
      targetStagingLocationId: '66666666-6666-4666-8666-666666666666',
    }
    for (const qcStatus of ['passed', 'failed'] as const) {
      const missingTarget = asnReceiveLineSchema.safeParse({ ...base, qcStatus })
      expect(missingTarget.success).toBe(false)
      if (!missingTarget.success) {
        expect(
          missingTarget.error.issues.some((issue) => issue.message === 'target_received_qty_required'),
        ).toBe(true)
      }
      const idempotencyOnly = asnReceiveLineSchema.safeParse({
        ...base,
        qcStatus,
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
      expect(idempotencyOnly.success).toBe(false)
    }
  })

  it('accepts ASN receive payloads with QC pass or fail', () => {
    const base = {
      ...scoped,
      asnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lineId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      receivedQty: 4,
      performedBy: '99999999-9999-4999-8999-999999999999',
    }
    expect(
      asnReceiveLineSchema.parse({
        ...base,
        qcStatus: 'passed',
        targetStagingLocationId: '66666666-6666-4666-8666-666666666666',
        targetReceivedQty: 4,
      }),
    ).toMatchObject({ qcStatus: 'passed' })

    expect(
      asnReceiveLineSchema.parse({
        ...base,
        qcStatus: 'failed',
        targetReceivedQty: 4,
        rejectionReason: 'Damaged carton',
      }),
    ).toMatchObject({ qcStatus: 'failed', targetReceivedQty: 4 })
  })

  it('allows null targetLocationId on putaway create (MVP)', () => {
    expect(
      putawayTaskCreateSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: '66666666-6666-4666-8666-666666666666',
        targetLocationId: null,
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        quantity: 5,
      }),
    ).toMatchObject({ targetLocationId: null, quantity: 5 })

    expect(() =>
      putawayTaskCreateFromBalanceSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: '66666666-6666-4666-8666-666666666666',
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        quantity: 5,
      }),
    ).toThrow(z.ZodError)

    expect(
      putawayTaskCompleteSchema.parse({
        ...scoped,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        confirmedQuantity: 5,
        targetLocationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ confirmedQuantity: 5 })
  })

  it('accepts barcode scan resolve/receive/putaway payloads', () => {
    expect(
      scanResolveLocationSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        code: 'STG-A',
      }),
    ).toMatchObject({ code: 'STG-A' })

    expect(
      scanResolveLotSchema.parse({
        ...scoped,
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        lotNumber: 'LOT-1',
      }),
    ).toMatchObject({ lotNumber: 'LOT-1' })

    expect(
      scanReceiveSchema.parse({
        ...scoped,
        asnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        locationCode: 'STG-A',
        receivedQty: 3,
        targetReceivedQty: 3,
        qcStatus: 'passed',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ locationCode: 'STG-A', receivedQty: 3, targetReceivedQty: 3 })

    // Receive requires absolute target for QC-pass and QC-fail (no prior+delta fill).
    const omitTarget = scanReceiveSchema.safeParse({
      ...scoped,
      asnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      locationCode: 'STG-A',
      receivedQty: 3,
      qcStatus: 'passed',
      performedBy: '99999999-9999-4999-8999-999999999999',
    })
    expect(omitTarget.success).toBe(false)
    if (!omitTarget.success) {
      expect(
        omitTarget.error.issues.some((issue) => issue.message === 'target_received_qty_required'),
      ).toBe(true)
    }
    expect(
      scanReceiveSchema.safeParse({
        ...scoped,
        asnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        locationCode: 'STG-A',
        receivedQty: 3,
        qcStatus: 'passed',
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }).success,
    ).toBe(false)
    expect(
      scanReceiveSchema.safeParse({
        ...scoped,
        asnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        locationCode: 'STG-A',
        receivedQty: 3,
        qcStatus: 'failed',
        rejectionReason: 'Damaged',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }).success,
    ).toBe(false)

    expect(
      scanReceiveSchema.parse({
        ...scoped,
        asnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        locationCode: 'STG-A',
        receivedQty: 3,
        targetReceivedQty: 3,
        qcStatus: 'failed',
        rejectionReason: 'Damaged',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ qcStatus: 'failed', targetReceivedQty: 3 })

    expect(
      scanPutawaySchema.parse({
        ...scoped,
        taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        targetLocationCode: 'BIN-1',
        confirmedQuantity: 2,
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ targetLocationCode: 'BIN-1', confirmedQuantity: 2 })
  })

  it('defaults autoAdjust to true for cycle count payloads', () => {
    expect(
      inventoryCycleCountSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        locationId: '66666666-6666-4666-8666-666666666666',
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        countedQuantity: 10,
        reason: 'cycle_count',
        referenceId: '88888888-8888-4888-8888-888888888888',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ autoAdjust: true })

    expect(
      inventoryCycleCountSchema.parse({
        ...scoped,
        warehouseId: '55555555-5555-4555-8555-555555555555',
        locationId: '66666666-6666-4666-8666-666666666666',
        catalogVariantId: '77777777-7777-4777-8777-777777777777',
        countedQuantity: 10,
        autoAdjust: false,
        reason: 'cycle_count',
        referenceId: '88888888-8888-4888-8888-888888888888',
        performedBy: '99999999-9999-4999-8999-999999999999',
      }),
    ).toMatchObject({ autoAdjust: false })
  })
})
