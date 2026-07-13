import { completeUserTask, UserTaskError } from '../task-handler'
import {
  UserTask,
  WorkflowDefinition,
  WorkflowInstance,
  StepInstance,
} from '../../data/entities'

describe('task-handler', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001'
  const organizationId = '00000000-0000-4000-8000-000000000002'
  const taskId = '00000000-0000-4000-8000-000000000003'
  const workflowInstanceId = '00000000-0000-4000-8000-000000000004'
  const definitionId = '00000000-0000-4000-8000-000000000005'
  const stepInstanceId = '00000000-0000-4000-8000-000000000006'

  function createPendingTask(): UserTask {
    return {
      id: taskId,
      workflowInstanceId,
      stepInstanceId,
      branchInstanceId: null,
      taskName: 'Initial contact',
      description: null,
      status: 'PENDING',
      formSchema: {
        fields: [
          {
            name: 'contact_summary',
            type: 'textarea',
            label: 'Contact Summary',
            required: true,
          },
        ],
      },
      formData: null,
      assignedTo: null,
      assignedToRoles: ['Sales Representative'],
      claimedBy: null,
      claimedAt: null,
      dueDate: null,
      escalatedAt: null,
      escalatedTo: null,
      completedBy: null,
      completedAt: null,
      comments: null,
      tenantId,
      organizationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as UserTask
  }

  function createEntityManager(task: UserTask) {
    const instance = {
      id: workflowInstanceId,
      definitionId,
      workflowId: 'qa-user-task-form',
      version: 1,
      status: 'PAUSED',
      currentStepId: 'initial_contact',
      context: {},
      tenantId,
      organizationId,
      updatedAt: new Date(),
    } as WorkflowInstance

    const definition = {
      id: definitionId,
      definition: {
        transitions: [],
      },
      tenantId,
      organizationId,
    } as WorkflowDefinition

    return {
      instance,
      em: {
        findOne: jest.fn(async (entity: unknown) => {
          if (entity === UserTask) return task
          if (entity === WorkflowInstance) return instance
          if (entity === StepInstance) return null
          if (entity === WorkflowDefinition) return definition
          return null
        }),
        create: jest.fn((_: unknown, payload: unknown) => payload),
        persist: jest.fn(function persist(this: any) { return this }),
        flush: jest.fn(),
      },
    }
  }

  test('rejects missing required data for visual-editor fields schema', async () => {
    const task = createPendingTask()
    const { em } = createEntityManager(task)

    await expect(
      completeUserTask(em as any, {} as any, {
        taskId,
        formData: {},
        userId: 'qa-user',
      })
    ).rejects.toMatchObject({
      name: 'UserTaskError',
      code: 'FORM_VALIDATION_FAILED',
      message: 'Required field missing: contact_summary',
    } satisfies Partial<UserTaskError>)

    expect(task.status).toBe('PENDING')
    expect(em.flush).not.toHaveBeenCalled()
  })

  test('persists form data from visual-editor fields schema and merges it into workflow context', async () => {
    const task = createPendingTask()
    const { em, instance } = createEntityManager(task)

    await completeUserTask(em as any, {} as any, {
      taskId,
      formData: { contact_summary: 'Reached the customer by phone.' },
      userId: 'qa-user',
      comments: 'Useful first call',
    })

    expect(task.status).toBe('COMPLETED')
    expect(task.formData).toEqual({ contact_summary: 'Reached the customer by phone.' })
    expect(task.comments).toBe('Useful first call')
    expect(instance.context).toEqual({ contact_summary: 'Reached the customer by phone.' })
    expect(em.flush).toHaveBeenCalled()
  })
})
