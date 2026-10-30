import type { AiAgentMutationPolicy } from '../ai-agent-definition'
import {
  mergeMutationPolicyOverrides,
  resolveAgentMutationPolicyForChannel,
  resolveAgentRunMutationPolicyOverride,
} from '../agent-channel-policy'
import { isMutationPolicyEscalation } from '../agent-policy'
import type { McpMutationMode } from '../mcp-exposure'
import type { AiPendingActionChannel } from '../pending-action-types'

const channels: AiPendingActionChannel[] = ['agent', 'mcp', 'tools-api']
const modes: McpMutationMode[] = ['direct', 'deny', 'approval']
const policies: Array<AiAgentMutationPolicy | undefined> = [
  undefined,
  'read-only',
  'destructive-confirm-required',
  'confirm-required',
]

describe('resolveAgentMutationPolicyForChannel', () => {
  it.each([
    ['agent', 'direct', null],
    ['agent', 'deny', null],
    ['agent', 'approval', null],
    ['mcp', 'direct', 'read-only'],
    ['mcp', 'deny', 'read-only'],
    ['mcp', 'approval', null],
    ['tools-api', 'direct', 'read-only'],
    ['tools-api', 'deny', 'read-only'],
    ['tools-api', 'approval', null],
  ] as const)('channel %s with mode %s resolves to %s', (channel, mutationMode, expected) => {
    expect(
      resolveAgentMutationPolicyForChannel({
        channel,
        mutationMode,
        declaredPolicy: 'confirm-required',
      }),
    ).toBe(expected)
  })

  it('never escalates the declared policy', () => {
    for (const channel of channels) {
      for (const mutationMode of modes) {
        for (const declaredPolicy of policies) {
          const override = resolveAgentMutationPolicyForChannel({ channel, mutationMode, declaredPolicy })
          if (override !== null) {
            expect(isMutationPolicyEscalation(declaredPolicy, override)).toBe(false)
          }
        }
      }
    }
  })
})

describe('mergeMutationPolicyOverrides', () => {
  it('returns the most restrictive of two overrides and passes nulls through', () => {
    expect(mergeMutationPolicyOverrides(null, null)).toBeNull()
    expect(mergeMutationPolicyOverrides(undefined, 'read-only')).toBe('read-only')
    expect(mergeMutationPolicyOverrides('confirm-required', null)).toBe('confirm-required')
    expect(mergeMutationPolicyOverrides('confirm-required', 'read-only')).toBe('read-only')
    expect(mergeMutationPolicyOverrides('destructive-confirm-required', 'confirm-required')).toBe(
      'destructive-confirm-required',
    )
  })
})

describe('resolveAgentRunMutationPolicyOverride', () => {
  it('reproduces the tenant override when no channel is supplied', () => {
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: undefined,
        mutationMode: undefined,
        declaredPolicy: 'confirm-required',
        tenantOverride: null,
        canQueueMutations: false,
      }),
    ).toBeNull()
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: undefined,
        mutationMode: undefined,
        declaredPolicy: 'confirm-required',
        tenantOverride: 'destructive-confirm-required',
        canQueueMutations: true,
      }),
    ).toBe('destructive-confirm-required')
  })

  it('forces read-only for a non-agent channel that cannot queue pending actions', () => {
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: 'mcp',
        mutationMode: 'approval',
        declaredPolicy: 'confirm-required',
        tenantOverride: null,
        canQueueMutations: false,
      }),
    ).toBe('read-only')
  })

  it('keeps the tenant override in approval mode and downgrades in deny mode', () => {
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: 'tools-api',
        mutationMode: 'approval',
        declaredPolicy: 'confirm-required',
        tenantOverride: 'destructive-confirm-required',
        canQueueMutations: true,
      }),
    ).toBe('destructive-confirm-required')
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: 'mcp',
        mutationMode: 'deny',
        declaredPolicy: 'confirm-required',
        tenantOverride: 'destructive-confirm-required',
        canQueueMutations: true,
      }),
    ).toBe('read-only')
  })

  it('defaults a missing mutation mode on a non-agent channel to read-only', () => {
    expect(
      resolveAgentRunMutationPolicyOverride({
        channel: 'mcp',
        mutationMode: undefined,
        declaredPolicy: 'confirm-required',
        tenantOverride: null,
        canQueueMutations: true,
      }),
    ).toBe('read-only')
  })
})
