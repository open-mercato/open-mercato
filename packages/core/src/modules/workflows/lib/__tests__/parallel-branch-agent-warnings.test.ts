/**
 * Author-time check: an agent that answers OUT OF BAND inside a parallel branch
 * (design §7 risk R4).
 *
 * At run time this is `AgentSuspensionUnsupportedError` — typed, non-retryable,
 * and raised only AFTER the external effector has run, which for the driving use
 * case means after a real phone call was placed. The whole point of this check is
 * that an author sees it in the Studio's Problems panel first.
 *
 * The two halves that must both hold:
 *  - it FIRES on the real mistake, naming the offending step; and
 *  - it stays SILENT everywhere else — the same agent outside a branch, a native
 *    agent inside one, and above all whenever the agent catalogue could not be
 *    read. That last one is the module's standing rule: unknown is not
 *    "suspends", and a warning on every agent step would train authors to ignore
 *    the panel.
 *
 * It is a WARNING, never an error: the definition stays saveable.
 */

import { describe, test, expect } from '@jest/globals'
import {
  collectParallelBranchAgentWarnings,
  collectParallelBranchStepIds,
} from '../parallel-branch-agent-warnings'
import { collectFlowLogicWarnings } from '../flow-logic-warnings'
import { collectValidationIssues } from '../collect-validation-issues'

const VOICE_AGENT = 'elevenlabs.voice_caller'
const NATIVE_AGENT = 'deal_enricher'

function agentStep(stepId: string, agentId: string) {
  return {
    stepId,
    stepName: stepId,
    stepType: 'AUTOMATED',
    activities: [
      {
        activityId: `${stepId}_agent`,
        activityType: 'INVOKE_AGENT',
        config: { agentId, input: {} },
      },
    ],
  }
}

function plainStep(stepId: string, stepType = 'AUTOMATED', config?: Record<string, unknown>) {
  return { stepId, stepName: stepId, stepType, ...(config ? { config } : {}) }
}

function route(transitionId: string, fromStepId: string, toStepId: string, extra: Record<string, unknown> = {}) {
  return { transitionId, fromStepId, toStepId, trigger: 'auto', ...extra }
}

/**
 * start → fork ⇉ (branch_a → agent step) + (branch_b → notify) → join → end.
 * The agent step is the one inside the branch.
 */
function definitionWithAgentInsideBranch(agentId: string) {
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
  }
}

/** The same graph with the agent step moved AFTER the join. */
function definitionWithAgentOutsideBranch(agentId: string) {
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
  }
}

describe('branch membership', () => {
  test('maps every step between a fork and its join onto that fork, and nothing past the join', () => {
    const membership = collectParallelBranchStepIds(definitionWithAgentInsideBranch(VOICE_AGENT))

    expect([...membership.keys()].sort()).toEqual(['call_owner', 'notify'])
    expect(membership.get('call_owner')).toBe('fork')
    expect(membership.has('join')).toBe(false)
    expect(membership.has('end')).toBe(false)
    expect(membership.has('start')).toBe(false)
  })

  test('a definition with no fork has no branch members', () => {
    expect(
      collectParallelBranchStepIds({
        steps: [plainStep('start', 'START'), agentStep('call_owner', VOICE_AGENT), plainStep('end', 'END')],
        transitions: [route('t1', 'start', 'call_owner'), route('t2', 'call_owner', 'end')],
      }).size,
    ).toBe(0)
  })

  test('a cycle inside a branch terminates instead of hanging', () => {
    const membership = collectParallelBranchStepIds({
      steps: [
        plainStep('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
        plainStep('a'),
        plainStep('b'),
        plainStep('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
      ],
      transitions: [
        route('t_a', 'fork', 'a'),
        route('t_b', 'fork', 'b'),
        route('t_ab', 'a', 'b'),
        route('t_ba', 'b', 'a'),
      ],
    })

    expect([...membership.keys()].sort()).toEqual(['a', 'b'])
  })

  test('a fork missing its joinStepId still walks (that is validateParallelForkJoin’s diagnostic, not ours)', () => {
    const membership = collectParallelBranchStepIds({
      steps: [plainStep('fork', 'PARALLEL_FORK'), plainStep('a'), plainStep('b')],
      transitions: [route('t_a', 'fork', 'a'), route('t_b', 'fork', 'b')],
    })

    expect([...membership.keys()].sort()).toEqual(['a', 'b'])
  })
})

describe('an out-of-band agent inside a parallel branch', () => {
  test('raises exactly one warning naming that step and that agent', () => {
    const warnings = collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch(VOICE_AGENT), {
      outOfBandAgentIds: new Set([VOICE_AGENT]),
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ stepId: 'call_owner', agentId: VOICE_AGENT, forkStepId: 'fork' })
    // Zod-style path so the Problems panel can map it onto the canvas node.
    expect(warnings[0].path).toEqual(['steps', 2])
  })

  test('the same agent OUTSIDE the branch raises nothing', () => {
    expect(
      collectParallelBranchAgentWarnings(definitionWithAgentOutsideBranch(VOICE_AGENT), {
        outOfBandAgentIds: new Set([VOICE_AGENT]),
      }),
    ).toEqual([])
  })

  test('a native agent inside the branch raises nothing', () => {
    expect(
      collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch(NATIVE_AGENT), {
        outOfBandAgentIds: new Set([VOICE_AGENT]),
      }),
    ).toEqual([])
  })
})

