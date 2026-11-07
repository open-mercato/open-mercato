/** @jest-environment node */
import { clampCachedInputTokens, computeCostMinor, resolveModelPrice } from '../lib/runtime/modelPricing'
import { captureLogs } from './support/captureLogs'

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
    const logs = captureLogs()
    process.env.OM_AGENT_MODEL_PRICING = '{not json'
    expect(resolveModelPrice('gpt-5-mini')).toMatchObject({ inputPer1M: 0.25, outputPer1M: 2 })
    expect(logs.at('warn').map((record) => record.message)).toContain(
      'OM_AGENT_MODEL_PRICING is not valid JSON; using default pricing',
    )
    logs.restore()
  })

  it('skips malformed entries but keeps valid ones', () => {
    const logs = captureLogs()
    process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({
      good: { inputPer1M: 5, outputPer1M: 5 },
      bad: { inputPer1M: 'x' },
    })
    expect(resolveModelPrice('good')).not.toBeNull()
    expect(resolveModelPrice('bad')).toBeNull()
    expect(logs.at('warn').map((record) => record.fields.model)).toContain('bad')
    logs.restore()
  })

  describe('cached input tier (#6240)', () => {
    const sonnet5Pricing = JSON.stringify({
      'claude-sonnet-5': { inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.2 },
    })

    it('prices cached input as a SUBSET of input at the cached rate (measured native run)', () => {
      process.env.OM_AGENT_MODEL_PRICING = sonnet5Pricing
      // 65_589 fresh × 2 + 391_095 cached × 0.2 + 5_138 out × 10 = 0.260777 USD → 26 cents.
      expect(computeCostMinor('claude-sonnet-5', 456_684, 5_138, 391_095)).toEqual({ costMinor: 26, currency: 'USD' })
      // Without the cached share the same run was overstated at 96 cents.
      expect(computeCostMinor('claude-sonnet-5', 456_684, 5_138)).toEqual({ costMinor: 96, currency: 'USD' })
    })

    it('prices the measured OpenCode run', () => {
      process.env.OM_AGENT_MODEL_PRICING = sonnet5Pricing
      // 96_060 fresh × 2 + 292_541 cached × 0.2 + 4_789 out × 10 = 0.2984 USD → 30 cents.
      expect(computeCostMinor('claude-sonnet-5', 388_601, 4_789, 292_541)?.costMinor).toBe(30)
    })

    it('null, undefined or zero cached tokens keep the two-tier result unchanged', () => {
      delete process.env.OM_AGENT_MODEL_PRICING
      const baseline = computeCostMinor('claude-sonnet-4-5', 200_000, 100_000)
      expect(baseline?.costMinor).toBe(210)
      expect(computeCostMinor('claude-sonnet-4-5', 200_000, 100_000, null)).toEqual(baseline)
      expect(computeCostMinor('claude-sonnet-4-5', 200_000, 100_000, undefined)).toEqual(baseline)
      expect(computeCostMinor('claude-sonnet-4-5', 200_000, 100_000, 0)).toEqual(baseline)
    })

    it('clamps the cached share to [0, inputTokens] — never priced beyond the input it is part of', () => {
      delete process.env.OM_AGENT_MODEL_PRICING
      // All 1M input cached at 0.3 → 30 cents; an over-reported cache count cannot exceed that.
      expect(computeCostMinor('claude-sonnet-4-5', 1_000_000, 0, 1_000_000)?.costMinor).toBe(30)
      expect(computeCostMinor('claude-sonnet-4-5', 1_000_000, 0, 5_000_000)?.costMinor).toBe(30)
      expect(computeCostMinor('claude-sonnet-4-5', 1_000_000, 0, -10)?.costMinor).toBe(300)
      // No input at all → a cached count has nothing to discount.
      expect(computeCostMinor('claude-sonnet-4-5', null, 1_000_000, 500_000)?.costMinor).toBe(1500)
    })

    it('falls back to the fresh input rate when the model has no cached rate', () => {
      process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({ 'no-cache-model': { inputPer1M: 4, outputPer1M: 8 } })
      expect(resolveModelPrice('no-cache-model')?.cachedInputPer1M).toBeUndefined()
      // 1M input (half cached, priced at the fresh 4) → 400 cents, same as no cache share.
      expect(computeCostMinor('no-cache-model', 1_000_000, 0, 500_000)?.costMinor).toBe(400)
    })

    it('ships a cached rate for every default model', () => {
      delete process.env.OM_AGENT_MODEL_PRICING
      for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
        const price = resolveModelPrice(model)
        expect(price?.cachedInputPer1M).toBeGreaterThan(0)
        expect(price!.cachedInputPer1M!).toBeLessThan(price!.inputPer1M)
      }
    })

    it('env override keeps cachedInputPer1M and rejects a malformed one', () => {
      const logs = captureLogs()
      process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({
        cached: { inputPer1M: 2, outputPer1M: 4, cachedInputPer1M: 0.5 },
        negative: { inputPer1M: 2, outputPer1M: 4, cachedInputPer1M: -1 },
        text: { inputPer1M: 2, outputPer1M: 4, cachedInputPer1M: 'cheap' },
      })
      expect(resolveModelPrice('cached')).toMatchObject({ inputPer1M: 2, outputPer1M: 4, cachedInputPer1M: 0.5 })
      expect(resolveModelPrice('negative')).toBeNull()
      expect(resolveModelPrice('text')).toBeNull()
      expect(logs.at('warn').map((record) => record.fields.model)).toEqual(expect.arrayContaining(['negative', 'text']))
      logs.restore()
    })

    it('clampCachedInputTokens keeps the cached share within the input and unknown as unknown', () => {
      expect(clampCachedInputTokens(80, 50)).toBe(50)
      expect(clampCachedInputTokens(30, 50)).toBe(30)
      expect(clampCachedInputTokens(null, 50)).toBeNull()
      expect(clampCachedInputTokens(undefined, 50)).toBeUndefined()
      expect(clampCachedInputTokens(80, null)).toBe(80)
    })

    it('an override without cachedInputPer1M drops the default cached rate for that model', () => {
      process.env.OM_AGENT_MODEL_PRICING = JSON.stringify({ 'gpt-5-mini': { inputPer1M: 1, outputPer1M: 2 } })
      expect(resolveModelPrice('gpt-5-mini')?.cachedInputPer1M).toBeUndefined()
    })
  })

  it('OM_AGENT_COST_CURRENCY sets the estimate currency (validated, uppercased)', () => {
    process.env.OM_AGENT_COST_CURRENCY = 'pln'
    expect(computeCostMinor('gpt-4o-mini', 1000, 1000)?.currency).toBe('PLN')
    process.env.OM_AGENT_COST_CURRENCY = 'not-a-code'
    expect(computeCostMinor('gpt-4o-mini', 1000, 1000)?.currency).toBe('USD')
  })
})
