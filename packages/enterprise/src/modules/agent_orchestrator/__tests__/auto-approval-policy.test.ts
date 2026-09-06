import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import {
  DispositionServiceImpl,
  autoApprovable,
  evaluateAutoApproval,
} from '../lib/disposition/dispositionService'
import {
  DEFAULT_TENANT_AUTO_APPROVAL_POLICY,
  optionActionRisk,
  type DispositionOnResult,
} from '../lib/disposition/autoApprovalPolicy'
import type { ProposalOption } from '../data/validators'
import type { AgentProposal } from '../data/entities'

/**
 * Auto-approval: threshold AND margin (spec `2026-08-11-agent-taxonomy.md`, Phase 2).
 *
 * Two of these tests guard regressions rather than the feature. The `alwaysAsk`
 * short-circuit is the one this module cannot afford to lose — dropping it makes
 * every always-ask node start auto-approving — and the fail-closed null-confidence
 * guard is the second. Both are asserted first and against the SAME rule the
 * threshold arm uses, so neither can be quietly reordered away.
 */

const createAgentDispositionTask = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('@open-mercato/core/modules/workflows/lib/agent-disposition-task', () => ({
  createAgentDispositionTask: (...args: unknown[]) => createAgentDispositionTask(...args),
}))

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const PROCESS_ID = '11111111-2222-4333-8444-cccccccccccc'

const ACTION = { type: 'set_stage', payload: { stage: 'won' } }

function option(id: string, confidence?: number): ProposalOption {
  return {
    id,
    label: id,
    actions: [ACTION],
    ...(confidence !== undefined ? { confidence } : {}),
  }
}

/**
 * The threshold arm of the policy, with every OTHER gate satisfied.
 *
 * The policy weighs the tenant switch, the guardrail verdict, trace completeness
 * and action risk before it looks at confidence at all, so a test about the
 * threshold must hold those still — otherwise it would be asserting the wrong
 * gate and would pass for the wrong reason. Their own tests below vary them one
 * at a time.
 */
function decide(options: readonly ProposalOption[], onResult: DispositionOnResult) {
  return evaluateAutoApproval({
    options,
    onResult,
    guardrailsPassed: true,
    traceComplete: true,
  })
}

function approvable(options: readonly ProposalOption[], onResult: DispositionOnResult) {
  return autoApprovable({ options, onResult, guardrailsPassed: true, traceComplete: true })
}

describe('evaluateAutoApproval — the guards that must survive', () => {
  test('alwaysAsk NEVER auto-approves, whatever the options say', () => {
    expect(approvable([option('a', 1)], { alwaysAsk: true })).toBeNull()
    expect(decide([option('a', 1)], { alwaysAsk: true })).toEqual({
      kind: 'review',
      block: null,
    })
  })

  test('a leading option with no confidence fails closed to a human', () => {
    expect(approvable([option('a')], { autoApproveThreshold: 0 })).toBeNull()
  })

  test('an empty option set never auto-approves', () => {
    expect(approvable([], { autoApproveThreshold: 0 })).toBeNull()
  })
})

describe('evaluateAutoApproval — threshold', () => {
  test('at or above the threshold approves the leader', () => {
    expect(approvable([option('a', 0.8)], { autoApproveThreshold: 0.8 })?.id).toBe('a')
  })

  test('below the threshold routes to a human, with no block reason', () => {
    expect(decide([option('a', 0.79)], { autoApproveThreshold: 0.8 })).toEqual({
      kind: 'review',
      block: null,
    })
  })

  test('the leader is the highest-confidence option, not the first authored', () => {
    expect(approvable([option('a', 0.5), option('b', 0.95)], { autoApproveThreshold: 0.9 })?.id).toBe('b')
  })
})

