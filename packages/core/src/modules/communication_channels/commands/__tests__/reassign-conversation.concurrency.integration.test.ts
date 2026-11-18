/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as entities from '../../data/entities'
import reassignConversationCommand from '../reassign-conversation'

type Deferred = { promise: Promise<void>; resolve: () => void }

type Gate = { entity: string; fired: boolean; reached: Deferred; release: Deferred }

const mockGateState: { gate: Gate | null } = { gate: null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(
    async (em: EntityManager, entity: unknown, where: Record<string, unknown>, options?: Record<string, unknown>) => {
      if (entity === 'User') return { id: where.id }
      const result = await em.findOne(entity as never, where as never, options as never)
      const gate = mockGateState.gate
      const name = typeof entity === 'function' ? entity.name : String(entity)
      if (gate && !gate.fired && gate.entity === name) {
        gate.fired = true
        gate.reached.resolve()
        await gate.release.promise
      }
      return result
    },
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const { ChannelThreadMapping, CommunicationChannel, ExternalConversation } = entities

const DATABASE_NAME = 'reassign_undo_test'
const DATABASE_USER = 'reassign_undo'
const DATABASE_PASSWORD = 'reassign_undo'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000
const CONFLICT_CODE = 'communication_channels.errors.reassignUndoConflict'

const USER_A = randomUUID()
const USER_B = randomUUID()
const USER_C = randomUUID()
const ACTOR = randomUUID()

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Seed = { tenantId: string; mappingId: string; conversationId: string; threadId: string }

type CommandError = { status?: number; body?: { code?: string } }

type Outcome<T> = { ok: true; value: T } | { ok: false; error: CommandError }

type ExecuteValue = { status: string; previousAssignedUserId?: string | null }

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

function armGate(entity: string): Gate {
  const gate: Gate = { entity, fired: false, reached: createDeferred(), release: createDeferred() }
  mockGateState.gate = gate
  return gate
}

async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error: error as CommandError }
  }
}

