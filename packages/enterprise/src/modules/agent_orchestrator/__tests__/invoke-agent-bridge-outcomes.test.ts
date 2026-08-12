/**
 * The workflow bridge's outcome mapping (tracker task 2.5).
 *
 * The bridge is the seam core's `INVOKE_AGENT` step calls through
 * `tryResolve('agentWorkflowBridge')`. Two things are load-bearing here:
 *
 * 1. A SUSPENDED run must return before the proposal lookup and before
 *    disposition. Neither can succeed — there is no proposal yet and there may
 *    never be one — so reaching them would turn a correctly parked external call
 *    into a failed step ('[internal] agent proposal not found after run').
 * 2. Every SETTLED path must behave exactly as it did before `runOrSuspend`
 *    replaced `run`. Those four arms are the ones that must not move.
 */

import type { AwilixContainer } from 'awilix'
import { AgentProposal } from '../data/entities'
import {
  AgentWorkflowBridgeService,
  type InvokeAgentForWorkflowOutcome,
} from '../lib/runtime/invokeAgentForWorkflow'
import type { DispositionOutcome } from '../lib/disposition/dispositionService'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const HUMAN = 'human-1'
const PROCESS = 'process-1'
const STEP = 'step-1'
const AGENT_ID = 'voice.owner_call'

type RunOutcome =
  | { kind: 'settled'; result: unknown }
  | { kind: 'suspended'; runId: string; externalRunId?: string }

type Harness = {
  bridge: AgentWorkflowBridgeService
  runOrSuspend: jest.Mock
  findOneCalls: unknown[]
  dispose: jest.Mock
}

function buildHarness(options: {
  outcome: RunOutcome
  proposal?: Partial<AgentProposal> | null
  disposition?: DispositionOutcome
}): Harness {
  const findOneCalls: unknown[] = []
  const em = {
    fork: () => ({
      findOne: async (entity: unknown, where: unknown) => {
        // The bridge forks the same EM twice: once for the agent principal
        // (resolveRunAs) and once for the proposal. Only the second is the lookup
        // this suite asserts is never reached on a suspension.
        if (entity === AgentProposal) {
          findOneCalls.push(where)
          return options.proposal ?? null
        }
        return null
      },
    }),
  }
  const container = {
    resolve: (token: string) => (token === 'em' ? em : undefined),
  } as unknown as AwilixContainer

  const runOrSuspend = jest.fn(async () => options.outcome)
  const dispose = jest.fn(async () => options.disposition)

  const bridge = new AgentWorkflowBridgeService({
    container,
    agentRuntime: { runOrSuspend } as never,
    dispositionService: { dispose } as never,
  })

  return { bridge, runOrSuspend, findOneCalls, dispose }
}

function invoke(bridge: AgentWorkflowBridgeService): Promise<InvokeAgentForWorkflowOutcome> {
  return bridge.invokeAgentForWorkflow({
    agentId: AGENT_ID,
    input: { brief: 'call the owner' },
    onResult: { alwaysAsk: true },
    ctx: {
      tenantId: TENANT,
      organizationId: ORG,
      userId: HUMAN,
      processId: PROCESS,
      stepId: STEP,
    },
  })
}