describe('evaluateAutoApproval — margin', () => {
  test('the default margin of 0 preserves today’s rule exactly: a near-tie still approves', () => {
    const decision = decide([option('a', 0.81), option('b', 0.8)], {
      autoApproveThreshold: 0.8,
    })
    expect(decision).toEqual({ kind: 'approve', option: expect.objectContaining({ id: 'a' }) })
  })

  test('a near-tie under an authored margin is held for a human and says WHY', () => {
    expect(
      decide([option('a', 0.81), option('b', 0.8)], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      }),
    ).toEqual({ kind: 'review', block: 'near_tie' })
  })

  test('clearing the threshold AND the margin auto-approves', () => {
    expect(
      approvable([option('a', 0.95), option('b', 0.4)], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      })?.id,
    ).toBe('a')
  })

  test('a runner-up declaring no confidence counts as zero separation from it', () => {
    expect(
      approvable([option('a', 0.95), option('b')], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      })?.id,
    ).toBe('a')
  })

  test('a lone option has no runner-up, so the margin cannot block it', () => {
    expect(
      approvable([option('a', 0.85)], { autoApproveThreshold: 0.8, autoApproveMargin: 0.5 })?.id,
    ).toBe('a')
  })
})

describe('the policy gates that do not depend on the model’s own opinion', () => {
  test('an option is as risky as its most dangerous action — a safe step cannot launder an unsafe one', () => {
    expect(
      optionActionRisk({
        id: 'a',
        label: 'a',
        actions: [
          { type: 'notify', payload: {}, risk: 'low' },
          { type: 'refund_order', payload: {}, risk: 'high' },
        ],
      }),
    ).toBe('high')
  })

  test('an undeclared risk is medium — the conservative reading of "nobody said"', () => {
    expect(optionActionRisk({ id: 'a', label: 'a', actions: [ACTION] })).toBe('medium')
  })

  test('a tenant that has configured nothing refuses unattended high-risk action', () => {
    expect(DEFAULT_TENANT_AUTO_APPROVAL_POLICY).toEqual({ enabled: true, maxAutoApproveRisk: 'medium' })
    expect(
      evaluateAutoApproval({
        options: [
          { id: 'a', label: 'a', confidence: 1, actions: [{ type: 'wipe', payload: {}, risk: 'high' }] },
        ],
        onResult: { autoApproveThreshold: 0 },
        guardrailsPassed: true,
        traceComplete: true,
      }),
    ).toEqual({ kind: 'review', block: 'risk' })
  })

  test('alwaysAsk still wins over every other gate, including a permissive tenant policy', () => {
    expect(
      evaluateAutoApproval({
        options: [option('a', 1)],
        onResult: { alwaysAsk: true },
        guardrailsPassed: true,
        traceComplete: true,
        tenantPolicy: { enabled: true, maxAutoApproveRisk: 'high' },
      }),
    ).toEqual({ kind: 'review', block: null })
  })
})

