import { describe, it, expect } from '@jest/globals'
import { runScorer } from '../lib/eval/registry'
import type { Json, ScorerRunView } from '../lib/eval/types'

/**
 * The eval half of the action vocabulary (spec `2026-08-11-agent-taxonomy.md`, step 9 +
 * the Integration coverage row "a `decision_maker` proposing an out-of-vocabulary action
 * is a failed assertion").
 *
 * The runtime check BLOCKS such an action at disposition time, which leaves nothing an
 * operator would ever look at. This assertion is what makes the same violation visible:
 * an agent that keeps proposing what it may not run is a prompt defect.
 */

const ALLOWED = ['set_stage', 'add_note']

function runView(overrides: Partial<ScorerRunView> = {}): ScorerRunView {
  return {
    input: null,
    output: null,
    resultKind: 'proposal',
    agentType: 'decision_maker',
    confidence: 0.9,
    status: 'ok',
    latencyMs: null,
    costMinor: null,
    inputTokens: null,
    outputTokens: null,
    toolCalls: [],
    stepCount: 0,
    disposition: null,
    ...overrides,
  }
}

function proposalOutput(...actionTypes: string[]): Json {
  return {
    kind: 'proposal',
    proposal: {
      options: actionTypes.map((type, index) => ({
        id: `option_${index + 1}`,
        label: `Option ${index + 1}`,
        confidence: 0.9,
        actions: [{ type, payload: {} }],
      })),
    },
  }
}

describe('the action_vocabulary scorer', () => {
  it('passes a decision_maker whose every proposed action is in its vocabulary', () => {
    const verdict = runScorer(
      'action_vocabulary',
      runView({ output: proposalOutput('set_stage', 'add_note') }),
      null,
      { allowedActions: ALLOWED, agentType: 'decision_maker' },
    )
    expect(verdict.passed).toBe(true)
    expect(verdict.score).toBe(1)
  })

  it('FAILS a decision_maker that proposed an out-of-vocabulary action', () => {
    const verdict = runScorer(
      'action_vocabulary',
      runView({ output: proposalOutput('set_stage', 'SEND_EMAIL') }),
      null,
      { allowedActions: ALLOWED, agentType: 'decision_maker' },
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.evidence).toMatchObject({ offending: ['SEND_EMAIL'] })
  })

  it('reads EVERY option, not only the leader — a rejected option still proposed it', () => {
    const verdict = runScorer(
      'action_vocabulary',
      runView({ output: proposalOutput('set_stage', 'set_stage', 'issue_refund') }),
      null,
      { allowedActions: ALLOWED },
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.evidence).toMatchObject({ offending: ['issue_refund'] })
  })

  it('SKIPS a run of another declared type rather than failing it', () => {
    const verdict = runScorer(
      'action_vocabulary',
      runView({ agentType: 'action', output: proposalOutput('SEND_EMAIL') }),
      null,
      { allowedActions: ALLOWED, agentType: 'decision_maker' },
    )
    expect(verdict.passed).toBeNull()
    expect(verdict.score).toBeNull()
  })

  it('SKIPS a run that proposed nothing — it cannot have proposed something forbidden', () => {
    const verdict = runScorer(
      'action_vocabulary',
      runView({ resultKind: 'researcher', agentType: 'researcher', output: { kind: 'researcher', data: { x: 1 } } }),
      null,
      { allowedActions: ALLOWED },
    )
    expect(verdict.passed).toBeNull()
  })

  it('coerces allowedActions per element, so one bad entry cannot empty the allowlist', () => {
    // A whole-array schema with `.catch([])` would substitute an EMPTY list here, and an
    // empty allowlist passes vacuously — a stored gate would silently flip fail → pass.
    const verdict = runScorer(
      'action_vocabulary',
      runView({ output: proposalOutput('SEND_EMAIL') }),
      null,
      { allowedActions: ['set_stage', 7] },
    )
    expect(verdict.passed).toBe(false)
  })
})
