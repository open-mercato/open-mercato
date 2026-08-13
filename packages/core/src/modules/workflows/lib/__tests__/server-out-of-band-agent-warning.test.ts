/** @jest-environment node */

/**
 * The SERVER half of the out-of-band-agent authoring guard (tracker task 4.4).
 *
 * T4.2 shipped the check in the browser, where the agents REST endpoint already
 * serves `runtime` per item. Every other authoring surface — the definitions
 * generate route, the `validate_workflow_definition` tool, the in-Studio draft
 * agent — evaluates on the SERVER through `evaluateWorkflowDefinition`, and the
 * only seam from core to the optional `agent_orchestrator` peer there is
 * `listAgentOutcomeContracts()`. Until that projection carried `suspends`, the
 * AI draft agent could author the mistake and nothing said so until a human
 * opened the canvas.
 *
 * Two properties are load-bearing and both are asserted below:
 *
 *  - the server raises the SAME warning the browser raises for the same
 *    definition (they share `lib/parallel-branch-agent-warnings.ts`, and the
 *    anti-drift test pins that they cannot disagree); and
 *  - it DEGRADES TO SILENCE — absent peer, a bridge predating the flag, a
 *    listing that throws, a native agent — because "unknown" is not "suspends"
 *    and a warning on every agent step would train authors to ignore the panel.
 */

import { describe, test, expect, jest } from '@jest/globals'
import { z } from 'zod'
import { evaluateWorkflowDefinition } from '../definition-evaluation'
import { collectValidationIssues } from '../collect-validation-issues'
import { definitionToGraph, validateWorkflowGraph } from '../graph-utils'
import type { WorkflowDefinitionData } from '../../data/entities'

type ServerContractModule = typeof import('../server-output-contract')

const loadIsolated = (): ServerContractModule => {
  let loaded: ServerContractModule | undefined
  jest.isolateModules(() => {
    loaded = require('../server-output-contract') as ServerContractModule
  })
  if (!loaded) throw new Error('[internal] failed to load server-output-contract in isolation')
  return loaded
}

const bridgeContainer = (bridge: unknown) => ({
  resolve: <T,>(name: string): T => {
    if (name !== 'agentWorkflowBridge' || bridge === undefined) {
      throw new Error(`[internal] ${name} is not registered`)
    }
    return bridge as T
  },
})

const VOICE_AGENT = 'elevenlabs.voice_caller'
const NATIVE_AGENT = 'deals.enricher'

const outcomeSchema = z.object({ reached: z.boolean(), transcript: z.string() })

/** What the peer's bridge projects today: every agent carries the flag. */
const currentBridge = {
  listAgentOutcomeContracts: async () => [
    { agentId: VOICE_AGENT, resultKind: 'researcher', schema: outcomeSchema, suspends: true },
    { agentId: NATIVE_AGENT, resultKind: 'researcher', schema: outcomeSchema, suspends: false },
  ],
}

/** A bridge from before task 4.4 — same three keys, no `suspends` anywhere. */
const legacyBridge = {
  listAgentOutcomeContracts: async () => [
    { agentId: VOICE_AGENT, resultKind: 'researcher', schema: outcomeSchema },
    { agentId: NATIVE_AGENT, resultKind: 'researcher', schema: outcomeSchema },
  ],
}

function agentStep(stepId: string, agentId: string) {
  return {
    stepId,
    stepName: stepId,
    stepType: 'AUTOMATED',
    activities: [
      {
        activityId: `${stepId}_agent`,
        activityType: 'INVOKE_AGENT',
        config: { agentId, input: {}, onResult: 'continue' },
      },
    ],
  }
}

function plainStep(stepId: string, stepType = 'AUTOMATED', config?: Record<string, unknown>) {
  return { stepId, stepName: stepId, stepType, ...(config ? { config } : {}) }
}

function route(transitionId: string, fromStepId: string, toStepId: string) {
  return { transitionId, fromStepId, toStepId, trigger: 'auto' }
}

