import { describe, test, expect } from '@jest/globals'
import {
  validateParallelForkJoin,
  workflowInstanceStatusSchema,
  workflowBranchInstanceStatusSchema,
  type ForkJoinValidationCode,
} from '../validators'

type StepType =
  | 'START' | 'END' | 'USER_TASK' | 'AUTOMATED'
  | 'PARALLEL_FORK' | 'PARALLEL_JOIN' | 'SUB_WORKFLOW'
  | 'WAIT_FOR_SIGNAL' | 'WAIT_FOR_TIMER'

const step = (stepId: string, stepType: StepType, config?: Record<string, unknown>) => ({
  stepId,
  stepType,
  config: config ?? undefined,
})

const transition = (transitionId: string, fromStepId: string, toStepId: string, trigger = 'auto') => ({
  transitionId,
  fromStepId,
  toStepId,
  trigger,
})

const codes = (issues: { code: ForkJoinValidationCode }[]) => issues.map((issue) => issue.code)

/**
 * A valid 2-branch FORK/JOIN definition:
 *   start → fork ⇉ (a, b) ⇉ join → end
 */
function validTwoBranch() {
  return {
    steps: [
      step('start', 'START'),
      step('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
      step('a', 'AUTOMATED'),
      step('b', 'AUTOMATED'),
      step('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
      step('end', 'END'),
    ],
    transitions: [
      transition('t-start-fork', 'start', 'fork'),
      transition('t-fork-a', 'fork', 'a'),
      transition('t-fork-b', 'fork', 'b'),
      transition('t-a-join', 'a', 'join'),
      transition('t-b-join', 'b', 'join'),
      transition('t-join-end', 'join', 'end'),
    ],
  }
}

describe('validateParallelForkJoin', () => {
  test('accepts a valid 2-branch fork/join', () => {
    expect(validateParallelForkJoin(validTwoBranch())).toEqual([])
  })

  test('accepts a valid 3-branch fork/join', () => {
    const def = {
      steps: [
        step('start', 'START'),
        step('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
        step('a', 'AUTOMATED'),
        step('b', 'USER_TASK'),
        step('c', 'AUTOMATED'),
        step('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
        step('end', 'END'),
      ],
      transitions: [
        transition('t-start-fork', 'start', 'fork'),
        transition('t-fa', 'fork', 'a'),
        transition('t-fb', 'fork', 'b'),
        transition('t-fc', 'fork', 'c'),
        transition('t-aj', 'a', 'join'),
        transition('t-bj', 'b', 'join'),
        transition('t-cj', 'c', 'join'),
        transition('t-je', 'join', 'end'),
      ],
    }
    expect(validateParallelForkJoin(def as any)).toEqual([])
  })

  test('accepts a multi-step branch that eventually converges', () => {
    const def = validTwoBranch()
    // Extend branch a: a → a2 → join
    def.steps.push(step('a2', 'AUTOMATED'))
    def.transitions = def.transitions.filter((t) => t.transitionId !== 't-a-join')
    def.transitions.push(transition('t-a-a2', 'a', 'a2'))
    def.transitions.push(transition('t-a2-join', 'a2', 'join'))
    expect(validateParallelForkJoin(def)).toEqual([])
  })

  test('flags a fork missing config.joinStepId', () => {
    const def = validTwoBranch()
    def.steps = def.steps.map((s) => (s.stepId === 'fork' ? step('fork', 'PARALLEL_FORK') : s))
    expect(codes(validateParallelForkJoin(def))).toContain('MISSING_JOIN_STEP_ID')
  })

  test('flags a fork pointing at a missing join step', () => {
    const def = validTwoBranch()
    def.steps = def.steps.map((s) => (s.stepId === 'fork' ? step('fork', 'PARALLEL_FORK', { joinStepId: 'nope' }) : s))
    expect(codes(validateParallelForkJoin(def))).toContain('JOIN_STEP_NOT_FOUND')
  })

  test('flags a join missing its back-reference forkStepId', () => {
    const def = validTwoBranch()
    def.steps = def.steps.map((s) => (s.stepId === 'join' ? step('join', 'PARALLEL_JOIN') : s))
    expect(codes(validateParallelForkJoin(def))).toContain('MISSING_FORK_STEP_ID')
  })

  test('flags a fork/join back-reference mismatch', () => {
    const def = validTwoBranch()
    def.steps = def.steps.map((s) => (s.stepId === 'join' ? step('join', 'PARALLEL_JOIN', { forkStepId: 'other' }) : s))
    expect(codes(validateParallelForkJoin(def))).toContain('FORK_JOIN_MISMATCH')
  })

  test('flags a fork with fewer than 2 branches', () => {
    const def = {
      steps: [
        step('start', 'START'),
        step('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
        step('a', 'AUTOMATED'),
        step('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
        step('end', 'END'),
      ],
      transitions: [
        transition('t-start-fork', 'start', 'fork'),
        transition('t-fa', 'fork', 'a'),
        transition('t-aj', 'a', 'join'),
        transition('t-je', 'join', 'end'),
      ],
    }
    const result = codes(validateParallelForkJoin(def as any))
    expect(result).toContain('FORK_TOO_FEW_BRANCHES')
    expect(result).toContain('JOIN_TOO_FEW_INCOMING')
  })

  test('flags a branch that hits END before the join (no convergence)', () => {
    const def = validTwoBranch()
    // Reroute branch b to end instead of join.
    def.transitions = def.transitions.map((t) => (t.transitionId === 't-b-join' ? transition('t-b-join', 'b', 'end') : t))
    expect(codes(validateParallelForkJoin(def))).toContain('NO_CONVERGENCE_TO_JOIN')
  })

  test('flags a branch that dead-ends without reaching the join', () => {
    const def = validTwoBranch()
    // Remove branch b's transition to join → dead end at b.
    def.transitions = def.transitions.filter((t) => t.transitionId !== 't-b-join')
    expect(codes(validateParallelForkJoin(def))).toContain('NO_CONVERGENCE_TO_JOIN')
  })

  test('flags a nested fork inside a branch', () => {
    const def = {
      steps: [
        step('start', 'START'),
        step('fork', 'PARALLEL_FORK', { joinStepId: 'join' }),
        step('a', 'AUTOMATED'),
        step('innerFork', 'PARALLEL_FORK', { joinStepId: 'innerJoin' }),
        step('x', 'AUTOMATED'),
        step('y', 'AUTOMATED'),
        step('innerJoin', 'PARALLEL_JOIN', { forkStepId: 'innerFork' }),
        step('join', 'PARALLEL_JOIN', { forkStepId: 'fork' }),
        step('end', 'END'),
      ],
      transitions: [
        transition('t-start-fork', 'start', 'fork'),
        transition('t-fa', 'fork', 'a'),
        transition('t-fif', 'fork', 'innerFork'),
        transition('t-aj', 'a', 'join'),
        transition('t-ifx', 'innerFork', 'x'),
        transition('t-ify', 'innerFork', 'y'),
        transition('t-xij', 'x', 'innerJoin'),
        transition('t-yij', 'y', 'innerJoin'),
        transition('t-ijj', 'innerJoin', 'join'),
        transition('t-je', 'join', 'end'),
      ],
    }
    expect(codes(validateParallelForkJoin(def as any))).toContain('NESTED_FORK_NOT_SUPPORTED')
  })

  test('flags a cycle within a branch region', () => {
    const def = validTwoBranch()
    def.steps.push(step('a2', 'AUTOMATED'))
    def.transitions = def.transitions.filter((t) => t.transitionId !== 't-a-join')
    def.transitions.push(transition('t-a-a2', 'a', 'a2'))
    def.transitions.push(transition('t-a2-a', 'a2', 'a')) // cycle a → a2 → a
    expect(codes(validateParallelForkJoin(def))).toContain('FORK_JOIN_CYCLE')
  })

  test('flags an unpaired join', () => {
    const def = validTwoBranch()
    def.steps.push(step('orphanJoin', 'PARALLEL_JOIN'))
    expect(codes(validateParallelForkJoin(def))).toContain('UNPAIRED_JOIN')
  })

  test('returns no issues for a definition with no fork/join steps', () => {
    const def = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [transition('t-se', 'start', 'end')],
    }
    expect(validateParallelForkJoin(def as any)).toEqual([])
  })
})

describe('status schemas include parallel states', () => {
  test('workflowInstanceStatusSchema accepts FORKED', () => {
    expect(workflowInstanceStatusSchema.parse('FORKED')).toBe('FORKED')
  })

  test('workflowBranchInstanceStatusSchema accepts branch states', () => {
    for (const value of ['ACTIVE', 'PAUSED', 'WAITING_FOR_ACTIVITIES', 'COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(workflowBranchInstanceStatusSchema.parse(value)).toBe(value)
    }
  })
})
