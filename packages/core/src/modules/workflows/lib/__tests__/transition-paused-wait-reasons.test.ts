/**
 * `executeTransition`'s `paused` flag, per wait reason.
 *
 * The executor loop treats `paused: true` as "an EXTERNAL completion is
 * pending — stop advancing". That is right for every wait reason except
 * `FORK`: `openFork` leaves the instance FORKED with its branch rows already
 * written, and the branches are driven by `advanceBranches` on the loop's next
 * iteration. Reporting a fork as paused makes the executor return before it
 * re-reads the instance, so no branch ever advances and the instance stays
 * FORKED at the fork step forever (the whole parallel suite, TC-WF-015/016/
 * 017/020/021/022).
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowDefinition, WorkflowInstance } from '../../data/entities'
import * as transitionHandler from '../transition-handler'
import * as stepHandler from '../step-handler'
import * as activityExecutor from '../activity-executor'

jest.mock('../step-handler')
jest.mock('../activity-executor')

const mockedStepHandler = stepHandler as jest.Mocked<typeof stepHandler>

describe('executeTransition paused flag by wait reason', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let instance: WorkflowInstance
  let definition: WorkflowDefinition

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockReturnValue({}),
      persist: jest.fn(function persist(this: any) {
        return this
      }),
      flush: jest.fn(),
    } as any

    mockContainer = { resolve: jest.fn() } as any

    instance = {
      id: 'instance-1',
      definitionId: 'definition-1',
      workflowId: 'parallel-flow',
      currentStepId: 'start',
      status: 'RUNNING',
      context: {},
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      version: 1,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowInstance

    definition = {
      id: 'definition-1',
      workflowId: 'parallel-flow',
      workflowName: 'Parallel Flow',
      version: 1,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          {
            stepId: 'fork',
            stepName: 'Fork',
            stepType: 'PARALLEL_FORK',
            config: { joinStepId: 'join' },
          },
          { stepId: 'approve', stepName: 'Approve', stepType: 'USER_TASK' },
        ],
        transitions: [
          { transitionId: 'start-to-fork', fromStepId: 'start', toStepId: 'fork', trigger: 'auto' },
          {
            transitionId: 'start-to-approve',
            fromStepId: 'start',
            toStepId: 'approve',
            trigger: 'auto',
          },
        ],
      },
    } as unknown as WorkflowDefinition

    mockEm.findOne.mockResolvedValue(definition)
    ;(activityExecutor.executeActivities as jest.Mock)?.mockResolvedValue?.({
      results: [],
      contextUpdates: {},
    })
  })

  test('a FORK wait is NOT reported as paused — the executor must reach advanceBranches', async () => {
    mockedStepHandler.executeStep.mockResolvedValue({
      status: 'WAITING',
      waitReason: 'FORK',
      outputData: { stepType: 'PARALLEL_FORK', forkStepId: 'fork' },
    } as any)

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'fork',
      { workflowContext: {}, transitionId: 'start-to-fork' },
    )

    expect(result.success).toBe(true)
    expect(result.paused).toBe(false)
  })

  test('a USER_TASK wait IS reported as paused — an external completion is pending', async () => {
    mockedStepHandler.executeStep.mockResolvedValue({
      status: 'WAITING',
      waitReason: 'USER_TASK',
      outputData: {},
    } as any)

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'approve',
      { workflowContext: {}, transitionId: 'start-to-approve' },
    )

    expect(result.success).toBe(true)
    expect(result.paused).toBe(true)
  })
})