/** start → fork ⇉ (agent step) + (notify) → join → end. */
function definitionWithAgentInsideBranch(agentId: string): WorkflowDefinitionData {
  return {
    steps: [
      plainStep('start', 'START'),
      plainStep('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
      agentStep('call_owner', agentId),
      plainStep('notify'),
      plainStep('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
      plainStep('end', 'END'),
    ],
    transitions: [
      route('t_start', 'start', 'fork'),
      route('t_branch_a', 'fork', 'call_owner'),
      route('t_branch_b', 'fork', 'notify'),
      route('t_a_join', 'call_owner', 'join'),
      route('t_b_join', 'notify', 'join'),
      route('t_join_end', 'join', 'end'),
    ],
  } as unknown as WorkflowDefinitionData
}

/** The same graph with the agent step moved AFTER the join. */
function definitionWithAgentOutsideBranch(agentId: string): WorkflowDefinitionData {
  return {
    steps: [
      plainStep('start', 'START'),
      plainStep('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
      plainStep('check'),
      plainStep('notify'),
      plainStep('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
      agentStep('call_owner', agentId),
      plainStep('end', 'END'),
    ],
    transitions: [
      route('t_start', 'start', 'fork'),
      route('t_branch_a', 'fork', 'check'),
      route('t_branch_b', 'fork', 'notify'),
      route('t_a_join', 'check', 'join'),
      route('t_b_join', 'notify', 'join'),
      route('t_join_agent', 'join', 'call_owner'),
      route('t_agent_end', 'call_owner', 'end'),
    ],
  } as unknown as WorkflowDefinitionData
}

const WARNING_CODE = 'agentOutOfBandInParallelBranch'

function outOfBandProblems<T extends { id: string }>(problems: T[]): T[] {
  return problems.filter((problem) => problem.id.startsWith(`flow-${WARNING_CODE}-`))
}

/**
 * Warm the seam, read the flag back, then evaluate the definition exactly as a
 * server caller does (`tryResolveEvaluationOptions` in the generate route and
 * the authoring tool pack).
 */
async function evaluateOnServer(bridge: unknown, definition: WorkflowDefinitionData) {
  const serverContractModule = loadIsolated()
  await serverContractModule.ensureWorkflowAgentOutcomeContracts(bridgeContainer(bridge))
  try {
    const outOfBandAgentIds = serverContractModule.getWorkflowOutOfBandAgentIds()
    return {
      outOfBandAgentIds,
      evaluation: evaluateWorkflowDefinition(definition, { ledger: null, outOfBandAgentIds }),
    }
  } finally {
    serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
  }
}

describe('the server raises the parallel-branch agent warning', () => {
  test('an out-of-band agent inside a parallel branch is reported through evaluateWorkflowDefinition', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      currentBridge,
      definitionWithAgentInsideBranch(VOICE_AGENT),
    )

    expect(outOfBandAgentIds && [...outOfBandAgentIds]).toEqual([VOICE_AGENT])
    const problems = outOfBandProblems(evaluation.problems)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toContain('call_owner')
    expect(problems[0].message).toContain(VOICE_AGENT)
    expect(problems[0].message).toContain('fork')
    // A WARNING, never an error: a definition mid-edit must stay saveable, and
    // the run-time refusal is deliberately absorbable by an `error` route.
    expect(problems[0].severity).toBe('warning')
  })

  test('the same agent OUTSIDE the branch reports nothing', async () => {
    const { evaluation } = await evaluateOnServer(
      currentBridge,
      definitionWithAgentOutsideBranch(VOICE_AGENT),
    )
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('a native agent inside the branch reports nothing', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      currentBridge,
      definitionWithAgentInsideBranch(NATIVE_AGENT),
    )
    expect(outOfBandAgentIds?.has(NATIVE_AGENT)).toBe(false)
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })
})

describe('it degrades to silence', () => {
  test('no peer at all: no throw, no warning, and the flag reads as not-known', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      undefined,
      definitionWithAgentInsideBranch(VOICE_AGENT),
    )
    // `null`, not an empty set: "the catalogue could not be read" is a different
    // fact from "the catalogue holds no out-of-band agent".
    expect(outOfBandAgentIds).toBeNull()
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('a peer without the listing method reports nothing', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      {},
      definitionWithAgentInsideBranch(VOICE_AGENT),
    )
    expect(outOfBandAgentIds).toBeNull()
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('an OLDER bridge whose snapshots carry no `suspends` reports nothing (BC)', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      legacyBridge,
      definitionWithAgentInsideBranch(VOICE_AGENT),
    )
    // The catalogue WAS readable, so this is an empty set rather than null — and
    // an empty set is just as silent.
    expect(outOfBandAgentIds && [...outOfBandAgentIds]).toEqual([])
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('a listing that throws reports nothing', async () => {
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(
      {
        listAgentOutcomeContracts: async () => {
          throw new Error('[internal] registry unavailable')
        },
      },
      definitionWithAgentInsideBranch(VOICE_AGENT),
    )
    expect(outOfBandAgentIds).toBeNull()
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('an unwarmed process reports nothing', () => {
    const serverContractModule = loadIsolated()
    expect(serverContractModule.getWorkflowOutOfBandAgentIds()).toBeNull()
    const evaluation = evaluateWorkflowDefinition(definitionWithAgentInsideBranch(VOICE_AGENT), {
      ledger: null,
      outOfBandAgentIds: serverContractModule.getWorkflowOutOfBandAgentIds(),
    })
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })

  test('omitting the option entirely leaves the evaluation byte-identical to before this task', () => {
    const definition = definitionWithAgentInsideBranch(VOICE_AGENT)
    expect(evaluateWorkflowDefinition(definition)).toEqual(
      evaluateWorkflowDefinition(definition, { ledger: null }),
    )
    expect(outOfBandProblems(evaluateWorkflowDefinition(definition).problems)).toEqual([])
  })
})

describe('the browser and the server cannot disagree (anti-drift)', () => {
  /**
   * The browser derives its set from the agents REST endpoint's `runtime`
   * (`components/useOutOfBandAgents.ts`); the server derives its set from the
   * bridge's `suspends`. Two sources, one fact — so the ONE thing that must hold
   * is that the same definition produces the SAME warning on both surfaces.
   */
  test('both surfaces produce the identical warning for the same definition', async () => {
    const definition = definitionWithAgentInsideBranch(VOICE_AGENT)

    // Browser: exactly what the visual editor page does with the hook's result.
    const restItems = [
      { id: VOICE_AGENT, runtime: 'external' },
      { id: NATIVE_AGENT, runtime: 'native' },
    ]
    const browserAgentIds = new Set(
      restItems.filter((item) => item.runtime === 'external').map((item) => item.id),
    )
    const { nodes, edges } = definitionToGraph(definition, { autoLayout: false })
    const browserIssues = collectValidationIssues({
      graphErrors: validateWorkflowGraph(nodes, edges),
      nodes,
      edges,
      definition,
      outOfBandAgentIds: browserAgentIds,
    })

    // Server: the bridge snapshot, through the seam this task added.
    const { outOfBandAgentIds, evaluation } = await evaluateOnServer(currentBridge, definition)

    expect(outOfBandAgentIds && [...outOfBandAgentIds]).toEqual([...browserAgentIds])
    const browserProblems = outOfBandProblems(browserIssues)
    const serverProblems = outOfBandProblems(evaluation.problems)
    expect(browserProblems).toHaveLength(1)
    // Same code (it is embedded in the issue id), same message, same node.
    expect(serverProblems).toEqual(browserProblems)
  })

  test('and they stay silent together when the agent moves out of the branch', async () => {
    const definition = definitionWithAgentOutsideBranch(VOICE_AGENT)
    const { nodes, edges } = definitionToGraph(definition, { autoLayout: false })
    const browserIssues = collectValidationIssues({
      graphErrors: validateWorkflowGraph(nodes, edges),
      nodes,
      edges,
      definition,
      outOfBandAgentIds: new Set([VOICE_AGENT]),
    })
    const { evaluation } = await evaluateOnServer(currentBridge, definition)

    expect(outOfBandProblems(browserIssues)).toEqual([])
    expect(outOfBandProblems(evaluation.problems)).toEqual([])
  })
})
