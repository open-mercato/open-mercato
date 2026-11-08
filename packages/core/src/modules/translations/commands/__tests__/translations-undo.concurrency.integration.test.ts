/** @jest-environment node */
import {
  Kysely,
  PostgresDialect,
  sql,
  type Generated,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from 'kysely'
import { Pool } from 'pg'
import type { StartedTestContainer } from 'testcontainers'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../../events', () => ({
  emitTranslationsEvent: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type Translations = Record<string, Record<string, string | null>>

type TestDatabase = {
  entity_translations: {
    id: Generated<string>
    entity_type: string
    entity_id: string
    organization_id: string | null
    tenant_id: string | null
    translations: Translations
    created_at: Generated<Date>
    updated_at: Generated<Date>
  }
}

type Deferred = { promise: Promise<void>; resolve: () => void }

type Outcome = { ok: true } | { ok: false; status?: number; code?: string }

type SaveHandler = CommandHandler<typeof KEY & { translations: Translations }, { rowId: string }>
type DeleteHandler = CommandHandler<typeof KEY, { deleted: boolean }>
type LogEntry = Record<string, unknown>

const KEY = {
  entityType: 'catalog:catalog_product',
  entityId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const CONFLICT = expect.objectContaining({ ok: false, status: 409, code: 'translations.errors.undoConflict' })
const LOCK_WAIT_TIMEOUT_MS = 10_000
const LOCK_WAIT_POLL_MS = 25
const SAVE_WAIT_TIMEOUT_MS = 2_000

function createDeferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((resolveDeferred) => {
    resolve = resolveDeferred
  })
  return { promise, resolve }
}

class FirstSelectGate implements KyselyPlugin {
  private armed = false
  private readonly gated = new WeakSet<object>()
  reached = createDeferred()
  release = createDeferred()

  arm(): void {
    this.armed = true
    this.reached = createDeferred()
    this.release = createDeferred()
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (this.armed && args.node.kind === 'SelectQueryNode') {
      this.armed = false
      this.gated.add(args.queryId)
    }
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    if (this.gated.has(args.queryId)) {
      this.gated.delete(args.queryId)
      this.reached.resolve()
      await this.release.promise
    }
    return args.result
  }
}

async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try {
    await promise
    return { ok: true }
  } catch (error) {
    const failure = error as { status?: number; body?: { code?: string }; code?: string }
    return { ok: false, status: failure.status, code: failure.body?.code ?? failure.code }
  }
}