describeWithPostgres('reassign-conversation undo against concurrent reassignments on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function commandCtx() {
    const root = rootEm()
    return {
      auth: { sub: ACTOR, tenantId: null, orgId: null },
      container: {
        resolve: (name: string) => {
          if (name === 'em') return root
          if (name === 'rbacService') {
            return { loadAcl: async () => ({ isSuperAdmin: false, features: ['communication_channels.assign'] }) }
          }
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      },
    } as never
  }

  async function seed(owner: string): Promise<Seed> {
    const em = rootEm()
    const tenantId = randomUUID()
    const channel = em.create(CommunicationChannel, {
      providerKey: 'test',
      channelType: 'email',
      displayName: 'Shared',
      userId: null,
      tenantId,
      organizationId: null,
    } as never)
    await em.flush()
    const conversation = em.create(ExternalConversation, {
      channelId: channel.id,
      externalConversationId: randomUUID(),
      assignedUserId: owner,
      tenantId,
      organizationId: null,
    } as never)
    await em.flush()
    const threadId = randomUUID()
    const mapping = em.create(ChannelThreadMapping, {
      externalConversationId: conversation.id,
      messageThreadId: threadId,
      channelId: channel.id,
      providerKey: 'test',
      externalThreadRef: randomUUID(),
      assignedUserId: owner,
      tenantId,
      organizationId: null,
    } as never)
    await em.flush()
    return { tenantId, mappingId: mapping.id, conversationId: conversation.id, threadId }
  }

  function reassign(target: Seed, assignedUserId: string): Promise<ExecuteValue> {
    return reassignConversationCommand.execute(
      { threadId: target.threadId, assignedUserId, scope: { tenantId: target.tenantId, organizationId: null } },
      commandCtx(),
    ) as Promise<ExecuteValue>
  }

  function undoReassign(target: Seed, previousAssignedUserId: string, newAssignedUserId: string): Promise<void> {
    return reassignConversationCommand.undo!({
      input: {} as never,
      ctx: commandCtx(),
      logEntry: {
        commandPayload: {
          undo: {
            threadMappingId: target.mappingId,
            conversationId: target.conversationId,
            tenantId: target.tenantId,
            previousAssignedUserId,
            newAssignedUserId,
          },
        },
      } as never,
    })
  }

  async function owners(target: Seed): Promise<{ mapping: string | null; conversation: string | null }> {
    const em = rootEm()
    const [mapping] = await em.execute<Array<{ owner: string | null }>>(
      'select assigned_user_id as owner from channel_thread_mappings where id = ?',
      [target.mappingId],
    )
    const [conversation] = await em.execute<Array<{ owner: string | null }>>(
      'select assigned_user_id as owner from external_conversations where id = ?',
      [target.conversationId],
    )
    return { mapping: mapping.owner, conversation: conversation.owner }
  }

  async function waitForLockWaiterOrSettled(promise: Promise<unknown>): Promise<void> {
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline && !settled) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      )
      if (rows[0].waiting >= 1) return
      await new Promise((resolveWait) => setTimeout(resolveWait, WAITER_POLL_MS))
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: DATABASE_NAME, POSTGRES_USER: DATABASE_USER, POSTGRES_PASSWORD: DATABASE_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: Object.values(entities).filter((value) => typeof value === 'function') as never,
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 180_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  afterEach(() => {
    mockGateState.gate?.release.resolve()
    mockGateState.gate = null
  })

  it('refuses to undo A->B after a later B->C and keeps C', async () => {
    const target = await seed(USER_C)
    const outcome = await settle(undoReassign(target, USER_A, USER_B))
    expect(outcome).toMatchObject({ ok: false, error: { status: 409, body: { code: CONFLICT_CODE } } })
    expect(await owners(target)).toEqual({ mapping: USER_C, conversation: USER_C })
  }, CASE_TIMEOUT_MS)

  it('keeps a B->C reassignment that starts while the A->B undo is between its read and write', async () => {
    const target = await seed(USER_B)
    const gate = armGate('ExternalConversation')
    const undoing = settle(undoReassign(target, USER_A, USER_B))
    await gate.reached.promise
    const reassigning = settle(reassign(target, USER_C))
    await waitForLockWaiterOrSettled(reassigning)
    gate.release.resolve()
    const [undoOutcome, reassignOutcome] = await Promise.all([undoing, reassigning])
    expect(undoOutcome.ok).toBe(true)
    expect(reassignOutcome).toMatchObject({ ok: true, value: { status: 'reassigned', previousAssignedUserId: USER_A } })
    expect(await owners(target)).toEqual({ mapping: USER_C, conversation: USER_C })
  }, CASE_TIMEOUT_MS)

  it('records the first of two concurrent reassignments as the previous owner of the second', async () => {
    const target = await seed(USER_A)
    const gate = armGate('ExternalConversation')
    const first = settle(reassign(target, USER_B))
    await gate.reached.promise
    const second = settle(reassign(target, USER_C))
    await waitForLockWaiterOrSettled(second)
    gate.release.resolve()
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])
    expect(firstOutcome).toMatchObject({ ok: true, value: { previousAssignedUserId: USER_A } })
    expect(secondOutcome).toMatchObject({ ok: true, value: { previousAssignedUserId: USER_B } })
    expect(await owners(target)).toEqual({ mapping: USER_C, conversation: USER_C })
  }, CASE_TIMEOUT_MS)

  it('never deadlocks or loses the newer owner across unsynchronised undo and reassign pairs', async () => {
    const failures: Array<{ undo: string; reassign: string; mapping: string | null; conversation: string | null }> = []
    for (let index = 0; index < 25; index += 1) {
      const target = await seed(USER_B)
      const [undoOutcome, reassignOutcome] = await Promise.all([
        settle(undoReassign(target, USER_A, USER_B)),
        settle(reassign(target, USER_C)),
      ])
      const state = await owners(target)
      const undoResult = undoOutcome.ok ? 'ok' : String(undoOutcome.error.body?.code ?? undoOutcome.error.status)
      const reassignResult = reassignOutcome.ok ? reassignOutcome.value.status : 'error'
      const acceptable =
        (undoResult === 'ok' || undoResult === CONFLICT_CODE) &&
        reassignResult === 'reassigned' &&
        state.mapping === USER_C &&
        state.conversation === USER_C
      if (!acceptable) failures.push({ undo: undoResult, reassign: reassignResult, ...state })
    }
    expect(failures).toEqual([])
  }, 120_000)
})