describe('the bridge parks an external agent instead of failing it', () => {
  it('maps a suspended run to { kind: "suspended", runId, externalRunId }', async () => {
    const { bridge } = buildHarness({
      outcome: { kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' },
    })

    await expect(invoke(bridge)).resolves.toEqual({
      kind: 'suspended',
      runId: 'run-1',
      externalRunId: 'conv-1',
    })
  })

  it('never looks a proposal up and never disposes — there is nothing to dispose of', async () => {
    const { bridge, findOneCalls, dispose } = buildHarness({
      outcome: { kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' },
    })

    await invoke(bridge)

    // Reaching either would be the bug: the lookup finds no pending proposal for
    // this step and throws, failing a step that is correctly parked.
    expect(findOneCalls).toHaveLength(0)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('omits externalRunId rather than emitting undefined when the runner has none', async () => {
    const { bridge } = buildHarness({ outcome: { kind: 'suspended', runId: 'run-1' } })

    const outcome = await invoke(bridge)
    expect(outcome).toEqual({ kind: 'suspended', runId: 'run-1' })
    expect('externalRunId' in outcome).toBe(false)
  })

  it('structurally satisfies core\'s duck-typed union (nothing type-checks across that boundary)', async () => {
    const { bridge } = buildHarness({
      outcome: { kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' },
    })

    const outcome = await invoke(bridge)
    // Field NAMES, matched against the copies core declares in
    // workflows/lib/activity-executor.ts and .../activity-worker-handler.ts:
    // `{ kind: 'suspended'; runId: string; externalRunId?: string }`.
    expect(Object.keys(outcome).sort()).toEqual(['externalRunId', 'kind', 'runId'])
    expect(typeof (outcome as { runId: string }).runId).toBe('string')
    expect(typeof (outcome as { externalRunId?: string }).externalRunId).toBe('string')
  })

  it('reaches the runtime through runOrSuspend, carrying the workflow step ids', async () => {
    const { bridge, runOrSuspend } = buildHarness({
      outcome: { kind: 'suspended', runId: 'run-1', externalRunId: 'conv-1' },
    })

    await invoke(bridge)

    expect(runOrSuspend).toHaveBeenCalledTimes(1)
    const [agentId, input, runCtx] = runOrSuspend.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ]
    expect(agentId).toBe(AGENT_ID)
    expect(input).toEqual({ brief: 'call the owner' })
    // The external runner turns these into the correlation row's all-or-nothing
    // resume triple; without them the callback could never find the parked step.
    expect(runCtx.processId).toBe(PROCESS)
    expect(runCtx.stepId).toBe(STEP)
  })
})

describe('every settled path behaves exactly as before', () => {
  it('researcher: returns the data and short-circuits before the proposal lookup', async () => {
    const { bridge, findOneCalls, dispose } = buildHarness({
      outcome: { kind: 'settled', result: { kind: 'researcher', data: { ok: true } } },
    })

    await expect(invoke(bridge)).resolves.toEqual({ kind: 'researcher', data: { ok: true } })
    expect(findOneCalls).toHaveLength(0)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('auto_approved: returns the disposed proposal id with the stored payload', async () => {
    const proposal = { id: 'proposal-1', payload: { pick: 'a' } } as unknown as AgentProposal
    const { bridge, findOneCalls, dispose } = buildHarness({
      outcome: { kind: 'settled', result: { kind: 'proposal' } },
      proposal,
      disposition: { kind: 'auto_approved', proposalId: 'proposal-1', selectedOptionId: 'opt-1' },
    })

    await expect(invoke(bridge)).resolves.toEqual({
      kind: 'auto_approved',
      proposalId: 'proposal-1',
      payload: { pick: 'a' },
    })
    expect(findOneCalls).toEqual([
      {
        processId: PROCESS,
        stepId: STEP,
        disposition: { $in: ['pending', 'none_proposed'] },
        tenantId: TENANT,
        organizationId: ORG,
      },
    ])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('user_task: returns the proposal id and no payload', async () => {
    const proposal = { id: 'proposal-2', payload: { pick: 'b' } } as unknown as AgentProposal
    const { bridge, dispose } = buildHarness({
      outcome: { kind: 'settled', result: { kind: 'proposal' } },
      proposal,
      disposition: { kind: 'user_task', proposalId: 'proposal-2', userTaskId: 'task-1' },
    })

    await expect(invoke(bridge)).resolves.toEqual({ kind: 'user_task', proposalId: 'proposal-2' })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('none_proposed: returns the proposal id with the stored payload', async () => {
    const proposal = { id: 'proposal-3', payload: { options: [] } } as unknown as AgentProposal
    const { bridge } = buildHarness({
      outcome: { kind: 'settled', result: { kind: 'proposal' } },
      proposal,
      disposition: { kind: 'none_proposed', proposalId: 'proposal-3' },
    })

    await expect(invoke(bridge)).resolves.toEqual({
      kind: 'none_proposed',
      proposalId: 'proposal-3',
      payload: { options: [] },
    })
  })

  it('still throws when a settled proposal run left no proposal row', async () => {
    const { bridge, dispose } = buildHarness({
      outcome: { kind: 'settled', result: { kind: 'proposal' } },
      proposal: null,
    })

    await expect(invoke(bridge)).rejects.toThrow('[internal] agent proposal not found after run')
    expect(dispose).not.toHaveBeenCalled()
  })
})