describe('degrading honestly', () => {
  test('an unreadable catalogue (no id set) reports nothing at all', () => {
    expect(collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch(VOICE_AGENT), {})).toEqual([])
    expect(
      collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch(VOICE_AGENT), {
        outOfBandAgentIds: null,
      }),
    ).toEqual([])
  })

  test('an EMPTY catalogue reports nothing — unknown is not "suspends"', () => {
    expect(
      collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch(VOICE_AGENT), {
        outOfBandAgentIds: new Set<string>(),
      }),
    ).toEqual([])
  })

  test('an agent the catalogue does not carry reports nothing', () => {
    expect(
      collectParallelBranchAgentWarnings(definitionWithAgentInsideBranch('agent.nobody.registered'), {
        outOfBandAgentIds: new Set([VOICE_AGENT]),
      }),
    ).toEqual([])
  })

  test('a missing definition reports nothing', () => {
    expect(
      collectParallelBranchAgentWarnings(null, { outOfBandAgentIds: new Set([VOICE_AGENT]) }),
    ).toEqual([])
  })
})

describe('the Problems panel', () => {
  test('renders it as a WARNING that does not block a save', () => {
    const definition = definitionWithAgentInsideBranch(VOICE_AGENT)
    const issues = collectValidationIssues({
      graphErrors: [],
      nodes: [],
      edges: [],
      definition: definition as never,
      outOfBandAgentIds: new Set([VOICE_AGENT]),
    })

    const issue = issues.find((entry) => entry.message.includes(VOICE_AGENT))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
    // The Save handler blocks on errors only; a warning must never appear there.
    expect(issues.filter((entry) => entry.severity === 'error')).toEqual([])
  })

  test('the message names the step, the agent, the reason and the remedy', () => {
    const issues = collectValidationIssues({
      graphErrors: [],
      nodes: [],
      edges: [],
      definition: definitionWithAgentInsideBranch(VOICE_AGENT) as never,
      outOfBandAgentIds: new Set([VOICE_AGENT]),
    })

    const message = issues[0]?.message ?? ''
    expect(message).toContain('call_owner')
    expect(message).toContain(VOICE_AGENT)
    expect(message).toContain('out of band')
    expect(message).toContain('parallel branch')
  })

  test('flows through collectFlowLogicWarnings under its own code', () => {
    const warnings = collectFlowLogicWarnings(definitionWithAgentInsideBranch(VOICE_AGENT) as never, {
      outOfBandAgentIds: new Set([VOICE_AGENT]),
    })

    const warning = warnings.find((entry) => entry.code === 'agentOutOfBandInParallelBranch')
    expect(warning).toBeDefined()
    expect(warning?.severity).toBe('warning')
    expect(warning?.params).toMatchObject({ stepId: 'call_owner', agentId: VOICE_AGENT, forkStepId: 'fork' })
  })

  test('a definition the caller gives no agent catalogue for produces no flow-logic warning of this code', () => {
    const warnings = collectFlowLogicWarnings(definitionWithAgentInsideBranch(VOICE_AGENT) as never, {})
    expect(warnings.some((entry) => entry.code === 'agentOutOfBandInParallelBranch')).toBe(false)
  })
})
