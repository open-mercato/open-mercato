import { resumeBranchAfterActivities } from '../parallel-handler'
import { WorkflowBranchInstance, WorkflowInstance } from '../../data/entities'
import { executeStep } from '../step-handler'
import { findDefinitionForInstance } from '../find-definition'
import { executeTransitionForToken } from '../transition-handler'
import { logWorkflowEvent } from '../event-logger'

jest.mock('@mikro-orm/core', () => ({ LockMode: { PESSIMISTIC_WRITE: 2 } }))
jest.mock('../../data/entities', () => ({
  WorkflowBranchInstance: class {}, WorkflowInstance: class {},
  WorkflowDefinition: class {}, WorkflowEvent: class {}, StepInstance: class {}, UserTask: class {},
}))
jest.mock('../step-handler', () => ({ executeStep: jest.fn() }))
jest.mock('../find-definition', () => ({ findDefinitionForInstance: jest.fn() }))
jest.mock('../transition-handler', () => ({ executeTransitionForToken: jest.fn() }))
jest.mock('../event-logger', () => ({ logWorkflowEvent: jest.fn() }))

describe('parallel branch destination failure after async activities', () => {
  beforeEach(() => jest.resetAllMocks())

  function setup(transitions: any[] = []) {
    const instance = { id: 'instance', context: { shared: true }, metadata: { initiatedBy: 'user' } } as any
    const branch = {
      id: 'branch', workflowInstanceId: instance.id, branchKey: 'fork-a',
      status: 'WAITING_FOR_ACTIVITIES', currentStepId: 'before', joinStepId: 'join',
      pendingTransition: { toStepId: 'destination' }, contextNamespace: { local: true, _pendingAsyncActivities: [{ jobId: 'job', activityId: 'notify' }] },
    } as any
    const em = {
      findOne: jest.fn(async (entity: any) => entity === WorkflowBranchInstance ? branch : entity === WorkflowInstance ? instance : null),
      find: jest.fn(async () => [{ eventType: 'ACTIVITY_COMPLETED', eventData: { async: true, jobId: 'job', activityId: 'notify', output: { sent: true } } }]),
      flush: jest.fn(async () => {}),
    } as any
    jest.mocked(executeStep).mockResolvedValue({ status: 'FAILED', error: 'destination failed' })
    jest.mocked(findDefinitionForInstance).mockResolvedValue({ definition: { transitions } } as any)
    return { instance, branch, em, container: {} as any }
  }

  test('fails and logs an unhandled destination failure before the branch can advance', async () => {
    const { instance, branch, em, container } = setup()
    const result = await resumeBranchAfterActivities(em, container, instance.id, branch.id)
    expect(result.continueExecution).toBe(true) // wake loop to cancel siblings
    expect(branch.status).toBe('FAILED')
    expect(branch.errorMessage).toBe('destination failed')
    expect(logWorkflowEvent).toHaveBeenCalledWith(em, expect.objectContaining({
      branchInstanceId: branch.id, eventType: 'PARALLEL_BRANCH_FAILED',
    }))
    expect(executeTransitionForToken).not.toHaveBeenCalled()
  })

  test.each([true, false])('follows the branch error route (route success: %s)', async (success) => {
    const { instance, branch, em, container } = setup([
      { transitionId: 'on-error', fromStepId: 'destination', toStepId: 'join', kind: 'error' },
    ])
    jest.mocked(executeTransitionForToken).mockImplementation(async () => {
      if (success) branch.currentStepId = 'join'
      return { success } as any
    })
    await resumeBranchAfterActivities(em, container, instance.id, branch.id)
    expect(executeTransitionForToken).toHaveBeenCalledWith(
      em, container, expect.objectContaining({ kind: 'branch', branch }), 'destination', 'join',
      expect.objectContaining({ transitionId: 'on-error', userId: 'user', workflowContext: expect.objectContaining({
        shared: true, local: true, __error: expect.objectContaining({ stepId: 'destination', message: 'destination failed' }),
      }) }),
    )
    expect(branch.status).toBe(success ? 'COMPLETED' : 'FAILED')
    expect(logWorkflowEvent).toHaveBeenCalledWith(em, expect.objectContaining({ eventType: 'ERROR_ROUTED' }))
  })

  test('honors a fallback directive in the branch namespace', async () => {
    const { instance, branch, em, container } = setup()
    jest.mocked(findDefinitionForInstance).mockResolvedValue({ definition: {
      steps: [{ stepId: 'destination', errorDirective: { mode: 'continueWithFallback', fallbackValue: 0 } }],
    } } as any)
    await resumeBranchAfterActivities(em, container, instance.id, branch.id)
    expect(branch.status).toBe('ACTIVE')
    expect(branch.contextNamespace.destination).toBe(0)
    expect(branch.contextNamespace.notify_result).toEqual({ sent: true })
    expect(logWorkflowEvent).toHaveBeenCalledWith(em, expect.objectContaining({ eventType: 'ERROR_DIRECTIVE_APPLIED' }))
    expect(executeTransitionForToken).not.toHaveBeenCalled()
  })

  test('fails the branch if its error route throws', async () => {
    const { instance, branch, em, container } = setup([
      { fromStepId: 'destination', toStepId: 'recovery', kind: 'error' },
    ])
    jest.mocked(executeTransitionForToken).mockRejectedValue(new Error('route failed'))
    await resumeBranchAfterActivities(em, container, instance.id, branch.id)
    expect(branch.status).toBe('FAILED')
    expect(branch.errorMessage).toBe('route failed')
  })

  test.each(['COMPLETED', 'WAITING'] as const)('preserves a successful or waiting destination (%s)', async (status) => {
    const { instance, branch, em, container } = setup()
    jest.mocked(executeStep).mockImplementation(async () => {
      if (status === 'WAITING') branch.status = 'WAITING_FOR_SIGNAL'
      return { status }
    })
    await resumeBranchAfterActivities(em, container, instance.id, branch.id)
    expect(branch.status).toBe(status === 'WAITING' ? 'WAITING_FOR_SIGNAL' : 'ACTIVE')
    expect(findDefinitionForInstance).not.toHaveBeenCalled()
    expect(logWorkflowEvent).not.toHaveBeenCalled()
  })

})
