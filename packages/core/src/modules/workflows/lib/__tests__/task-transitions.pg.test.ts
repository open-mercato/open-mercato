import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { StepInstance, UserTask, WorkflowEvent, WorkflowInstance } from '../../data/entities'
import { claimUserTask, reassignUserTask, releaseUserTask } from '../task-handler'
import { completeWorkflow } from '../workflow-executor'
import { acquireWorkflowsPgDatabase, runsAgainstPostgres, type WorkflowsPgDatabase } from './workflowsPgDatabase'

const describePostgres = runsAgainstPostgres ? describe : describe.skip

describePostgres('persisted workflow task transitions', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  let database: WorkflowsPgDatabase | undefined
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }

  beforeAll(async () => {
    database = await acquireWorkflowsPgDatabase()
    orm = await MikroORM.init({
      clientUrl: database.url,
      entities: [StepInstance, UserTask, WorkflowEvent, WorkflowInstance],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
    })
    await orm.schema.refresh()
  })

  afterAll(async () => {
    await orm?.close(true)
    await database?.release()
  })

  async function seedRun() {
    const em = orm.em.fork()
    const instance = em.create(WorkflowInstance, {
      definitionId: randomUUID(),
      workflowId: 'task-transition-fixture',
      version: 1,
      status: 'PAUSED',
      currentStepId: 'review',
      context: {},
      startedAt: new Date(),
      ...scope,
    })
    await em.persist(instance).flush()
    return instance
  }

  async function seedTask(instance: WorkflowInstance, data: Partial<UserTask> = {}) {
    const em = orm.em.fork()
    const task = em.create(UserTask, {
      workflowInstanceId: instance.id,
      stepInstanceId: randomUUID(),
      taskName: 'Review order',
      status: 'PENDING',
      ...scope,
      ...data,
    })
    await em.persist(task).flush()
    return task
  }

  test('writes and compares role arrays through reassignment, claim and release', async () => {
    const instance = await seedRun()
    const task = await seedTask(instance, { assignedToRoles: ['approver', 'reviewer'] })
    const em = orm.em.fork()
    const userId = randomUUID()

    const reassigned = await reassignUserTask(em, {
      taskId: task.id,
      userId,
      target: { assignedToRoles: ['supervisor'] },
      reason: 'Queue rotation',
      scope,
    })
    expect(reassigned).toMatchObject({ status: 'PENDING', assignedToRoles: ['supervisor'] })

    await claimUserTask(em, task.id, userId, scope, ['supervisor'])
    const managed = await em.findOneOrFail(UserTask, { id: task.id, ...scope })
    expect(managed).toMatchObject({ status: 'IN_PROGRESS', claimedBy: userId })

    await releaseUserTask(em, task.id, userId, scope)
    expect(managed).toMatchObject({ status: 'PENDING', claimedBy: null, assignedToRoles: ['supervisor'] })
    expect(await orm.em.fork().findOneOrFail(UserTask, { id: task.id, ...scope })).toMatchObject({
      status: 'PENDING',
      claimedBy: null,
      assignedToRoles: ['supervisor'],
      reassignReason: 'Queue rotation',
    })
  })

  test('records cancellation for the returned rows while preserving completed and foreign rows', async () => {
    const instance = await seedRun()
    const pending = await seedTask(instance)
    const completed = await seedTask(instance, { status: 'COMPLETED', formData: { approved: true } })
    const foreign = await seedTask(instance, { organizationId: randomUUID() })
    const em = orm.em.fork()
    const container = { resolve: () => undefined } as unknown as AwilixContainer

    await completeWorkflow(em, container, instance.id, 'CANCELLED')

    const stored = orm.em.fork()
    expect(await stored.findOneOrFail(WorkflowInstance, { id: instance.id, ...scope })).toMatchObject({
      status: 'CANCELLED',
    })
    expect(await stored.findOneOrFail(UserTask, { id: pending.id, ...scope })).toMatchObject({ status: 'CANCELLED' })
    expect(await stored.findOneOrFail(UserTask, { id: completed.id, ...scope })).toMatchObject({
      status: 'COMPLETED',
      formData: { approved: true },
    })
    expect(await stored.findOneOrFail(UserTask, { id: foreign.id, tenantId: scope.tenantId, organizationId: foreign.organizationId }))
      .toMatchObject({ status: 'PENDING' })
    const cancelledEvents = await stored.find(WorkflowEvent, {
      workflowInstanceId: instance.id,
      eventType: 'USER_TASK_CANCELLED',
      ...scope,
    })
    expect(cancelledEvents).toEqual([
      expect.objectContaining({ eventData: expect.objectContaining({ taskId: pending.id, taskName: 'Review order' }) }),
    ])
  })
})
