import {
  buildTaxInfo,
  normalizeTaxProviderResult,
  parseTaxInfo,
  taxInfoSchema,
  taxProviderResultSchema,
} from '../providers/taxInfo'

const jurisdiction = {
  jurisdictionCode: 'US-CA',
  jurisdictionName: 'California',
  jurisdictionType: 'state' as const,
  taxName: 'CA State Tax',
  rate: 0.0725,
  taxableAmount: 100,
  taxAmount: 7.25,
  exemptAmount: 0,
}

describe('taxProviderResultSchema', () => {
  it('accepts the documented result shape', () => {
    const parsed = taxProviderResultSchema.safeParse({
      status: 'calculated',
      lines: [
        {
          lineId: 'line-1',
          taxAmount: 7.25,
          taxableAmount: 100,
          exemptAmount: 0,
          rate: 0.0725,
          details: [jurisdiction],
        },
      ],
      charges: [{ chargeId: 'shipping', taxAmount: 0.73, taxableAmount: 10, rate: 0.0725, details: [] }],
      totals: { taxTotal: 7.98, taxableTotal: 110, exemptTotal: 0 },
      breakdown: [jurisdiction],
      transaction: { reference: 'txn-1', state: 'estimate' },
      messages: [{ level: 'info', code: 'ok', text: 'calculated' }],
      calculatedAt: '2026-09-19T00:00:00.000Z',
      metadata: { engineVersion: '2' },
    })
    expect(parsed.success).toBe(true)
  })

  it('fills the optional collections so the stage never sees undefined', () => {
    const parsed = taxProviderResultSchema.parse({
      status: 'exempt',
      lines: [{ lineId: 'line-1', taxAmount: 0 }],
      totals: { taxTotal: 0, taxableTotal: 100, exemptTotal: 100 },
    })
    expect(parsed.charges).toEqual([])
    expect(parsed.breakdown).toEqual([])
    expect(parsed.messages).toEqual([])
    expect(parsed.metadata).toEqual({})
    expect(parsed.lines[0]).toMatchObject({ taxableAmount: 0, exemptAmount: 0, rate: null, details: [] })
  })

  it('strips unknown top level keys instead of rejecting the result', () => {
    const parsed = taxProviderResultSchema.parse({
      status: 'calculated',
      lines: [],
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
      vendorOnlyField: 'ignored',
    })
    expect(parsed).not.toHaveProperty('vendorOnlyField')
  })

  it('rejects an unknown status', () => {
    const parsed = taxProviderResultSchema.safeParse({
      status: 'partially-calculated',
      lines: [],
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a non finite amount', () => {
    const parsed = taxProviderResultSchema.safeParse({
      status: 'calculated',
      lines: [{ lineId: 'line-1', taxAmount: Number.NaN }],
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('normalizeTaxProviderResult', () => {
  it('rounds every amount and rate to four decimals', () => {
    const normalized = normalizeTaxProviderResult({
      status: 'calculated',
      lines: [
        {
          lineId: 'line-1',
          taxAmount: 7.2512349,
          taxableAmount: 100.000049,
          exemptAmount: 0.000049,
          rate: 0.07254321,
          details: [{ ...jurisdiction, taxAmount: 7.2512349 }],
        },
      ],
      charges: [{ chargeId: 'shipping', taxAmount: 0.725123, taxableAmount: 10.00004, rate: 0.0725 }],
      totals: { taxTotal: 7.9763579, taxableTotal: 110.00009, exemptTotal: 0 },
      breakdown: [{ ...jurisdiction, taxAmount: 7.9763579 }],
    })
    expect(normalized).not.toBeNull()
    expect(normalized!.lines[0].taxAmount).toBe(7.2512)
    expect(normalized!.lines[0].taxableAmount).toBe(100)
    expect(normalized!.lines[0].exemptAmount).toBe(0)
    expect(normalized!.lines[0].rate).toBe(0.0725)
    expect(normalized!.lines[0].details[0].taxAmount).toBe(7.2512)
    expect(normalized!.charges[0].taxAmount).toBe(0.7251)
    expect(normalized!.totals.taxTotal).toBe(7.9764)
    expect(normalized!.breakdown[0].taxAmount).toBe(7.9764)
  })

  it('returns null for a result the contract does not describe', () => {
    expect(normalizeTaxProviderResult({ status: 'calculated' })).toBeNull()
    expect(normalizeTaxProviderResult({ status: 'calculated', lines: [] })).toBeNull()
    expect(normalizeTaxProviderResult(null)).toBeNull()
    expect(normalizeTaxProviderResult('not a result')).toBeNull()
  })
})

describe('taxInfoSchema', () => {
  const base = {
    version: 1 as const,
    providerKey: 'table-rates',
    status: 'calculated' as const,
    calculatedAt: '2026-09-19T00:00:00.000Z',
    intent: 'estimate' as const,
    totals: { taxTotal: 7.25, taxableTotal: 100, exemptTotal: 0 },
    transaction: { reference: null, state: 'estimate' as const },
  }

  it('accepts the documented persisted shape', () => {
    expect(taxInfoSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a failure record without a code', () => {
    const parsed = taxInfoSchema.safeParse({
      ...base,
      status: 'fallback',
      failure: { message: 'boom', at: '2026-09-19T00:00:00.000Z', providerKey: 'avalara' },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty failure code', () => {
    const parsed = taxInfoSchema.safeParse({
      ...base,
      status: 'fallback',
      failure: { code: '', message: 'boom', at: '2026-09-19T00:00:00.000Z', providerKey: 'avalara' },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a version other than 1', () => {
    expect(taxInfoSchema.safeParse({ ...base, version: 2 }).success).toBe(false)
  })

  it('parseTaxInfo returns null for a malformed document', () => {
    expect(parseTaxInfo({ version: 1 })).toBeNull()
    expect(parseTaxInfo(null)).toBeNull()
  })
})

describe('buildTaxInfo', () => {
  it('carries the provider result through and labels every charge with its kind', () => {
    const result = normalizeTaxProviderResult({
      status: 'calculated',
      lines: [{ lineId: 'line-1', taxAmount: 7.25, taxableAmount: 100, rate: 0.0725, details: [jurisdiction] }],
      charges: [{ chargeId: 'adj-1', taxAmount: 0.73, taxableAmount: 10, rate: 0.0725 }],
      totals: { taxTotal: 7.98, taxableTotal: 110, exemptTotal: 0 },
      breakdown: [jurisdiction],
      calculatedAt: '2026-09-19T10:00:00.000Z',
    })
    const info = buildTaxInfo({
      providerKey: 'fixed-rate',
      status: 'calculated',
      intent: 'estimate',
      result,
      chargeKinds: { 'adj-1': 'shipping' },
    })
    expect(info.providerKey).toBe('fixed-rate')
    expect(info.calculatedAt).toBe('2026-09-19T10:00:00.000Z')
    expect(info.charges).toEqual([
      expect.objectContaining({ chargeId: 'adj-1', kind: 'shipping', taxAmount: 0.73 }),
    ])
    expect(info.breakdown).toHaveLength(1)
    expect(info.failure).toBeNull()
    expect(info.transaction).toEqual({ reference: null, state: 'estimate' })
  })

  it('defaults an unmapped charge to the custom kind', () => {
    const result = normalizeTaxProviderResult({
      status: 'calculated',
      lines: [],
      charges: [{ chargeId: 'adj-9', taxAmount: 1 }],
      totals: { taxTotal: 1, taxableTotal: 10, exemptTotal: 0 },
    })
    const info = buildTaxInfo({
      providerKey: 'fixed-rate',
      status: 'calculated',
      intent: 'estimate',
      result,
      chargeKinds: {},
    })
    expect(info.charges[0].kind).toBe('custom')
  })

  it('records a fallback with its failure and zeroed provider totals', () => {
    const info = buildTaxInfo({
      providerKey: 'avalara',
      status: 'fallback',
      intent: 'estimate',
      result: null,
      chargeKinds: {},
      failure: {
        code: 'timeout',
        message: 'provider did not answer in time',
        at: '2026-09-19T10:00:00.000Z',
        providerKey: 'avalara',
      },
      messages: [{ level: 'warning', code: 'timeout', text: 'Tax is an estimate' }],
      calculatedAt: '2026-09-19T10:00:00.000Z',
    })
    expect(info.status).toBe('fallback')
    expect(info.totals).toEqual({ taxTotal: 0, taxableTotal: 0, exemptTotal: 0 })
    expect(info.lines).toEqual([])
    expect(info.failure?.code).toBe('timeout')
    expect(info.messages).toEqual([{ level: 'warning', code: 'timeout', text: 'Tax is an estimate' }])
  })

  it('appends core messages after the provider messages', () => {
    const result = normalizeTaxProviderResult({
      status: 'calculated',
      lines: [],
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
      messages: [{ level: 'info', code: 'from_provider', text: 'provider note' }],
    })
    const info = buildTaxInfo({
      providerKey: 'fixed-rate',
      status: 'calculated',
      intent: 'estimate',
      result,
      chargeKinds: {},
      messages: [{ level: 'info', code: 'inherited', text: 'Inherited from order SO-1' }],
    })
    expect(info.messages.map((message) => message.code)).toEqual(['from_provider', 'inherited'])
  })
})
