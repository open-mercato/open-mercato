/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import type { QueuedJob } from '@open-mercato/queue'
import handler, { type PollChannelJobPayload } from '../poll-channel'
import { CommunicationChannel } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: jest.fn() }),
}))

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'poll_channel_race_test'
const DATABASE_USER = 'poll_channel_race'
const DATABASE_PASSWORD = 'poll_channel_race'
const CASE_TIMEOUT_MS = 30_000
const CONCURRENT_JOBS = 8

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Deferred = { promise: Promise<void>; resolve: () => void }

type Seed = { channelId: string; tenantId: string; organizationId: string }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function encode(state: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(state)).toString('base64')
}

describeWithPostgres('poll-channel cursor commit against real Postgres', () => {
  let postgres: StartedTestContainer | undefined
  let orm: TestOrm

  function makeJob(seed: Seed): QueuedJob<PollChannelJobPayload> {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      payload: {
        channelId: seed.channelId,
        scope: { tenantId: seed.tenantId, organizationId: seed.organizationId },
        attempt: 1,
      },
    }
  }

  function makeCtx(fetchHistory: () => Promise<unknown>) {
    const adapter = { providerKey: 'imap', fetchHistory }
    return {
      jobId: randomUUID(),
      attemptNumber: 1,
      queueName: 'communication-channels-poll',
      resolve: ((name: string) => {
        if (name === 'em') return orm.em
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'commandBus') return { execute: jest.fn(async () => ({ result: {}, logEntry: null })) }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        return null
      }) as <T>(name: string) => T,
    }
  }

  async function seedChannel(channelState: Record<string, unknown>): Promise<Seed> {
    const seed: Seed = { channelId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID() }
    const em = orm.em.fork()
    em.create(CommunicationChannel, {
      id: seed.channelId,
      providerKey: 'imap',
      channelType: 'email',
      displayName: 'race',
      capabilities: { realtimePush: false },
      isActive: true,
      status: 'connected',
      channelState,
      lastPolledAt: new Date(Date.now() - 3_600_000),
      tenantId: seed.tenantId,
      organizationId: seed.organizationId,
    })
    await em.flush()
    return seed
  }

  async function readChannelState(seed: Seed): Promise<unknown> {
    const rows = await orm.em
      .getConnection()
      .execute<Array<{ channel_state: unknown }>>('select channel_state from communication_channels where id = ?', [
        seed.channelId,
      ])
    return rows[0]?.channel_state
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
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
      entities: [CommunicationChannel],
      debug: false,
      pool: { min: 0, max: CONCURRENT_JOBS + 4 },
    })
    await orm.schema.create()
  }, 120_000)

  beforeEach(() => {
    enqueueMock.mockClear()
  })

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it(
    'keeps the advanced cursor when a job that read the older cursor commits last',
    async () => {
      const seed = await seedChannel({ uidValidity: 7, uidNext: 5 })
      const slowFetchStarted = deferred()
      const releaseSlowFetch = deferred()
      const slowJob = handler(
        makeJob(seed),
        makeCtx(async () => {
          slowFetchStarted.resolve()
          await releaseSlowFetch.promise
          return { messages: [], nextCursor: encode({ uidValidity: 7, uidNext: 10 }), hasMore: true }
        }),
      )
      await slowFetchStarted.promise

      await handler(
        makeJob(seed),
        makeCtx(async () => ({ messages: [], nextCursor: encode({ uidValidity: 7, uidNext: 999 }), hasMore: false })),
      )
      expect(await readChannelState(seed)).toEqual({ uidValidity: 7, uidNext: 999 })

      releaseSlowFetch.resolve()
      await slowJob

      expect(await readChannelState(seed)).toEqual({ uidValidity: 7, uidNext: 999 })
      expect(enqueueMock).not.toHaveBeenCalled()
    },
    CASE_TIMEOUT_MS,
  )

  it(
    'lets exactly one of several jobs that read the same cursor commit and continue the drain',
    async () => {
      const seed = await seedChannel({ uidValidity: 7, uidNext: 5 })
      const releaseFetches = deferred()
      const fetchesStarted = Array.from({ length: CONCURRENT_JOBS }, () => deferred())
      const jobs = fetchesStarted.map((fetchStarted, index) =>
        handler(
          makeJob(seed),
          makeCtx(async () => {
            fetchStarted.resolve()
            await releaseFetches.promise
            return { messages: [], nextCursor: encode({ uidValidity: 7, uidNext: 100 + index }), hasMore: true }
          }),
        ),
      )
      await Promise.all(fetchesStarted.map((fetchStarted) => fetchStarted.promise))

      releaseFetches.resolve()
      await Promise.all(jobs)

      const finalState = (await readChannelState(seed)) as { uidValidity: number; uidNext: number }
      expect(finalState.uidValidity).toBe(7)
      expect(finalState.uidNext).toBeGreaterThanOrEqual(100)
      expect(finalState.uidNext).toBeLessThan(100 + CONCURRENT_JOBS)
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    },
    CASE_TIMEOUT_MS,
  )

  it(
    'rolls back a failed commit without enqueueing and lets a rerun commit',
    async () => {
      const seed = await seedChannel({ uidValidity: 7, uidNext: 5 })
      const connection = orm.em.getConnection()
      const readLastPolledAt = async () => {
        const rows = await connection.execute<Array<{ last_polled_at: Date }>>(
          'select last_polled_at from communication_channels where id = ?',
          [seed.channelId],
        )
        return rows[0]?.last_polled_at
      }
      const lastPolledAtBefore = await readLastPolledAt()
      await connection.execute(
        `create or replace function poll_channel_race_fail_commit() returns trigger as $$
         begin
           if new.channel_state->>'uidNext' = '666' then
             raise exception 'injected commit failure';
           end if;
           return new;
         end
         $$ language plpgsql`,
      )
      await connection.execute(
        'create trigger poll_channel_race_fail_commit before update on communication_channels for each row execute function poll_channel_race_fail_commit()',
      )
      try {
        await expect(
          handler(
            makeJob(seed),
            makeCtx(async () => ({ messages: [], nextCursor: encode({ uidValidity: 7, uidNext: 666 }), hasMore: true })),
          ),
        ).rejects.toThrow('injected commit failure')

        expect(await readChannelState(seed)).toEqual({ uidValidity: 7, uidNext: 5 })
        expect(await readLastPolledAt()).toEqual(lastPolledAtBefore)
        expect(enqueueMock).not.toHaveBeenCalled()

        await handler(
          makeJob(seed),
          makeCtx(async () => ({ messages: [], nextCursor: encode({ uidValidity: 7, uidNext: 8 }), hasMore: false })),
        )
        expect(await readChannelState(seed)).toEqual({ uidValidity: 7, uidNext: 8 })
      } finally {
        await connection.execute('drop trigger if exists poll_channel_race_fail_commit on communication_channels')
        await connection.execute('drop function if exists poll_channel_race_fail_commit()')
      }
    },
    CASE_TIMEOUT_MS,
  )
})
