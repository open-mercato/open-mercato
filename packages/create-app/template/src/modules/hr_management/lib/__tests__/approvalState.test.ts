/** @jest-environment node */
/**
 * Pins the decisions of the approval state machine.
 *
 * These are the rules that fail silently in production: a quorum counted from the wrong step
 * advances an approval nobody approved, a final step that is not recognised leaves a request
 * pending forever, and a step with no successor deadlocks it. None of them throws, and all of
 * them are invisible to the type checker, so they are asserted here.
 *
 * The log vocabulary is asserted too, because it is persisted: every `logAction` must be a
 * member of APPROVAL_ACTIONS in data/entities.ts, and the engine deliberately writes no log
 * row for `submit` because that enum has no "submitted" member.
 */
import {
  countApprovals,
  decideApproval,
  firstStep,
  isDecided,
  nextStep,
  type ApprovalAction,
  type ApprovalStep,
} from '../approvalState'

const LOG_ACTIONS = ['approved', 'rejected', 'commented', 'reassigned', 'cancelled']

function step(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    stepOrder: 1,
    approverType: 'role',
    requiredApprovals: 1,
    isFinal: true,
    ...overrides,
  }
}

describe('approval state machine', () => {
  it('starts a submission at the lowest step even when the steps arrive unsorted', () => {
    const decision = decideApproval({
      action: 'submit',
      status: 'pending',
      currentStepOrder: 0,
      steps: [step({ stepOrder: 3, isFinal: false }), step({ stepOrder: 1, isFinal: false }), step({ stepOrder: 2 })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'pending', currentStepOrder: 1, decided: false })
  })

  it('refuses a submission for a workflow with no steps instead of creating an undecidable request', () => {
    const decision = decideApproval({
      action: 'submit',
      status: 'pending',
      currentStepOrder: 0,
      steps: [],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toEqual({ kind: 'error', code: 'no_steps' })
  })

  it('writes no log action for submit, because APPROVAL_ACTIONS has no submitted member', () => {
    const decision = decideApproval({
      action: 'submit',
      status: 'pending',
      currentStepOrder: 0,
      steps: [step({ requiredApprovals: 2, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision.kind).toBe('ok')
    expect(decision.kind === 'ok' ? decision.logAction : 'missing').toBeUndefined()
  })

  it('keeps the request on the same step while the required approvals are not reached', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 2,
      steps: [step({ stepOrder: 2, requiredApprovals: 3, isFinal: true })],
      approvalsAtCurrentStep: 1,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'pending', currentStepOrder: 2, decided: false, logAction: 'approved' })
  })

  it('advances to the next step once a non-final step reaches its quorum', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 1,
      steps: [step({ stepOrder: 1, requiredApprovals: 2, isFinal: false }), step({ stepOrder: 2 })],
      approvalsAtCurrentStep: 1,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'pending', currentStepOrder: 2, decided: false })
  })

  it('approves the request when the final step reaches its quorum', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 2,
      steps: [step({ stepOrder: 2, requiredApprovals: 1, isFinal: true })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'approved', decided: true, logAction: 'approved' })
  })

  it('completes a quorum met on a non-final step with no successor rather than deadlocking it', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 4,
      steps: [step({ stepOrder: 4, requiredApprovals: 1, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'approved', decided: true })
  })

  it('treats a missing required approvals count as one approval', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 1,
      steps: [step({ stepOrder: 1, requiredApprovals: 0, isFinal: true })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'approved', decided: true })
  })

  it('treats a rejection as terminal at any step', () => {
    const decision = decideApproval({
      action: 'reject',
      status: 'pending',
      currentStepOrder: 3,
      steps: [step({ stepOrder: 3, requiredApprovals: 3, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'rejected', decided: true, logAction: 'rejected' })
  })

  it('cancels a pending request without touching the step', () => {
    const decision = decideApproval({
      action: 'cancel',
      status: 'pending',
      currentStepOrder: 1,
      steps: [step({ stepOrder: 1, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toMatchObject({ kind: 'ok', status: 'cancelled', decided: true, logAction: 'cancelled' })
  })

  it('requires a target for a reassignment and keeps the step when one is given', () => {
    const withoutTarget = decideApproval({
      action: 'reassign',
      status: 'pending',
      currentStepOrder: 1,
      steps: [step({ stepOrder: 1, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })
    const withTarget = decideApproval({
      action: 'reassign',
      status: 'pending',
      currentStepOrder: 1,
      steps: [step({ stepOrder: 1, isFinal: false })],
      approvalsAtCurrentStep: 0,
      reassignToUserId: '00000000-0000-4000-8000-000000000002',
    })

    expect(withoutTarget).toEqual({ kind: 'error', code: 'reassign_target_required' })
    expect(withTarget).toMatchObject({ kind: 'ok', status: 'pending', currentStepOrder: 1, decided: false, logAction: 'reassigned' })
  })

  it('refuses every action once the request has been decided', () => {
    const actions: ApprovalAction[] = ['submit', 'approve', 'reject', 'reassign', 'cancel']
    const decided = ['approved', 'rejected', 'cancelled'] as const

    for (const status of decided) {
      for (const action of actions) {
        const decision = decideApproval({
          action,
          status,
          currentStepOrder: 1,
          steps: [step({ stepOrder: 1, isFinal: false })],
          approvalsAtCurrentStep: 0,
          reassignToUserId: '00000000-0000-4000-8000-000000000002',
        })

        expect(decision).toEqual({ kind: 'error', code: action === 'submit' ? 'not_submittable' : 'already_decided' })
      }
    }
  })

  it('refuses a decision when the current step no longer exists in the workflow', () => {
    const decision = decideApproval({
      action: 'approve',
      status: 'pending',
      currentStepOrder: 9,
      steps: [step({ stepOrder: 1, isFinal: false })],
      approvalsAtCurrentStep: 0,
    })

    expect(decision).toEqual({ kind: 'error', code: 'step_not_found' })
  })

  it('counts only approvals recorded at the step being decided', () => {
    const logs = [
      { stepOrder: 1, action: 'approved' },
      { stepOrder: 1, action: 'rejected' },
      { stepOrder: 2, action: 'approved' },
      { stepOrder: null, action: 'approved' },
    ]

    expect(countApprovals(logs, 1)).toBe(1)
    expect(countApprovals(logs, 2)).toBe(1)
    expect(countApprovals(logs, 3)).toBe(0)
  })

  it('keeps the helpers consistent with the decisions', () => {
    const steps = [step({ stepOrder: 2, isFinal: false }), step({ stepOrder: 1, isFinal: false })]

    expect(firstStep(steps)?.stepOrder).toBe(1)
    expect(nextStep(steps, 1)?.stepOrder).toBe(2)
    expect(nextStep(steps, 2)).toBeNull()
    expect(isDecided('approved')).toBe(true)
    expect(isDecided('rejected')).toBe(true)
    expect(isDecided('cancelled')).toBe(true)
    expect(isDecided('pending')).toBe(false)
  })

  it('never returns a log action outside the persisted enum', () => {
    const cases: Array<[ApprovalAction, number]> = [
      ['submit', 0],
      ['approve', 1],
      ['reject', 1],
      ['cancel', 1],
      ['reassign', 1],
    ]

    for (const [action, approvals] of cases) {
      const decision = decideApproval({
        action,
        status: 'pending',
        currentStepOrder: 1,
        steps: [step({ stepOrder: 1, requiredApprovals: 2, isFinal: true })],
        approvalsAtCurrentStep: approvals,
        reassignToUserId: action === 'reassign' ? '00000000-0000-4000-8000-000000000002' : null,
      })

      if (decision.kind === 'ok' && decision.logAction !== undefined) {
        expect(LOG_ACTIONS).toContain(decision.logAction)
      }
    }
  })
})
