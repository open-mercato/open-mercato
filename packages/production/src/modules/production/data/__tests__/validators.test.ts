import { describe, it, expect } from '@jest/globals'
import {
  workCenterCreateSchema,
  bomCreateSchema,
  bomItemInputSchema,
  routingCreateSchema,
  routingOperationInputSchema,
  planningParamsCreateSchema,
} from '../validators'

describe('workCenterCreateSchema', () => {
  const valid = {
    name: 'CNC-1',
    kind: 'machine' as const,
    costRatePerHour: 50,
  }

  it('accepts a valid payload', () => {
    const parsed = workCenterCreateSchema.parse(valid)
    expect(parsed.name).toBe('CNC-1')
    expect(parsed.parallelStations).toBe(1)
    expect(parsed.isActive).toBe(true)
  })

  it('rejects a negative cost rate', () => {
    expect(() => workCenterCreateSchema.parse({ ...valid, costRatePerHour: -10 })).toThrow()
  })

  it('rejects an invalid kind', () => {
    expect(() => workCenterCreateSchema.parse({ ...valid, kind: 'bogus' })).toThrow()
  })

  it('rejects a missing name', () => {
    expect(() => workCenterCreateSchema.parse({ ...valid, name: '' })).toThrow()
  })
})

describe('bomItemInputSchema', () => {
  const valid = {
    componentProductId: '11111111-1111-4111-8111-111111111111',
    qtyPerUnit: 2,
    uom: 'PCS',
  }

  it('accepts a valid item and applies defaults', () => {
    const parsed = bomItemInputSchema.parse(valid)
    expect(parsed.scrapFactor).toBe(0)
    expect(parsed.isPhantom).toBe(false)
  })

  it('rejects a negative/zero qtyPerUnit', () => {
    expect(() => bomItemInputSchema.parse({ ...valid, qtyPerUnit: 0 })).toThrow()
    expect(() => bomItemInputSchema.parse({ ...valid, qtyPerUnit: -1 })).toThrow()
  })

  it('rejects a bad uom code', () => {
    expect(() => bomItemInputSchema.parse({ ...valid, uom: '' })).toThrow()
    expect(() => bomItemInputSchema.parse({ ...valid, uom: 'p c s!' })).toThrow()
  })

  it('rejects a missing componentProductId', () => {
    expect(() => bomItemInputSchema.parse({ ...valid, componentProductId: undefined })).toThrow()
  })
})

describe('bomCreateSchema', () => {
  const valid = {
    productId: '11111111-1111-4111-8111-111111111111',
    name: 'Widget BOM',
  }

  it('accepts a valid payload with defaults', () => {
    const parsed = bomCreateSchema.parse(valid)
    expect(parsed.status).toBe('draft')
    expect(parsed.items).toEqual([])
  })

  it('rejects an invalid status', () => {
    expect(() => bomCreateSchema.parse({ ...valid, status: 'bogus' })).toThrow()
  })

  it('rejects a missing productId', () => {
    expect(() => bomCreateSchema.parse({ name: 'Widget BOM' })).toThrow()
  })
})

describe('routingOperationInputSchema', () => {
  const valid = {
    sequence: 1,
    name: 'Cut',
    workCenterId: '11111111-1111-4111-8111-111111111111',
  }

  it('accepts a valid operation and applies defaults', () => {
    const parsed = routingOperationInputSchema.parse(valid)
    expect(parsed.setupTimeMinutes).toBe(0)
    expect(parsed.isReportingPoint).toBe(false)
  })

  it('rejects a sequence below 1', () => {
    expect(() => routingOperationInputSchema.parse({ ...valid, sequence: 0 })).toThrow()
  })

  it('rejects a missing workCenterId', () => {
    expect(() => routingOperationInputSchema.parse({ ...valid, workCenterId: undefined })).toThrow()
  })
})

describe('routingCreateSchema', () => {
  it('rejects an invalid status', () => {
    expect(() =>
      routingCreateSchema.parse({
        productId: '11111111-1111-4111-8111-111111111111',
        name: 'Widget routing',
        status: 'bogus',
      }),
    ).toThrow()
  })
})

describe('planningParamsCreateSchema', () => {
  const valid = {
    productId: '11111111-1111-4111-8111-111111111111',
    procurement: 'make' as const,
  }

  it('accepts a valid payload with defaults', () => {
    const parsed = planningParamsCreateSchema.parse(valid)
    expect(parsed.leadTimeDays).toBe(0)
    expect(parsed.backflush).toBe(true)
  })

  it('rejects an invalid procurement value', () => {
    expect(() => planningParamsCreateSchema.parse({ ...valid, procurement: 'bogus' })).toThrow()
  })

  it('rejects a negative safety stock', () => {
    expect(() => planningParamsCreateSchema.parse({ ...valid, safetyStock: -1 })).toThrow()
  })
})
