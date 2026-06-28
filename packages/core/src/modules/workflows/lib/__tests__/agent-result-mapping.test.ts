import { mapAgentResultToContext } from '../agent-result-mapping'
import { invokeAgentConfigSchema } from '../../data/validators'

describe('mapAgentResultToContext', () => {
  describe('no mapping declared (legacy fallback)', () => {
    test('returns null when outputMapping is undefined', () => {
      const result = mapAgentResultToContext(
        { kind: 'auto_approved', agentId: 'a1', proposalId: 'p1', proposalPayload: { riskScore: 7 } },
        undefined,
      )
      expect(result).toBeNull()
    })

    test('returns null when outputMapping is empty', () => {
      const result = mapAgentResultToContext(
        { kind: 'auto_approved', agentId: 'a1', proposalId: 'p1', proposalPayload: { riskScore: 7 } },
        {},
      )
      expect(result).toBeNull()
    })
  })

  describe('mapping declared', () => {
    test('routes proposal payload paths and disposition into chosen keys', () => {
      const result = mapAgentResultToContext(
        { kind: 'auto_approved', agentId: 'a1', proposalId: 'p1', proposalPayload: { riskScore: 7 } },
        { dealRisk: 'proposalPayload.riskScore', decision: 'disposition', pid: 'proposalId' },
      )
      expect(result).toEqual({ dealRisk: 7, decision: 'auto_approved', pid: 'p1' })
    })

    test('maps informative data and normalizes disposition to "informative"', () => {
      const result = mapAgentResultToContext(
        { kind: 'informative', agentId: 'a1', data: { summary: 'all good' } },
        { note: 'data.summary', decision: 'disposition' },
      )
      expect(result).toEqual({ note: 'all good', decision: 'informative' })
    })

    test('supports nested target keys via dot notation', () => {
      const result = mapAgentResultToContext(
        { kind: 'auto_approved', proposalId: 'p1', proposalPayload: { riskScore: 7 } },
        { 'agent.risk': 'proposalPayload.riskScore' },
      )
      expect(result).toEqual({ agent: { risk: 7 } })
    })

    test('skips unresolved source paths (undefined) without writing the key', () => {
      const result = mapAgentResultToContext(
        { kind: 'auto_approved', proposalId: 'p1', proposalPayload: {} },
        { missing: 'proposalPayload.doesNotExist', pid: 'proposalId' },
      )
      expect(result).toEqual({ pid: 'p1' })
      expect(result).not.toHaveProperty('missing')
    })
  })
})

describe('invokeAgentConfigSchema.outputMapping', () => {
  test('accepts a config with outputMapping', () => {
    const parsed = invokeAgentConfigSchema.safeParse({
      agentId: 'deals_health_check',
      input: { dealId: '{{deal.id}}' },
      onResult: { autoApproveThreshold: 0.8 },
      outputMapping: { dealRisk: 'proposalPayload.riskScore' },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.outputMapping).toEqual({ dealRisk: 'proposalPayload.riskScore' })
    }
  })

  test('remains valid (backward compatible) without outputMapping', () => {
    const parsed = invokeAgentConfigSchema.safeParse({
      agentId: 'deals_health_check',
      onResult: { alwaysAsk: true },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.outputMapping).toBeUndefined()
    }
  })

  test('rejects a non-string mapping value', () => {
    const parsed = invokeAgentConfigSchema.safeParse({
      agentId: 'deals_health_check',
      onResult: { autoApproveThreshold: 0.5 },
      outputMapping: { dealRisk: 123 },
    })
    expect(parsed.success).toBe(false)
  })
})
