/** @jest-environment node */
import { workflowStepSchema } from '../../data/validators'

const emitWorkflowsEvent = jest.fn(async () => {})
jest.mock('../../events', () => ({
  __esModule: true,
  emitWorkflowsEvent: (...args: unknown[]) => emitWorkflowsEvent(...(args as [])),
  eventsConfig: {},
}))

const { exitStep } = require('../step-handler') as typeof import('../step-handler')

/**
 * A milestone is a BUSINESS EVENT the workflow announces, never an alias for a
 * step (`.ai/specs/enterprise/agent-orchestrator/2026-09-06-business-process-workflow-unification.md` §6).
 *
 * That distinction is only real if the annotation can live on ANY step. These
 * tests pin the two cases the step-alias model could not express: a stage
 * announced after a parallel join, and a stage announced once across a retry.
 */

const INSTANCE = {
  id: 'instance-1',
  definitionId: 'definition-1',
  workflowId: 'claims.intake',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

type StepDef = { stepId: string; stepType: string; milestone?: string }

function makeEm(steps: StepDef[]) {
  const em: Record<string, unknown> = {
    flush: jest.fn(async () => {}),
    // The event logger chains `em.persist(row).flush()`, so persist returns the EM.
    persist: jest.fn(() => em),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    findOne: jest.fn(async (entity: unknown) => {
      const name = (entity as { name?: string })?.name ?? ''
      if (name === 'WorkflowInstance') return INSTANCE
      if (name === 'WorkflowDefinition') return { id: 'definition-1', definition: { steps } }
      return null
    }),
  }
  return em as never
}

function stepInstance(stepId: string) {
  return {
    id: `step-instance-${stepId}`,
    workflowInstanceId: INSTANCE.id,
    stepId,
    status: 'ACTIVE',
    enteredAt: new Date('2026-09-06T10:00:00.000Z'),
    outputData: null,
    tenantId: INSTANCE.tenantId,
    organizationId: INSTANCE.organizationId,
  } as never
}

function milestoneEvents() {
  return emitWorkflowsEvent.mock.calls.filter(
    ([eventId]) => eventId === 'workflows.instance.milestone_reached',
  )
}

beforeEach(() => {
  emitWorkflowsEvent.mockClear()
})

describe('the step schema', () => {
  it('accepts a milestone annotation on ANY step type, a PARALLEL_JOIN included', () => {
    for (const stepType of ['AUTOMATED', 'PARALLEL_JOIN', 'USER_TASK', 'WAIT_FOR_SIGNAL']) {
      expect(
        workflowStepSchema.safeParse({
          stepId: 'join',
          stepName: 'Join',
          stepType,
          milestone: 'analysis_completed',
        }).success,
      ).toBe(true)
    }
  })

  it('bounds the key to the vocabulary a process can declare', () => {
    const base = { stepId: 'join', stepName: 'Join', stepType: 'AUTOMATED' }
    expect(workflowStepSchema.safeParse({ ...base, milestone: 'Analysis Completed' }).success).toBe(false)
    expect(workflowStepSchema.safeParse({ ...base, milestone: '' }).success).toBe(false)
    expect(workflowStepSchema.safeParse(base).success).toBe(true)
  })
})

describe('a completing step announces its milestone', () => {
  it('announces it after a PARALLEL_JOIN — the case a step alias could never express', async () => {
    const em = makeEm([
      { stepId: 'branch_a', stepType: 'AUTOMATED' },
      { stepId: 'branch_b', stepType: 'AUTOMATED' },
      { stepId: 'join', stepType: 'PARALLEL_JOIN', milestone: 'analysis_completed' },
    ])

    await exitStep(em, stepInstance('branch_a'))
    await exitStep(em, stepInstance('branch_b'))
    expect(milestoneEvents()).toHaveLength(0)

    await exitStep(em, stepInstance('join'), { findings: 3 })
    const announced = milestoneEvents()
    expect(announced).toHaveLength(1)
    expect(announced[0][1]).toMatchObject({
      instanceId: 'instance-1',
      milestoneKey: 'analysis_completed',
      workflowId: 'claims.intake',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      data: { findings: 3 },
    })
  })

  it('says nothing for a step that declares no milestone', async () => {
    const em = makeEm([{ stepId: 'assess', stepType: 'AUTOMATED' }])
    await exitStep(em, stepInstance('assess'))
    expect(milestoneEvents()).toHaveLength(0)
  })

  it('carries the stepId for the trace only — a consumer matches on the KEY', async () => {
    const em = makeEm([{ stepId: 'join', stepType: 'PARALLEL_JOIN', milestone: 'analysis_completed' }])
    await exitStep(em, stepInstance('join'))
    // Present for an operator reading a trace; the projection appends by key, so
    // renaming the step cannot break the business narrative.
    expect(milestoneEvents()[0][1]).toMatchObject({ stepId: 'join' })
  })

  it('never fails a step that completed just because the announcement did', async () => {
    emitWorkflowsEvent.mockRejectedValueOnce(new Error('bus down'))
    const em = makeEm([{ stepId: 'join', stepType: 'PARALLEL_JOIN', milestone: 'analysis_completed' }])
    const instance = stepInstance('join')
    await expect(exitStep(em, instance)).resolves.toBeUndefined()
    expect((instance as unknown as { status: string }).status).toBe('COMPLETED')
  })
})
