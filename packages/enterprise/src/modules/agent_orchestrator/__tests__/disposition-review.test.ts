/**
 * `DispositionService` and the agent node's Review section (spec §7.5).
 *
 * The gate this file guards is the one `AGENTS.md` marks Ask-First: "the
 * auto-approve vs `user_task` boundary". So the assertions are as much about
 * what did NOT change as about what did —
 *
 *  - the threshold comparison, the fail-closed null-confidence branch and the
 *    `alwaysAsk` arm decide exactly what they decided before;
 *  - only the human arm learned anything new: it hands the authored Review
 *    descriptor to the workflows module, which builds the task;
 *  - nothing in this service disposes a proposal without a human — the ONLY
 *    verdict it writes is the audited `auto_approved` one the threshold
 *    already produced.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { DispositionServiceImpl } from '../lib/disposition/dispositionService'
import type { AgentProposal } from '../data/entities'

const createAgentDispositionTask = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('@open-mercato/core/modules/workflows/lib/agent-disposition-task', () => ({
  createAgentDispositionTask: (...args: unknown[]) => createAgentDispositionTask(...args),
}))

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const PROCESS_ID = '11111111-2222-4333-8444-cccccccccccc'

/**
 * The auto-approve rule reads the OPTION confidences, not the row column, so the
 * fixture keeps the two consistent: one option carrying the same confidence the row
 * derives from it. `confidence: null` therefore produces an option that declares
 * none — the fail-closed case.
 */
function makeProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  const confidence = 'confidence' in overrides ? overrides.confidence : 0.9
  return {
    id: 'proposal-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    agentId: 'deal_enricher',
    runId: 'run-1',
    payload: {
      options: [
        {
          id: 'primary',
          label: 'deal_enricher',
          actions: [{ type: 'set_stage', payload: { stage: 'won' } }],
          ...(typeof confidence === 'number' ? { confidence } : {}),
        },
      ],
    },
    confidence: confidence ?? null,
    disposition: 'pending',
    ...overrides,
  } as AgentProposal
}

function makeService(execute = jest.fn<(...args: unknown[]) => Promise<unknown>>()) {
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

const ctx = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  processId: PROCESS_ID,
  stepId: 'agent_step',
}

describe('DispositionService — the auto-approve boundary is unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createAgentDispositionTask.mockResolvedValue({ userTaskId: 'task-1' })
  })

  test('confidence at or above the threshold still auto-approves through the audited Command', async () => {
    const { service, execute } = makeService()

    const outcome = await service.dispose(
      makeProposal({ confidence: 0.8 }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome).toEqual({ kind: 'auto_approved', proposalId: 'proposal-1', selectedOptionId: 'primary' })
    expect(execute).toHaveBeenCalledWith(
      'agent_orchestrator.proposals.dispose',
      expect.objectContaining({
        input: expect.objectContaining({
          disposition: 'auto_approved',
          dispositionBy: 'rule:threshold',
          selectedOptionId: 'primary',
        }),
      }),
    )
    expect(createAgentDispositionTask).not.toHaveBeenCalled()
  })

  test('a missing confidence still fails closed to a human', async () => {
    const { service, execute } = makeService()

    const outcome = await service.dispose(
      makeProposal({ confidence: null }),
      { autoApproveThreshold: 0.8 },
      ctx,
    )

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
  })

  test('alwaysAsk still routes to a human whatever the confidence', async () => {
    const { service, execute } = makeService()

    const outcome = await service.dispose(makeProposal({ confidence: 1 }), { alwaysAsk: true }, ctx)

    expect(outcome.kind).toBe('user_task')
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('DispositionService — the human arm is routable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createAgentDispositionTask.mockResolvedValue({ userTaskId: 'task-1' })
  })

  test('hands the authored Review descriptor to the workflows module', async () => {
    const { service } = makeService()
    const review = { assignedToRoles: ['Sales Rep'], deadlineDuration: 'P2D' }

    const outcome = await service.dispose(makeProposal({ confidence: 0.1 }), { alwaysAsk: true }, {
      ...ctx,
      review,
    })

    expect(outcome).toEqual({ kind: 'user_task', userTaskId: 'task-1', proposalId: 'proposal-1' })
    expect(createAgentDispositionTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        workflowInstanceId: PROCESS_ID,
        stepId: 'agent_step',
        proposalId: 'proposal-1',
        review,
      }),
    )
  })

  test('no Review authored still raises the task, with no descriptor', async () => {
    const { service } = makeService()

    await service.dispose(makeProposal({ confidence: 0.1 }), { alwaysAsk: true }, ctx)

    expect(createAgentDispositionTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ review: null }),
    )
  })

  test('links the proposal to its review task without bumping the optimistic-lock token', async () => {
    const { service, nativeUpdate } = makeService()
    const proposal = makeProposal({ confidence: 0.1 })

    await service.dispose(proposal, { alwaysAsk: true }, ctx)

    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'proposal-1', tenantId: TENANT_ID, organizationId: ORG_ID }),
      { userTaskId: 'task-1' },
    )
    // `updated_at` is the proposal's lock token; writing it here would 409 a
    // caseload modal that had already loaded the row.
    expect(nativeUpdate.mock.calls[0][2]).not.toHaveProperty('updatedAt')
    expect(proposal.userTaskId).toBe('task-1')
  })

  test('a failed link costs the automatic close, never the review', async () => {
    const { service, nativeUpdate } = makeService()
    nativeUpdate.mockRejectedValue(new Error('db down'))

    const outcome = await service.dispose(makeProposal({ confidence: 0.1 }), { alwaysAsk: true }, ctx)

    expect(outcome).toEqual({ kind: 'user_task', userTaskId: 'task-1', proposalId: 'proposal-1' })
  })

  test('an absent workflows peer degrades to the synthetic id, never to a verdict', async () => {
    const { service, execute } = makeService()
    createAgentDispositionTask.mockRejectedValue(new Error('workflows not installed'))

    const outcome = await service.dispose(makeProposal({ confidence: 0.1 }), { alwaysAsk: true }, ctx)

    expect(outcome).toEqual({
      kind: 'user_task',
      userTaskId: 'pending:proposal-1',
      proposalId: 'proposal-1',
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
