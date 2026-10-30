/**
 * Same-step wait occurrence against a real PostgreSQL (#7185).
 *
 * A delivery addressed to one occurrence of a WAIT_FOR_SIGNAL step must never
 * consume the next occurrence of the same step. The scenario runs the REAL park
 * (`executeStep` → WAIT_FOR_SIGNAL handler → entity hooks → flush) and the REAL
 * `sendSignal` claim with the clock frozen, so nothing timestamp-based can tell
 * the two occurrences apart:
 *
 *   park (occurrence 1) → deliveries A and B both read it → B is held before its
 *   claim → A claims and advances → the run re-parks on the same step
 *   (occurrence 2) → B's claim is released.
 *
 * B must be refused with WORKFLOW_NOT_PAUSED and occurrence 2 must stay parked.
 *
 * Gated on OM_WORKFLOWS_PG_URL — a throwaway database, since the suite drops and
 * recreates the workflow tables. Never point it at a development or shared
 * database. Run it with, for example:
 *
 *   docker run -d --rm --name om-wf-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54391:5432 postgres:17-alpine
 *   OM_WORKFLOWS_PG_URL=postgres://postgres:postgres@127.0.0.1:54391/om \
 *     yarn workspace @open-mercato/core jest signal-wait-occurrence.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import {
  StepInstance,
  UserTask,
  WorkflowBranchInstance,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInstance,
} from '../../data/entities'
import * as eventLogger from '../event-logger'
import * as stepHandler from '../step-handler'
import { sendSignal, SignalError } from '../signal-handler'

const PG_URL = process.env.OM_WORKFLOWS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const FROZEN_AT = new Date('2026-10-29T09:00:00.000Z')
const WAIT_STEP = 'wait_approval'
const SIGNAL = 'approved'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function withGatedClaim(em: EntityManager, beforeClaim: () => Promise<void>): EntityManager {
  return new Proxy(em, {
    get(target, property, receiver) {
      if (property === 'nativeUpdate') {
        return async (...args: Parameters<EntityManager['nativeUpdate']>) => {
          await beforeClaim()
          return target.nativeUpdate(...args)
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

maybe('WAIT_FOR_SIGNAL occurrence identity against PostgreSQL (#7185)', () => {
  jest.setTimeout(120_000)
  let orm: MikroORM
  const executeWorkflow = jest.fn(async () => undefined)
  const container = {
    resolve: (name: string) => {
      if (name === 'eventLogger') return eventLogger
      if (name === 'stepHandler') return stepHandler
      if (name === 'transitionHandler') return { findValidTransitions: async () => [] }
      if (name === 'workflowExecutor') return { executeWorkflow, completeWorkflow: async () => undefined }
      throw new Error(`[internal] unexpected resolve: ${name}`)
    },
  }

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [WorkflowDefinition, WorkflowInstance, WorkflowBranchInstance, StepInstance, UserTask, WorkflowEvent],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.refresh()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  beforeEach(() => {
    executeWorkflow.mockClear()
    jest.useFakeTimers({
      now: FROZEN_AT,
      doNotFake: [
        'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
        'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance',
      ],
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  async function seedParkedInstance(): Promise<string> {
    const em = orm.em.fork()
    const definition = em.create(WorkflowDefinition, {
      workflowId: `wf_occurrence_${randomUUID().slice(0, 8)}`,
      workflowName: 'Occurrence identity',
      version: 1,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: WAIT_STEP, stepName: 'Wait for approval', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: SIGNAL } },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [],
      },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    } as never)
    await em.persist(definition).flush()
    const instance = em.create(WorkflowInstance, {
      definitionId: definition.id,
      workflowId: definition.workflowId,
      version: 1,
      status: 'RUNNING',
      currentStepId: WAIT_STEP,
      context: {},
      startedAt: new Date(),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    } as never)
    await em.persist(instance).flush()
    await park(instance.id)
    return instance.id
  }

  async function park(instanceId: string): Promise<void> {
    const em = orm.em.fork()
    const instance = await em.findOneOrFail(WorkflowInstance, { id: instanceId })
    instance.currentStepId = WAIT_STEP
    const result = await stepHandler.executeStep(em, instance, WAIT_STEP, { workflowContext: instance.context })
    expect(result.status).toBe('WAITING')
  }

  async function preloadedEm(instanceId: string): Promise<EntityManager> {
    const em = orm.em.fork()
    await em.findOneOrFail(WorkflowInstance, { id: instanceId })
    return em
  }

  function deliver(em: EntityManager, instanceId: string): Promise<void> {
    return sendSignal(em, container as never, {
      instanceId,
      signalName: SIGNAL,
      payload: { approvedBy: 'reviewer' },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  }

  async function countSignalReceived(instanceId: string): Promise<number> {
    return orm.em.fork().count(WorkflowEvent, { workflowInstanceId: instanceId, eventType: 'SIGNAL_RECEIVED' })
  }

  it('refuses a delayed duplicate once the winner re-parked on the same step with a frozen clock', async () => {
    const instanceId = await seedParkedInstance()

    const loserReachedClaim = deferred()
    const releaseLoser = deferred()
    const loserEm = withGatedClaim(await preloadedEm(instanceId), async () => {
      loserReachedClaim.resolve()
      await releaseLoser.promise
    })
    const loser = deliver(loserEm, instanceId).then(
      () => null,
      (error: unknown) => error,
    )
    await loserReachedClaim.promise

    await deliver(orm.em.fork(), instanceId)
    await park(instanceId)

    releaseLoser.resolve()
    const loserError = await loser

    expect(loserError).toBeInstanceOf(SignalError)
    expect((loserError as SignalError).code).toBe('WORKFLOW_NOT_PAUSED')
    const final = await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })
    expect(final.status).toBe('PAUSED')
    expect(final.currentStepId).toBe(WAIT_STEP)
    expect(await countSignalReceived(instanceId)).toBe(1)
    expect(await orm.em.fork().count(StepInstance, { workflowInstanceId: instanceId, stepId: WAIT_STEP, status: 'ACTIVE' })).toBe(1)
  })

  it('strictly increases wait_version across park, claim and re-park even when the clock rolls back', async () => {
    const instanceId = await seedParkedInstance()
    const readVersion = async () => (await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })).waitVersion
    const parked = await readVersion()

    await deliver(orm.em.fork(), instanceId)
    const claimed = await readVersion()
    jest.setSystemTime(new Date(FROZEN_AT.getTime() - 60_000))
    await park(instanceId)
    const reparked = await readVersion()

    expect(typeof parked).toBe('number')
    expect(claimed).toBeGreaterThan(parked)
    expect(reparked).toBeGreaterThan(claimed)
  })

  it('delivers exactly once when a metadata-only write lands between the read and the claim', async () => {
    const instanceId = await seedParkedInstance()
    const parked = (await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })).waitVersion

    const deliveryReachedClaim = deferred()
    const releaseDelivery = deferred()
    const deliveryEm = withGatedClaim(await preloadedEm(instanceId), async () => {
      deliveryReachedClaim.resolve()
      await releaseDelivery.promise
    })
    const delivery = deliver(deliveryEm, instanceId).then(
      () => null,
      (error: unknown) => error,
    )
    await deliveryReachedClaim.promise

    const writerEm = orm.em.fork()
    const parkedRow = await writerEm.findOneOrFail(WorkflowInstance, { id: instanceId })
    parkedRow.metadata = { ...(parkedRow.metadata ?? {}), attention: { reason: 'DISPOSITION_SLA_BREACH', stepId: WAIT_STEP } }
    parkedRow.updatedAt = new Date()
    await writerEm.flush()
    const afterMetadataWrite = await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })
    expect(afterMetadataWrite.status).toBe('PAUSED')
    expect(afterMetadataWrite.waitVersion).toBe(parked)

    releaseDelivery.resolve()
    expect(await delivery).toBeNull()

    expect(await countSignalReceived(instanceId)).toBe(1)
    const final = await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })
    expect(final.status).toBe('RUNNING')
    expect(final.waitVersion).toBeGreaterThan(parked)
    expect((final.metadata as Record<string, unknown> | null)?.attention).toBeDefined()
  })

  it('still delivers to the new occurrence when the caller reads it after the re-park', async () => {
    const instanceId = await seedParkedInstance()
    await deliver(orm.em.fork(), instanceId)
    await park(instanceId)

    await deliver(orm.em.fork(), instanceId)

    expect(await countSignalReceived(instanceId)).toBe(2)
    const final = await orm.em.fork().findOneOrFail(WorkflowInstance, { id: instanceId })
    expect(final.status).toBe('RUNNING')
  })
})
