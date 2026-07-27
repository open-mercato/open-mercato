/** @jest-environment node */
import { computeCostMinor, resolveModelPrice } from '../lib/runtime/modelPricing'

describe('modelPricing — Q8 minimal pricing config', () => {
  const envBackup = { pricing: process.env.OM_AGENT_MODEL_PRICING, currency: process.env.OM_AGENT_COST_CURRENCY }
  afterEach(() => {
    if (envBackup.pricing === undefined) delete process.env.OM_AGENT_MODEL_PRICING
    else process.env.OM_AGENT_MODEL_PRICING = envBackup.pricing
    if (envBackup.currency === undefined) delete process.env.OM_AGENT_COST_CURRENCY
    else process.env.OM_AGENT_COST_CURRENCY = envBackup.currency
    jest.restoreAllMocks()
  })

  it('computes the estimated cost for a known model (spec formula, cents)', () => {
    delete process.env.OM_AGENT_MODEL_PRICING
    delete process.env.OM_AGENT_COST_CURRENCY
    // claude-sonnet-4-5 defaults: 3 / 15 USD per 1M.
    // (200_000 × 3 + 100_000 × 15) / 1M × 100 = (0.6 + 1.5) × 100 = 210 cents.
    expect(computeCostMinor('claude-sonnet-4-5', 200_000, 100_000)).toEqual({
      costMinor: 210,
      currency: 'USD',
    })
  })

  it('returns null for an unknown model — never a guess', () => {
    expect(computeCostMinor('some-unknown-model', 1000, 1000)).toBeNull()
    expect(resolveModelPrice('some-unknown-model')).toBeNull()
  })

  it('returns null when no token counts exist', () => {
    expect(computeCostMinor('gpt-5-mini', null, null)).toBeNull()
    expect(computeCostMinor(null, 100, 100)).toBeNull()
  })

  it('resolves slash-qualified and date-suffixed model ids', () => {
    expect(resolveModelPrice('anthropic/claude-sonnet-4-5')).not.toBeNull()
    expect(resolveModelPrice('claude-haiku-4-5-20251001')).not.toBeNull()
    expect(resolveModelPrice('openai/gpt-4o-mini')).not.toBeNull()
  })

  it('env override wins over the code defaults and adds new models', () => {
    process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({
      'gpt-5-mini': { inputPer1M: 1, outputPer1M: 2 },
      'my-custom-model': { inputPer1M: 10, outputPer1M: 20 },
    })
    // Overridden: 1M in × 1 + 1M out × 2 = 3 USD = 300 cents.
    expect(computeCostMinor('gpt-5-mini', 1_000_000, 1_000_000)).toEqual({
      costMinor: 300,
      currency: 'USD',
    })
    expect(resolveModelPrice('my-custom-model')).toMatchObject({ inputPer1M: 10, outputPer1M: 20 })
    // Non-overridden defaults survive the merge.
    expect(resolveModelPrice('gpt-4o')).not.toBeNull()
  })

  it('falls back to defaults on malformed env JSON (with an internal warning)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.OM_AGENT_MODEL_PRICING = '{not json'
    expect(resolveModelPrice('gpt-5-mini')).toMatchObject({ inputPer1M: 0.25, outputPer1M: 2 })
    expect(warn).toHaveBeenCalled()
  })

  it('skips malformed entries but keeps valid ones', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({
      good: { inputPer1M: 5, outputPer1M: 5 },
      bad: { inputPer1M: 'x' },
    })
    expect(resolveModelPrice('good')).not.toBeNull()
    expect(resolveModelPrice('bad')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('OM_AGENT_COST_CURRENCY sets the estimate currency (validated, uppercased)', () => {
    process.env.OM_AGENT_COST_CURRENCY = 'pln'
    expect(computeCostMinor('gpt-4o-mini', 1000, 1000)?.currency).toBe('PLN')
    process.env.OM_AGENT_COST_CURRENCY = 'not-a-code'
    expect(computeCostMinor('gpt-4o-mini', 1000, 1000)?.currency).toBe('USD')
  })
})
