import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import {
  checkAgentPolicy,
  isMutationPolicyEscalation,
  resolveEffectiveMutationPolicy,
} from '../agent-policy'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { registerMcpTool, toolRegistry } from '../tool-registry'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

const baseAuth = { userFeatures: ['*'] as string[], isSuperAdmin: false }

describe('agent-policy mutation override (Step 5.4)', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  describe('resolveEffectiveMutationPolicy', () => {
    it('returns the code-declared policy when no override is given', () => {
      expect(resolveEffectiveMutationPolicy('confirm-required', undefined)).toBe(
        'confirm-required',
      )
      expect(resolveEffectiveMutationPolicy('confirm-required', null)).toBe(
        'confirm-required',
      )
    })

    it('defaults to read-only when the code-declared policy is missing', () => {
      expect(resolveEffectiveMutationPolicy(undefined, undefined)).toBe('read-only')
    })

    it('picks the MOST RESTRICTIVE of { code, override }', () => {
      expect(
        resolveEffectiveMutationPolicy('confirm-required', 'read-only'),
      ).toBe('read-only')
      expect(
        resolveEffectiveMutationPolicy('confirm-required', 'destructive-confirm-required'),
      ).toBe('destructive-confirm-required')
      expect(
        resolveEffectiveMutationPolicy('destructive-confirm-required', 'read-only'),
      ).toBe('read-only')
    })

    it('never allows an override to ESCALATE the policy', () => {
      // Override is more permissive than code — resolver keeps the code value.
      expect(
        resolveEffectiveMutationPolicy('read-only', 'confirm-required'),
      ).toBe('read-only')
      expect(
        resolveEffectiveMutationPolicy('destructive-confirm-required', 'confirm-required'),
      ).toBe('destructive-confirm-required')
    })

    it('falls back to the code-declared policy when the override value is unknown', () => {
      const result = resolveEffectiveMutationPolicy(
        'confirm-required',
        'write-capable' as never,
        'catalog.assistant',
      )
      expect(result).toBe('confirm-required')
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  describe('isMutationPolicyEscalation', () => {
    it('flags widenings as escalations', () => {
      expect(isMutationPolicyEscalation('read-only', 'confirm-required')).toBe(true)
      expect(
        isMutationPolicyEscalation('read-only', 'destructive-confirm-required'),
      ).toBe(true)
      expect(
        isMutationPolicyEscalation('destructive-confirm-required', 'confirm-required'),
      ).toBe(true)
    })

    it('does not flag same-level or downgrades', () => {
      expect(isMutationPolicyEscalation('confirm-required', 'confirm-required')).toBe(false)
      expect(isMutationPolicyEscalation('confirm-required', 'read-only')).toBe(false)
      expect(
        isMutationPolicyEscalation('confirm-required', 'destructive-confirm-required'),
      ).toBe(false)
    })

    it('treats a missing code-declared policy as read-only (strict)', () => {
      expect(isMutationPolicyEscalation(undefined, 'confirm-required')).toBe(true)
      expect(isMutationPolicyEscalation(undefined, 'read-only')).toBe(false)
    })
  })

  describe('checkAgentPolicy uses the effective policy', () => {
    it('blocks mutation when override downgrades a write-capable agent to read-only', () => {
      registerMcpTool(makeTool({ name: 'customers_update', isMutation: true }), {
        moduleId: 'customers',
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          allowedTools: ['customers_update'],
          readOnly: false,
          mutationPolicy: 'confirm-required',
        }),
      ])

      const decision = checkAgentPolicy({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        toolName: 'customers_update',
        mutationPolicyOverride: 'read-only',
      })

      expect(decision.ok).toBe(false)
      if (!decision.ok) {
        expect(decision.code).toBe('mutation_blocked_by_policy')
      }
    })

    it('keeps the code-declared policy when no override is supplied', () => {
      registerMcpTool(makeTool({ name: 'customers_update', isMutation: true }), {
        moduleId: 'customers',
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          allowedTools: ['customers_update'],
          readOnly: false,
          mutationPolicy: 'confirm-required',
        }),
      ])

      const decision = checkAgentPolicy({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        toolName: 'customers_update',
      })

      expect(decision.ok).toBe(true)
    })

    it('ignores a corrupt override value and falls back to the code-declared policy', () => {
      registerMcpTool(makeTool({ name: 'customers_update', isMutation: true }), {
        moduleId: 'customers',
      })
      seedAgentRegistryForTests([
        makeAgent({
          id: 'customers.assistant',
          moduleId: 'customers',
          allowedTools: ['customers_update'],
          readOnly: false,
          mutationPolicy: 'confirm-required',
        }),
      ])

      const decision = checkAgentPolicy({
        agentId: 'customers.assistant',
        authContext: baseAuth,
        toolName: 'customers_update',
        mutationPolicyOverride: 'write-capable' as never,
      })

      expect(decision.ok).toBe(true)
      expect(warnSpy).toHaveBeenCalled()
    })
  })
})
