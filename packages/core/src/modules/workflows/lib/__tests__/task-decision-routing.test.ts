/**
 * Step 2.4 — pressing a decision button.
 *
 * Checkpoint 2 decision #2 split one word into two requirements, and these
 * assertions keep them split:
 *
 * - the button LIST is re-resolved from the instance's pinned definition, so
 *   nothing is denormalized onto the row and a definition edit is visible
 *   immediately;
 * - the pressed button is an audit fact about the completion, recorded inside
 *   the completion payload that already exists rather than in a new column.
 *
 * The routing assertions matter just as much: a decision that did not select
 * its own outgoing route would look like it worked while the run went wherever
 * the first valid transition pointed.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  TASK_DECISION_FORM_KEY,
  findTaskDecision,
  findTaskDecisionTransition,
  readAuthoredTaskDecisions,
  readRecordedDecision,
  withRecordedDecision,
} from '../task-decisions'
import type { ResolvedTaskDecision } from '../task-resolution'

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(),
}))

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
}))

jest.mock('../step-handler', () => ({
  exitStep: jest.fn(),
}))

jest.mock('../activity-executor', () => ({
  interpolateVariables: (value: unknown) => value,
}))

import { completeUserTask } from '../task-handler'
import { findDefinitionForInstance } from '../find-definition'
import * as transitionHandler from '../transition-handler'
import { executeWorkflow } from '../workflow-executor'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const USER = '33333333-3333-3333-3333-333333333333'
const TASK_ID = '44444444-4444-4444-4444-444444444444'
const INSTANCE_ID = '55555555-5555-5555-5555-555555555555'
const STEP_INSTANCE_ID = '66666666-6666-6666-6666-666666666666'

const scope = { tenantId: TENANT, organizationId: ORG }

// ---------------------------------------------------------------------------
// Pure half — no database, no engine
// ---------------------------------------------------------------------------

const decisions: ResolvedTaskDecision[] = [
  { id: 'approve', label: 'Approve', transitionId: 't_approve' },
  { id: 'reject', label: 'Reject', transitionId: 't_reject', style: 'destructive' },
]

describe('decision lookup', () => {
  test('finds an authored decision by id', () => {
    expect(findTaskDecision(decisions, 'reject')?.transitionId).toBe('t_reject')
  })

  test('an id nobody authored resolves to nothing rather than the first button', () => {
    expect(findTaskDecision(decisions, 'escalate')).toBeNull()
  })
})

describe('decision route selection', () => {
  const transitions = [
    { transitionId: 't_approve', fromStepId: 'review', toStepId: 'fulfil' },
    { transitionId: 't_reject', fromStepId: 'review', toStepId: 'cancelled' },
    { transitionId: 't_retry', fromStepId: 'other-step', toStepId: 'review' },
    { transitionId: 't_boom', fromStepId: 'review', toStepId: 'handler', kind: 'error' },
  ]

  test('selects the route bound to the decision, not the first one out of the step', () => {
    expect(findTaskDecisionTransition(transitions, 't_reject', 'review')?.toStepId).toBe('cancelled')
  })

  test('refuses a route that does not leave the step the task is parked on', () => {
    expect(findTaskDecisionTransition(transitions, 't_retry', 'review')).toBeNull()
  })

  test('never selects an error route — those are reachable only from a failure', () => {
    expect(findTaskDecisionTransition(transitions, 't_boom', 'review')).toBeNull()
  })

  test('degrades to nothing when the definition carries no transitions', () => {
    expect(findTaskDecisionTransition([], 't_approve', 'review')).toBeNull()
    expect(findTaskDecisionTransition(undefined, 't_approve', 'review')).toBeNull()
  })
})

describe('recording the choice inside the completion payload', () => {
  test('adds the reserved key without disturbing the authored fields', () => {
    const recorded = withRecordedDecision({ amount: 10 }, 'approve')
    expect(recorded).toEqual({ amount: 10, [TASK_DECISION_FORM_KEY]: 'approve' })
  })

  test('a completion with no decision is byte-identical to the payload it was given', () => {
    const formData = { amount: 10 }
    expect(withRecordedDecision(formData, undefined)).toBe(formData)
  })

  test('reads the choice back off a completed task', () => {
    expect(readRecordedDecision({ [TASK_DECISION_FORM_KEY]: 'reject' })).toBe('reject')
    expect(readRecordedDecision({ amount: 10 })).toBeNull()
    expect(readRecordedDecision(null)).toBeNull()
  })
})

describe('reading authored decisions off a pinned definition', () => {
  const definition = {
    steps: [
      {
        stepId: 'review',
        userTaskConfig: {
          decisions: [
            { id: 'approve', label: 'Approve', transitionId: 't_approve' },
            { id: '', label: 'Nameless', transitionId: 't_x' },
            { label: 'Unbound', transitionId: undefined },
            'not-an-object',
          ],
        },
      },
      { stepId: 'fulfil' },
    ],
  }

  test('returns the decisions authored on that step', () => {
    expect(readAuthoredTaskDecisions(definition, 'review')).toEqual([
      { id: 'approve', label: 'Approve', transitionId: 't_approve' },
    ])
  })

  test('a step with no decisions yields none', () => {
    expect(readAuthoredTaskDecisions(definition, 'fulfil')).toEqual([])
  })

  test('a definition that is not a graph yields none instead of throwing', () => {
    expect(readAuthoredTaskDecisions(null, 'review')).toEqual([])
    expect(readAuthoredTaskDecisions({ steps: 'nope' }, 'review')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Engine half — completing WITH a decision
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function makeTask(overrides: Row = {}): Row {
  return {
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    workflowInstanceId: INSTANCE_ID,
    stepInstanceId: STEP_INSTANCE_ID,
    taskName: 'Review refund',
    status: 'PENDING',
    assignedTo: null,
    assignedToRoles: ['approver'],
    claimedBy: null,
    branchInstanceId: null,
    formSchema: null,
    formData: null,
    ...overrides,
  }
}

const definitionData = {
  steps: [
    {
      stepId: 'review',
      stepType: 'USER_TASK',
      userTaskConfig: {
        decisions: [
          { id: 'approve', label: 'Approve', transitionId: 't_approve' },
          { id: 'reject', label: 'Reject', transitionId: 't_reject' },
        ],
      },
    },
  ],
  transitions: [
    { transitionId: 't_approve', fromStepId: 'review', toStepId: 'fulfil', trigger: 'auto' },
    { transitionId: 't_reject', fromStepId: 'review', toStepId: 'cancelled', trigger: 'auto' },
  ],
}

function makeEm(task: Row) {
  const instance: Row = {
    id: INSTANCE_ID,
    definitionId: 'def-1',
    workflowId: 'refunds',
    tenantId: TENANT,
    organizationId: ORG,
    currentStepId: 'review',
    context: { orderId: 'order-1' },
    status: 'PAUSED',
  }
  const stepInstance: Row = { id: STEP_INSTANCE_ID, stepId: 'review', status: 'ACTIVE' }
  const events: Row[] = []

  const findOne = jest.fn(async (entity: { name?: string }, where: unknown) => {
    switch (entity?.name) {
      case 'UserTask': {
        const filter = where as Record<string, unknown>
        if (filter.tenantId !== task.tenantId) return null
        return task
      }
      case 'WorkflowInstance':
        return instance
      case 'StepInstance':
        return stepInstance
      default:
        return null
    }
  })

  const flush = jest.fn(async () => undefined)
  const create = jest.fn((_entity: unknown, data: Row) => {
    const row = { ...data }
    events.push(row)
    return row
  })
  const persist = jest.fn(() => ({ flush }))

  return {
    em: { findOne, flush, create, persist } as unknown as EntityManager,
    task,
    instance,
    events,
  }
}

const container = { resolve: jest.fn(() => undefined) } as unknown as AwilixContainer

describe('completeUserTask with a decision', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findDefinitionForInstance as jest.Mock).mockResolvedValue({
      id: 'def-1',
      definition: definitionData,
    } as never)
    ;(transitionHandler.executeTransition as jest.Mock).mockResolvedValue({ success: true } as never)
    ;(transitionHandler.findValidTransitions as jest.Mock).mockResolvedValue([
      { isValid: true, transition: { transitionId: 't_approve', toStepId: 'fulfil' } },
    ] as never)
  })

  test('routes down the decision it was given, not the first valid transition', async () => {
    const { em } = makeEm(makeTask())

    await completeUserTask(em, container, {
      taskId: TASK_ID,
      formData: {},
      userId: USER,
      decisionId: 'reject',
      scope,
    })

    expect(transitionHandler.executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'review',
      'cancelled',
      expect.anything(),
    )
    // The default evaluation must not even be consulted once a decision picked
    // the route — that lookup is what would silently override the operator.
    expect(transitionHandler.findValidTransitions).not.toHaveBeenCalled()
    expect(executeWorkflow).toHaveBeenCalled()
  })

  test('records WHICH decision was pressed in the completion payload and the audit event', async () => {
    const { em, task, instance, events } = makeEm(makeTask())

    await completeUserTask(em, container, {
      taskId: TASK_ID,
      formData: { note: 'looks fine' },
      userId: USER,
      decisionId: 'approve',
      scope,
    })

    expect(task.formData).toEqual({ note: 'looks fine', [TASK_DECISION_FORM_KEY]: 'approve' })
    expect(readRecordedDecision(task.formData)).toBe('approve')
    // Merged into the run context, so a downstream route condition can branch
    // on the operator's choice.
    expect((instance.context as Record<string, unknown>)[TASK_DECISION_FORM_KEY]).toBe('approve')

    const completed = events.find((event) => event.eventType === 'USER_TASK_COMPLETED')
    expect(completed?.eventData).toMatchObject({ decisionId: 'approve' })
  })

  test('an unknown decision is refused BEFORE the task is mutated', async () => {
    const { em, task } = makeEm(makeTask())

    await expect(
      completeUserTask(em, container, {
        taskId: TASK_ID,
        formData: {},
        userId: USER,
        decisionId: 'escalate',
        scope,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_DECISION' })

    expect(task.status).toBe('PENDING')
    expect(task.formData).toBeNull()
    expect(transitionHandler.executeTransition).not.toHaveBeenCalled()
  })

  test('a decision whose route no longer leaves this step falls back instead of stranding the run', async () => {
    const { em } = makeEm(makeTask())
    ;(findDefinitionForInstance as jest.Mock).mockResolvedValue({
      id: 'def-1',
      definition: {
        ...definitionData,
        transitions: [
          // The decision's route was re-pointed away from this step…
          { transitionId: 't_approve', fromStepId: 'somewhere-else', toStepId: 'archived', trigger: 'auto' },
          // …but the step still has an ordinary way out.
          { transitionId: 't_default', fromStepId: 'review', toStepId: 'fulfil', trigger: 'auto' },
        ],
      },
    } as never)

    await completeUserTask(em, container, {
      taskId: TASK_ID,
      formData: {},
      userId: USER,
      decisionId: 'approve',
      scope,
    })

    expect(transitionHandler.findValidTransitions).toHaveBeenCalled()
    expect(transitionHandler.executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'review',
      'fulfil',
      expect.anything(),
    )
  })
})

/**
 * Regression: decisions are additive. A task on a step that authored none must
 * complete through the plain form exactly as it did before this step existed —
 * no reserved key written, no decision lookup imposed on the routing path.
 */
describe('completeUserTask without a decision', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findDefinitionForInstance as jest.Mock).mockResolvedValue({
      id: 'def-1',
      definition: {
        steps: [{ stepId: 'review', stepType: 'USER_TASK', userTaskConfig: {} }],
        transitions: definitionData.transitions,
      },
    } as never)
    ;(transitionHandler.executeTransition as jest.Mock).mockResolvedValue({ success: true } as never)
    ;(transitionHandler.findValidTransitions as jest.Mock).mockResolvedValue([
      { isValid: true, transition: { transitionId: 't_approve', toStepId: 'fulfil' } },
    ] as never)
  })

  test('completes through the plain form and writes no reserved key', async () => {
    const { em, task } = makeEm(makeTask())

    await completeUserTask(em, container, {
      taskId: TASK_ID,
      formData: { note: 'done' },
      userId: USER,
      scope,
    })

    expect(task.status).toBe('COMPLETED')
    expect(task.formData).toEqual({ note: 'done' })
    expect(readRecordedDecision(task.formData)).toBeNull()
    expect(transitionHandler.findValidTransitions).toHaveBeenCalled()
    expect(transitionHandler.executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'review',
      'fulfil',
      expect.anything(),
    )
  })
})
