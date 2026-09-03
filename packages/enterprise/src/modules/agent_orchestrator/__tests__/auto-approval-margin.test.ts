import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import {
  DispositionServiceImpl,
  autoApprovable,
  evaluateAutoApproval,
} from '../lib/disposition/dispositionService'
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

describe('evaluateAutoApproval — the guards that must survive', () => {
  test('alwaysAsk NEVER auto-approves, whatever the options say', () => {
    expect(autoApprovable([option('a', 1)], { alwaysAsk: true })).toBeNull()
    expect(evaluateAutoApproval([option('a', 1)], { alwaysAsk: true })).toEqual({
      kind: 'review',
      block: null,
    })
  })

  test('a leading option with no confidence fails closed to a human', () => {
    expect(autoApprovable([option('a')], { autoApproveThreshold: 0 })).toBeNull()
  })

  test('an empty option set never auto-approves', () => {
    expect(autoApprovable([], { autoApproveThreshold: 0 })).toBeNull()
  })
})

describe('evaluateAutoApproval — threshold', () => {
  test('at or above the threshold approves the leader', () => {
    expect(autoApprovable([option('a', 0.8)], { autoApproveThreshold: 0.8 })?.id).toBe('a')
  })

  test('below the threshold routes to a human, with no block reason', () => {
    expect(evaluateAutoApproval([option('a', 0.79)], { autoApproveThreshold: 0.8 })).toEqual({
      kind: 'review',
      block: null,
    })
  })

  test('the leader is the highest-confidence option, not the first authored', () => {
    expect(autoApprovable([option('a', 0.5), option('b', 0.95)], { autoApproveThreshold: 0.9 })?.id).toBe('b')
  })
})

describe('evaluateAutoApproval — margin', () => {
  test('the default margin of 0 preserves today’s rule exactly: a near-tie still approves', () => {
    const decision = evaluateAutoApproval([option('a', 0.81), option('b', 0.8)], {
      autoApproveThreshold: 0.8,
    })
    expect(decision).toEqual({ kind: 'approve', option: expect.objectContaining({ id: 'a' }) })
  })

  test('a near-tie under an authored margin is held for a human and says WHY', () => {
    expect(
      evaluateAutoApproval([option('a', 0.81), option('b', 0.8)], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      }),
    ).toEqual({ kind: 'review', block: 'near_tie' })
  })

  test('clearing the threshold AND the margin auto-approves', () => {
    expect(
      autoApprovable([option('a', 0.95), option('b', 0.4)], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      })?.id,
    ).toBe('a')
  })

  test('a runner-up declaring no confidence counts as zero separation from it', () => {
    expect(
      autoApprovable([option('a', 0.95), option('b')], {
        autoApproveThreshold: 0.8,
        autoApproveMargin: 0.1,
      })?.id,
    ).toBe('a')
  })

  test('a lone option has no runner-up, so the margin cannot block it', () => {
    expect(
      autoApprovable([option('a', 0.85)], { autoApproveThreshold: 0.8, autoApproveMargin: 0.5 })?.id,
    ).toBe('a')
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

  function makeService() {
    const execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()
    const nativeUpdate = jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1)
    const container = {
      resolve: (token: string) => {
        if (token === 'commandBus') return { execute }
        if (token === 'em') return { fork: () => ({ nativeUpdate }) }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    }
    return { service: new DispositionServiceImpl(container as never), execute, nativeUpdate }
  }

  const ctx = { tenantId: TENANT_ID, organizationId: ORG_ID, processId: PROCESS_ID, stepId: 'agent_step' }

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
