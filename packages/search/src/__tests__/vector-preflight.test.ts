import { evaluateVectorPreflight } from '../vector/lib/preflight'

describe('evaluateVectorPreflight', () => {
  it('passes when provider is configured, dimensions match, and probe succeeds', async () => {
    const probe = jest.fn().mockResolvedValue([0.1, 0.2])
    const result = await evaluateVectorPreflight({
      providerConfigured: true,
      effectiveDimension: 1536,
      tableDimension: 1536,
      probe,
    })
    expect(result).toEqual({ ok: true })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('skips when the provider is not configured (and does not probe)', async () => {
    const probe = jest.fn()
    const result = await evaluateVectorPreflight({
      providerConfigured: false,
      effectiveDimension: 1536,
      tableDimension: 1536,
      probe,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected skip')
    expect(result.code).toBe('provider_not_configured')
    expect(probe).not.toHaveBeenCalled()
  })

  it('skips when the configured dimension differs from the table dimension', async () => {
    const probe = jest.fn()
    const result = await evaluateVectorPreflight({
      providerConfigured: true,
      effectiveDimension: 1536,
      tableDimension: 768,
      probe,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected skip')
    expect(result.code).toBe('dimension_mismatch')
    expect(result.reason).toContain('1536')
    expect(result.reason).toContain('768')
    // Dimension mismatch is detected before the (expensive) probe runs.
    expect(probe).not.toHaveBeenCalled()
  })

  it('skips when the reachability probe throws', async () => {
    const probe = jest.fn().mockRejectedValue(new Error('fetch failed. Check OLLAMA_BASE_URL.'))
    const result = await evaluateVectorPreflight({
      providerConfigured: true,
      effectiveDimension: 768,
      tableDimension: 768,
      probe,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected skip')
    expect(result.code).toBe('provider_unreachable')
    expect(result.reason).toContain('OLLAMA_BASE_URL')
  })

  it('does not treat unknown dimensions as a mismatch', async () => {
    const result = await evaluateVectorPreflight({
      providerConfigured: true,
      effectiveDimension: null,
      tableDimension: 768,
    })
    expect(result).toEqual({ ok: true })
  })

  it('passes without a probe when provider is configured and dimensions match', async () => {
    const result = await evaluateVectorPreflight({
      providerConfigured: true,
      effectiveDimension: 1536,
      tableDimension: 1536,
    })
    expect(result).toEqual({ ok: true })
  })
})
