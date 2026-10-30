/**
 * Migration20261029090000_workflows lifecycle against a real PostgreSQL (#7185).
 *
 * Applies the `wait_version` migration to a database that already holds a
 * parked workflow instance, rolls it back and reapplies it, then delivers a
 * signal to that pre-existing instance:
 *
 *   pre-migration row → up (column NOT NULL DEFAULT 0, row reads 0) → down
 *   (column gone, row intact) → up again → signal claims the row exactly once.
 *
 * Gated on OM_WORKFLOWS_PG_URL — a throwaway server. The suite creates and drops
 * its own scratch database next to the one in the URL, so it never touches the
 * tables of the URL's database. Run it with, for example:
 *
 *   docker run -d --rm --name om-wf-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54391:5432 postgres:17-alpine
 *   OM_WORKFLOWS_PG_URL=postgres://postgres:postgres@127.0.0.1:54391/om \
 *     yarn workspace @open-mercato/core jest wait-version-migration.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM } from '@mikro-orm/postgresql'
import {
  StepInstance,
  UserTask,
  WorkflowBranchInstance,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInstance,
} from '../../data/entities'
import { Migration20261029090000_workflows } from '../../migrations/Migration20261029090000_workflows'
import * as eventLogger from '../event-logger'
import * as stepHandler from '../step-handler'
import { sendSignal } from '../signal-handler'

const PG_URL = process.env.OM_WORKFLOWS_PG_URL ?? ''
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const WAIT_STEP = 'wait_approval'
const SIGNAL = 'approved'

function scratchUrl(databaseName: string): string {
  const url = new URL(PG_URL)
  url.pathname = `/${databaseName}`
  return url.toString()
}

maybe('wait_version migration up/down against PostgreSQL (#7185)', () => {
  jest.setTimeout(120_000)
  const scratchDatabase = `om_wf_wait_version_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let admin: MikroORM
  let orm: MikroORM
  const container = {
    resolve: (name: string) => {
      if (name === 'eventLogger') return eventLogger
      if (name === 'stepHandler') return stepHandler
      if (name === 'transitionHandler') return { findValidTransitions: async () => [] }
      if (name === 'workflowExecutor') return { executeWorkflow: async () => undefined, completeWorkflow: async () => undefined }
      throw new Error(`[internal] unexpected resolve: ${name}`)
    },
  }

  beforeAll(async () => {
    admin = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [WorkflowInstance],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await admin.em.getConnection().execute(`create database "${scratchDatabase}"`)
    orm = await MikroORM.init({
      clientUrl: scratchUrl(scratchDatabase),
      entities: [WorkflowDefinition, WorkflowInstance, WorkflowBranchInstance, StepInstance, UserTask, WorkflowEvent],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
    })
    await orm.schema.create()
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
    await admin?.em.getConnection().execute(`drop database if exists "${scratchDatabase}"`)
    await admin?.close(true)
  })

  async function runMigration(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261029090000_workflows(orm.em.getDriver(), orm.config)
    await migration[direction]()
    for (const query of migration.getQueries()) {
      await migration.execute(query)
    }
    migration.reset()
  }

  async function readColumn(): Promise<{ is_nullable: string; column_default: string | null } | null> {
    const rows = await orm.em.getConnection().execute<{ is_nullable: string; column_default: string | null }[]>(
      `select is_nullable, column_default from information_schema.columns where table_name = 'workflow_instances' and column_name = 'wait_version'`,
    )
    return rows[0] ?? null
  }

  async function readRow(instanceId: string): Promise<Record<string, unknown>> {
    const rows = await orm.em.getConnection().execute<Record<string, unknown>[]>(
      `select * from workflow_instances where id = ?`,
      [instanceId],
    )
    return rows[0]
  }

  it('preserves a pre-existing parked instance through up, down and reapply, then delivers its signal once', async () => {
    const em = orm.em.fork()
    const definition = em.create(WorkflowDefinition, {
      workflowId: 'wf_wait_version_migration',
      workflowName: 'Wait version migration',
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
      status: 'PAUSED',
      currentStepId: WAIT_STEP,
      context: { orderId: 'order-1' },
      startedAt: new Date(),
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    } as never)
    await em.persist(instance).flush()
    const instanceId = instance.id

    await runMigration('down')
    expect(await readColumn()).toBeNull()
    const preMigration = await readRow(instanceId)
    expect(preMigration.status).toBe('PAUSED')
    expect(preMigration).not.toHaveProperty('wait_version')

    await runMigration('up')
    const column = await readColumn()
    expect(column?.is_nullable).toBe('NO')
    expect(column?.column_default).toBe('0')
    const afterUp = await readRow(instanceId)
    expect(afterUp.wait_version).toBe(0)
    expect(afterUp.context).toEqual({ orderId: 'order-1' })

    await runMigration('down')
    expect(await readColumn()).toBeNull()
    const afterDown = await readRow(instanceId)
    expect(afterDown.status).toBe('PAUSED')
    expect(afterDown.current_step_id).toBe(WAIT_STEP)
    expect(afterDown.context).toEqual({ orderId: 'order-1' })

    await runMigration('up')
    expect((await readRow(instanceId)).wait_version).toBe(0)

    await sendSignal(orm.em.fork(), container as never, {
      instanceId,
      signalName: SIGNAL,
      payload: { approvedBy: 'reviewer' },
      expectedWaitVersion: 0,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    const final = await readRow(instanceId)
    expect(final.status).toBe('RUNNING')
    expect(Number(final.wait_version)).toBeGreaterThan(0)
    expect(await orm.em.fork().count(WorkflowEvent, { workflowInstanceId: instanceId, eventType: 'SIGNAL_RECEIVED' })).toBe(1)
  })
})
