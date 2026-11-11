/**
 * Double-submitted user task completion against a real PostgreSQL: two
 * `completeUserTask` calls on separate entity managers are both held right
 * after reading the PENDING task until the other has read it too, then race to
 * close it. Exactly one may win; the other gets TASK_NOT_FOUND.
 *
 * Runs in the CI real-Postgres lane (`yarn workspace @open-mercato/core
 * test:pg-integration`), or against a throwaway database (the suite recreates
 * the workflow tables):
 *
 *   OM_WORKFLOWS_PG_URL=postgres://postgres:postgres@127.0.0.1:54391/om \
 *     yarn workspace @open-mercato/core jest task-complete-race.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  StepInstance,
  UserTask,
  WorkflowBranchInstance,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInstance,
} from '../../data/entities'
import { completeUserTask, UserTaskError } from '../task-handler'
import * as transitionHandler from '../transition-handler'
import { executeWorkflow } from '../workflow-executor'
import { acquireWorkflowsPgDatabase, runsAgainstPostgres, type WorkflowsPgDatabase } from './workflowsPgDatabase'

jest.mock('../transition-handler', () => ({ findValidTransitions: jest.fn(), executeTransition: jest.fn() }))
jest.mock('../workflow-executor', () => ({ executeWorkflow: jest.fn() }))

const maybe = runsAgainstPostgres ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

function wrap(em: EntityManager, overrides: Partial<Record<keyof EntityManager, unknown>>): EntityManager {
  return new Proxy(em, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof EntityManager]
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function heldAfterTaskRead(em: EntityManager, bothRead: Promise<void>, arrive: () => void): EntityManager {
  return wrap(em, {
    findOne: async (...args: Parameters<EntityManager['findOne']>) => {
      const found = await em.findOne(...args)
      if (args[0] === UserTask) {
        arrive()
        await bothRead
      }
      return found
    },
  })
}

maybe('completeUserTask double submit against PostgreSQL', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let database: WorkflowsPgDatabase | undefined

  beforeAll(async () => {
    database = await acquireWorkflowsPgDatabase()
    orm = await MikroORM.init({
      clientUrl: database.url,
      entities: [WorkflowDefinition, WorkflowInstance, WorkflowBranchInstance, StepInstance, UserTask, WorkflowEvent],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.refresh()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await database?.release()
  })

  beforeEach(() => {
    jest.mocked(executeWorkflow).mockReset()
    jest.mocked(transitionHandler.findValidTransitions).mockReset().mockResolvedValue([
      { isValid: true, transition: { transitionId: 't_done', toStepId: 'end' } },
    ] as unknown as Awaited<ReturnType<typeof transitionHandler.findValidTransitions>>)
    jest.mocked(transitionHandler.executeTransition).mockReset().mockResolvedValue({
      success: true,
    } as unknown as Awaited<ReturnType<typeof transitionHandler.executeTransition>>)
  })

  async function seedPausedTask(): Promise<{ instanceId: string; taskId: string }> {
    const em = orm.em.fork()
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    const definition = em.create(WorkflowDefinition, {
      workflowId: `wf_double_submit_${randomUUID().slice(0, 8)}`,
      workflowName: 'Double submit',
      version: 1,
      definition: {
        steps: [{ stepId: 'review', stepName: 'Review', stepType: 'USER_TASK', userTaskConfig: {} }],
        transitions: [{ transitionId: 't_done', fromStepId: 'review', toStepId: 'end', trigger: 'auto' }],
      },
      ...scope,
    } as never)
    await em.persist(definition).flush()
    const instance = em.create(WorkflowInstance, {
      definitionId: definition.id,
      workflowId: definition.workflowId,
      version: 1,
      status: 'PAUSED',
      currentStepId: 'review',
      context: {},
      startedAt: new Date(),
      ...scope,
    } as never)
    await em.persist(instance).flush()
    const task = em.create(UserTask, {
      workflowInstanceId: instance.id,
      stepInstanceId: randomUUID(),
      taskName: 'Review',
      status: 'PENDING',
      assignedTo: USER_ID,
      updatedAt: new Date(),
      ...scope,
    } as never)
    await em.persist(task).flush()
    return { instanceId: instance.id, taskId: task.id }
  }

  function submit(em: EntityManager, taskId: string): Promise<unknown> {
    return completeUserTask(em, { resolve: () => undefined } as unknown as AwilixContainer, {
      taskId,
      formData: { approved: true },
      userId: USER_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    }).then(
      () => null,
      (error: unknown) => error,
    )
  }

  async function readState(seeded: { instanceId: string; taskId: string }) {
    const em = orm.em.fork()
    return {
      task: await em.findOneOrFail(UserTask, { id: seeded.taskId }),
      events: await em.count(WorkflowEvent, { workflowInstanceId: seeded.instanceId, eventType: 'USER_TASK_COMPLETED' }),
    }
  }

  it('lets exactly one of two submissions that both read the open task complete it', async () => {
    const seeded = await seedPausedTask()
    let arrived = 0
    let openBarrier: () => void = () => undefined
    const bothRead = new Promise<void>((resolve) => {
      openBarrier = resolve
    })
    const arrive = () => {
      arrived += 1
      if (arrived === 2) openBarrier()
    }

    const outcomes = await Promise.all([
      submit(heldAfterTaskRead(orm.em.fork(), bothRead, arrive), seeded.taskId),
      submit(heldAfterTaskRead(orm.em.fork(), bothRead, arrive), seeded.taskId),
    ])

    const refused = outcomes.filter((outcome) => outcome !== null)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toBeInstanceOf(UserTaskError)
    expect((refused[0] as UserTaskError).code).toBe('TASK_NOT_FOUND')
    const state = await readState(seeded)
    expect(state.task.status).toBe('COMPLETED')
    expect(state.events).toBe(1)
    expect(transitionHandler.executeTransition).toHaveBeenCalledTimes(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })

  it('leaves the task open after a failed completion write and completes it once on retry', async () => {
    const seeded = await seedPausedTask()
    const failing = wrap(orm.em.fork(), {
      nativeUpdate: async () => {
        throw new Error('[internal] injected write failure')
      },
    })

    expect(await submit(failing, seeded.taskId)).toMatchObject({ message: '[internal] injected write failure' })
    const afterFailure = await readState(seeded)
    expect(afterFailure.task.status).toBe('PENDING')
    expect(afterFailure.events).toBe(0)
    expect(executeWorkflow).not.toHaveBeenCalled()

    expect(await submit(orm.em.fork(), seeded.taskId)).toBeNull()
    const afterRetry = await readState(seeded)
    expect(afterRetry.task.status).toBe('COMPLETED')
    expect(afterRetry.task.formData).toEqual({ approved: true })
    expect(afterRetry.events).toBe(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })
})
