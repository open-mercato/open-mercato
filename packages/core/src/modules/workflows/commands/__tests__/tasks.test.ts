/**
 * `workflows.tasks.complete` — the command a notification quick action runs.
 *
 * The properties that matter: it is never a softer gate than the HTTP route it
 * mirrors, and it refuses rather than guesses when the task offers a choice the
 * notification could not have carried.
 */

const mockLoadTaskDecisionContext = jest.fn()

jest.mock('../../lib/task-decision-context', () => ({
  loadTaskDecisionContext: (...args: unknown[]) => mockLoadTaskDecisionContext(...args),
}))

jest.mock('../../data/entities', () => ({ UserTask: class UserTask {} }))

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import completeUserTaskCommand, {
  WORKFLOWS_TASK_COMPLETE_COMMAND_ID,
} from '../tasks'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const taskId = '00000000-0000-4000-8000-000000000005'
const userId = '00000000-0000-4000-8000-000000000009'

describe('workflows.tasks.complete', () => {
  let task: Record<string, unknown> | null
  let mockCompleteUserTask: jest.Mock
  let mockUserHasAllFeatures: jest.Mock
  let ctx: Record<string, unknown>

  const makeCtx = () => {
    const em = {
      fork: () => em,
      findOne: jest.fn(() => Promise.resolve(task)),
    }
    const container = {
      resolve: (token: string) => {
        switch (token) {
          case 'em':
            return em
          case 'rbacService':
            return { userHasAllFeatures: mockUserHasAllFeatures }
          case 'taskHandler':
            return { completeUserTask: mockCompleteUserTask }
          default:
            throw new Error(`Unexpected DI token in test: ${token}`)
        }
      },
    }
    return {
      container,
      auth: { sub: userId, tenantId, orgId: organizationId },
      selectedOrganizationId: organizationId,
      organizationScope: null,
      organizationIds: [organizationId],
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    task = { id: taskId, workflowInstanceId: 'wi', stepInstanceId: 'si' }
    mockCompleteUserTask = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockUserHasAllFeatures = jest.fn<() => Promise<boolean>>().mockResolvedValue(true)
    mockLoadTaskDecisionContext.mockResolvedValue({ stepId: 'review', decisions: [] } as never)
    ctx = makeCtx()
  })

  test('is registered under the id the notification action names', () => {
    expect(completeUserTaskCommand.id).toBe(WORKFLOWS_TASK_COMPLETE_COMMAND_ID)
    expect(WORKFLOWS_TASK_COMPLETE_COMMAND_ID).toBe('workflows.tasks.complete')
  })

  test('completes a decision-free task through the task handler', async () => {
    const result = await completeUserTaskCommand.execute({ id: taskId }, ctx as never)

    expect(result).toEqual({ taskId, decisionId: null })
    expect(mockCompleteUserTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        taskId,
        userId,
        formData: {},
        scope: { tenantId, organizationId },
      })
    )
    expect(mockCompleteUserTask.mock.calls[0][2]).not.toHaveProperty('decisionId')
  })

  test('selects the sole decision, re-resolved from the pinned definition', async () => {
    mockLoadTaskDecisionContext.mockResolvedValue({
      stepId: 'review',
      decisions: [{ id: 'approve', label: 'Approve', transitionId: 't_a' }],
    } as never)

    const result = await completeUserTaskCommand.execute({ id: taskId }, ctx as never)

    expect(result.decisionId).toBe('approve')
    expect(mockCompleteUserTask.mock.calls[0][2]).toMatchObject({ decisionId: 'approve' })
  })

  test('refuses a task offering several decisions instead of picking one', async () => {
    mockLoadTaskDecisionContext.mockResolvedValue({
      stepId: 'review',
      decisions: [
        { id: 'approve', label: 'Approve', transitionId: 't_a' },
        { id: 'reject', label: 'Reject', transitionId: 't_r' },
      ],
    } as never)

    await expect(completeUserTaskCommand.execute({ id: taskId }, ctx as never)).rejects.toThrow(
      /multiple decisions/
    )
    expect(mockCompleteUserTask).not.toHaveBeenCalled()
  })

  test('enforces the same ACL feature as the HTTP route', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false as never)

    await expect(completeUserTaskCommand.execute({ id: taskId }, ctx as never)).rejects.toThrow(
      /not allowed/
    )
    expect(mockCompleteUserTask).not.toHaveBeenCalled()

    mockUserHasAllFeatures.mockResolvedValue(true as never)
    await completeUserTaskCommand.execute({ id: taskId }, ctx as never)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      userId,
      ['workflows.tasks.complete'],
      { tenantId, organizationId }
    )
  })

  test('fails closed without a caller identity', async () => {
    const anonymous = { ...makeCtx(), auth: null, selectedOrganizationId: null }

    await expect(
      completeUserTaskCommand.execute({ id: taskId }, anonymous as never)
    ).rejects.toThrow(/authenticated caller scope/)
  })

  test('a task that is already completed is not found, and nothing runs', async () => {
    task = null

    await expect(completeUserTaskCommand.execute({ id: taskId }, ctx as never)).rejects.toThrow(
      /already completed/
    )
    expect(mockCompleteUserTask).not.toHaveBeenCalled()
  })

  test('ignores unrelated keys the notification service spreads into the input', async () => {
    await expect(
      completeUserTaskCommand.execute(
        { id: taskId, actionId: 'complete', somethingElse: 1 } as never,
        ctx as never
      )
    ).resolves.toEqual({ taskId, decisionId: null })
  })
})