describeWithPostgres('translations undo against concurrent saves on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let pool: Pool | null = null
  let database: Kysely<TestDatabase> | null = null
  let save: SaveHandler
  let remove: DeleteHandler
  const gate = new FirstSelectGate()

  function db(): Kysely<TestDatabase> {
    if (!database) throw new Error('[internal] database is not started')
    return database
  }

  function ctx(): CommandRuntimeContext {
    return {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return { getKysely: () => db() }
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      },
      auth: null,
      organizationScope: null,
      selectedOrganizationId: KEY.organizationId,
      organizationIds: [KEY.organizationId],
    } as unknown as CommandRuntimeContext
  }

  async function runSave(translations: Translations): Promise<LogEntry> {
    const input = { ...KEY, translations }
    const prepared = await save.prepare!(input, ctx())
    const result = await save.execute(input, ctx())
    const after = await save.captureAfter!(input, result, ctx())
    const log = await save.buildLog!({ input, result, ctx: ctx(), snapshots: { before: prepared?.before, after } } as never)
    return JSON.parse(JSON.stringify(log)) as LogEntry
  }

  async function runDelete(): Promise<LogEntry> {
    const prepared = await remove.prepare!(KEY, ctx())
    const result = await remove.execute(KEY, ctx())
    const log = await remove.buildLog!({ input: KEY, result, ctx: ctx(), snapshots: { before: prepared?.before } } as never)
    return JSON.parse(JSON.stringify(log)) as LogEntry
  }

  function undo(handler: SaveHandler | DeleteHandler, logEntry: LogEntry): Promise<unknown> {
    return Promise.resolve(handler.undo!({ input: {} as never, ctx: ctx(), logEntry: logEntry as never }))
  }

  async function current(): Promise<Translations | null> {
    const row = await db().selectFrom('entity_translations').select('translations').executeTakeFirst()
    return row?.translations ?? null
  }

  async function sawLockWaiter(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const waiting = await sql<{ count: string }>`
        select count(*)::text as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `.execute(db())
      if (Number(waiting.rows[0]?.count ?? 0) > 0) return true
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
    }
    return false
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'translations_test', POSTGRES_PASSWORD: 'translations_test', POSTGRES_DB: 'translations_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    pool = new Pool({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'translations_test',
      password: 'translations_test',
      database: 'translations_test',
      max: 10,
    })
    database = new Kysely<TestDatabase>({ dialect: new PostgresDialect({ pool }), plugins: [gate] })
    await sql`
      create table entity_translations (
        id uuid not null default gen_random_uuid() primary key,
        entity_type text not null,
        entity_id text not null,
        organization_id uuid null,
        tenant_id uuid null,
        translations jsonb not null default '{}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `.execute(db())
    await sql`
      create unique index entity_translations_scope_uq on entity_translations (
        entity_type,
        entity_id,
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'),
        coalesce(tenant_id, '00000000-0000-0000-0000-000000000000')
      )
    `.execute(db())
    jest.isolateModules(() => {
      require('../translations')
    })
    save = registerCommand.mock.calls.find(([handler]) => handler.id === 'translations.translation.save')?.[0]
    remove = registerCommand.mock.calls.find(([handler]) => handler.id === 'translations.translation.delete')?.[0]
    if (!save || !remove) throw new Error('[internal] translation commands were not registered')
  }, 120_000)

  afterAll(async () => {
    try {
      await database?.destroy()
    } finally {
      await postgres?.stop()
    }
  })

  beforeEach(async () => {
    await sql`delete from entity_translations`.execute(db())
  })

  it('keeps a save that commits while the undo is checking the row', async () => {
    await runSave({ en: { name: 'Shoe' } })
    const log = await runSave({ en: { name: 'Sneaker' } })
    const newer = { en: { name: 'Sneaker' }, fr: { name: 'Baskets' } }

    gate.arm()
    const undone = settle(undo(save, log))
    await gate.reached.promise
    const saved = settle(save.execute({ ...KEY, translations: newer }, ctx()))
    const saveWaitedForUndo = await sawLockWaiter(SAVE_WAIT_TIMEOUT_MS)
    gate.release.resolve()

    expect(await undone).toEqual({ ok: true })
    expect(await saved).toEqual({ ok: true })
    expect(await current()).toEqual(newer)
    expect(saveWaitedForUndo).toBe(true)
  })

  it('refuses the undo when a save was still uncommitted as the undo started', async () => {
    await runSave({ en: { name: 'Shoe' } })
    const log = await runSave({ en: { name: 'Sneaker' } })
    const newer = { en: { name: 'Sneaker' }, fr: { name: 'Baskets' } }

    const client = await pool!.connect()
    try {
      await client.query('begin')
      await client.query('update entity_translations set translations = $1::jsonb, updated_at = now()', [JSON.stringify(newer)])
      const undone = settle(undo(save, log))
      expect(await sawLockWaiter(LOCK_WAIT_TIMEOUT_MS)).toBe(true)
      await client.query('commit')

      expect(await undone).toEqual(CONFLICT)
    } finally {
      client.release()
    }
    expect(await current()).toEqual(newer)
  })

  it('answers 409 when translations are re-created while a delete is being undone', async () => {
    await runSave({ en: { name: 'Shoe' } })
    const log = await runDelete()
    const newer = { de: { name: 'Schuh' } }

    gate.arm()
    const undone = settle(undo(remove, log))
    await gate.reached.promise
    await save.execute({ ...KEY, translations: newer }, ctx())
    gate.release.resolve()

    expect(await undone).toEqual(CONFLICT)
    expect(await current()).toEqual(newer)
  })
})
