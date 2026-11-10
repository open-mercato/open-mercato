import {
  buildPlaceholderFromLedger,
  resolveStepSample,
  type PinnedSampleEnvelope,
  type SampleLedgerEntry,
} from '../sample-resolver'

const pinnedSamples: Record<string, PinnedSampleEnvelope> = {
  step_1: { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'manual', data: { orderId: 'ord_42' } },
}

const ledgerEntries: SampleLedgerEntry[] = [
  { path: 'orderId', type: 'text' },
  { path: 'total', type: 'number' },
]

describe('resolveStepSample precedence', () => {
  it('prefers an explicit pin over test output and ledger entries', () => {
    const resolved = resolveStepSample({
      stepId: 'step_1',
      samples: pinnedSamples,
      testOutputs: { step_1: { orderId: 'from-test' } },
      ledgerEntries,
    })
    expect(resolved).toEqual({ data: { orderId: 'ord_42' }, source: 'pin' })
  })

  it('falls back to the in-memory test output when no pin exists', () => {
    const resolved = resolveStepSample({
      stepId: 'step_2',
      samples: pinnedSamples,
      testOutputs: { step_2: { simulated: true } },
      ledgerEntries,
    })
    expect(resolved).toEqual({ data: { simulated: true }, source: 'test' })
  })

  it('serves a test output even when its value is null', () => {
    const resolved = resolveStepSample({
      stepId: 'step_2',
      testOutputs: { step_2: null },
      ledgerEntries,
    })
    expect(resolved).toEqual({ data: null, source: 'test' })
  })

  it('synthesizes a placeholder from ledger entries when neither pin nor test output exists', () => {
    const resolved = resolveStepSample({ stepId: 'step_3', samples: pinnedSamples, ledgerEntries })
    expect(resolved).toEqual({ data: { orderId: 'text', total: 0 }, source: 'placeholder' })
  })

  it('returns null when nothing is available', () => {
    expect(resolveStepSample({ stepId: 'step_9' })).toBeNull()
    expect(resolveStepSample({ stepId: 'step_9', samples: {}, testOutputs: {}, ledgerEntries: [] })).toBeNull()
    expect(resolveStepSample({ stepId: 'step_9', samples: null, testOutputs: null, ledgerEntries: null })).toBeNull()
  })
})

describe('buildPlaceholderFromLedger', () => {
  it('maps each ledger type to its placeholder value', () => {
    const placeholder = buildPlaceholderFromLedger([
      { path: 'name', type: 'text' },
      { path: 'count', type: 'number' },
      { path: 'approved', type: 'boolean' },
      { path: 'dueAt', type: 'date' },
      { path: 'status', type: 'select', options: ['open', 'closed'] },
      { path: 'stage', type: 'select' },
      { path: 'payload', type: 'object' },
      { path: 'mystery', type: 'unknown' },
    ])
    expect(placeholder).toEqual({
      name: 'text',
      count: 0,
      approved: false,
      dueAt: '2026-01-01T00:00:00.000Z',
      status: 'open',
      stage: 'option',
      payload: {},
      mystery: null,
    })
  })

  it('nests dot paths into objects', () => {
    const placeholder = buildPlaceholderFromLedger([
      { path: 'customer.name', type: 'text' },
      { path: 'customer.address.zip', type: 'text' },
      { path: 'customer.vip', type: 'boolean' },
    ])
    expect(placeholder).toEqual({
      customer: { name: 'text', address: { zip: 'text' }, vip: false },
    })
  })

  it('keeps nested children when a parent object entry arrives after them', () => {
    const placeholder = buildPlaceholderFromLedger([
      { path: 'result.id', type: 'text' },
      { path: 'result', type: 'object' },
    ])
    expect(placeholder).toEqual({ result: { id: 'text' } })
  })

  it('descends into a parent object entry declared before its children', () => {
    const placeholder = buildPlaceholderFromLedger([
      { path: 'result', type: 'object' },
      { path: 'result.id', type: 'text' },
    ])
    expect(placeholder).toEqual({ result: { id: 'text' } })
  })
})