describe('DispositionService applies the rule', () => {
  function makeProposal(payload: unknown): AgentProposal {
    return {
      id: 'proposal-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      agentId: 'deal_enricher',
      runId: 'run-1',
      payload,
      confidence: 0.9,
      disposition: 'pending',
    } as AgentProposal
  }

  /**
   * A run that PASSED its guardrails and left a trace, under the default tenant
   * policy — the ordinary case, so a test about the threshold is not silently
   * blocked by another gate. `evidence` varies one gate at a time.
   */
  function makeService(evidence: { guardrailBlocks?: number; spans?: number; policy?: unknown } = {}) {
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
    const nativeUpdate = jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
    const count = jest.fn<(...args: unknown[]) => Promise<number>>(async (entity: unknown) => {
      const name = (entity as { name?: string })?.name ?? ''
      if (name === 'AgentGuardrailCheck') return evidence.guardrailBlocks ?? 0
      return evidence.spans ?? 1
    })
    const getRecord = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(
        evidence.policy === undefined ? null : { value: evidence.policy },
      )
    const container = {
      resolve: (token: string) => {
        if (token === 'commandBus') return { execute }
        if (token === 'em') return { fork: () => ({ nativeUpdate, count }) }
        if (token === 'moduleConfigService') return { getRecord }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    }
    return { service: new DispositionServiceImpl(container as never), execute, nativeUpdate, count }
  }

  const ctx = { tenantId: TENANT_ID, organizationId: ORG_ID, workflowInstanceId: PROCESS_ID, stepId: 'agent_step' }

  beforeEach(() => {
    jest.clearAllMocks()
    createAgentDispositionTask.mockResolvedValue({ userTaskId: 'task-1' })
  })

  test('a near-tie raises the review task AND records the machine reason on its own column', async () => {
    const { service, execute, nativeUpdate } = makeService()

    const outcome = await service.dispose(
      makeProposal({ options: [option('a', 0.81), option('b', 0.8)] }),
      { autoApproveThreshold: 0.8, autoApproveMargin: 0.1 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
    // Its own column — never `dispositionReason`, which carries the operator's words.
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'proposal-1' }),
      { autoDispositionBlock: 'near_tie' },
    )
    expect(nativeUpdate.mock.calls[0][2]).not.toHaveProperty('dispositionReason')
  })

  test('an ordinary below-threshold review records NO block reason', async () => {
    const { service, nativeUpdate } = makeService()

    await service.dispose(
      makeProposal({ options: [option('a', 0.2)] }),
      { autoApproveThreshold: 0.8, autoApproveMargin: 0.1 },
      ctx,
    )

    for (const call of nativeUpdate.mock.calls) {
      expect(call[2]).not.toHaveProperty('autoDispositionBlock')
    }
  })

  test('an EMPTY option set terminates as none_proposed — never queued, never approved', async () => {
    const { service, execute } = makeService()

    const outcome = await service.dispose(
      makeProposal({ options: [], rationale: 'nothing to do' }),
      { autoApproveThreshold: 0 },
      ctx,
    )

    expect(outcome).toEqual({ kind: 'none_proposed', proposalId: 'proposal-1' })
    expect(execute).not.toHaveBeenCalled()
    expect(createAgentDispositionTask).not.toHaveBeenCalled()
  })

  test('a guardrail block holds a threshold-clearing proposal, and says so', async () => {
    const { service, execute, nativeUpdate } = makeService({ guardrailBlocks: 1 })

    const outcome = await service.dispose(
      makeProposal({ options: [option('a', 0.99)] }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'proposal-1' }),
      { autoDispositionBlock: 'guardrail' },
    )
  })

  test('a run that left NO trace cannot act unattended, however confident it is', async () => {
    const { service, execute, nativeUpdate } = makeService({ spans: 0 })

    const outcome = await service.dispose(
      makeProposal({ options: [option('a', 1)] }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'proposal-1' }),
      { autoDispositionBlock: 'trace_incomplete' },
    )
  })

  test('a high-risk action is held under the default ceiling — confidence is not authorization', async () => {
    const { service, execute, nativeUpdate } = makeService()

    const outcome = await service.dispose(
      makeProposal({
        options: [
          {
            id: 'a',
            label: 'a',
            confidence: 0.99,
            actions: [{ type: 'refund_order', payload: {}, risk: 'high' }],
          },
        ],
      }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'proposal-1' }),
      { autoDispositionBlock: 'risk' },
    )
  })

  test('a tenant that switched auto-approval off is obeyed before anything else is read', async () => {
    const { service, execute } = makeService({ policy: { enabled: false, maxAutoApproveRisk: 'high' } })

    const outcome = await service.dispose(
      makeProposal({ options: [option('a', 1)] }),
      { autoApproveThreshold: 0 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
  })

  test('the auto-approve verdict names the option it runs', async () => {
    const { service, execute } = makeService()

    const outcome = await service.dispose(
      makeProposal({ options: [option('a', 0.4), option('b', 0.95)] }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome).toEqual({ kind: 'auto_approved', proposalId: 'proposal-1', selectedOptionId: 'b' })
    expect(execute).toHaveBeenCalledWith(
      'agent_orchestrator.proposals.dispose',
      expect.objectContaining({ input: expect.objectContaining({ selectedOptionId: 'b' }) }),
    )
  })
})
