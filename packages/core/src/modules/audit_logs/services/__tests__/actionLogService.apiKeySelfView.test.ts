import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { ActionLogService, REPLAY_ENCRYPTED_SCAN_MAX_PAGES } from '../actionLogService'
import {
  buildActionLogQueryHarness,
  type ActionLogQueryRow,
} from './actionLogServiceQueryHarness'

const keyId = '22222222-2222-4222-8222-222222222222'
const keySubject = `api_key:${keyId}`
const tenantId = '11111111-1111-4111-8111-111111111111'

type CompilableQuery = { compile: () => { sql: string; parameters: readonly unknown[] } }
type ServiceInternals = {
  buildListQuery: (parsed: Record<string, unknown>) => CompilableQuery
  parseListQuery: (query: Record<string, unknown>) => Record<string, unknown>
}

function createKysely(): Kysely<Record<string, never>> {
  return new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<Record<string, never>>) => new PostgresIntrospector(instance),
    },
  })
}

function stubListQuery(service: ActionLogService, query: unknown) {
  const internals = service as unknown as { buildListQuery: () => unknown }
  jest.spyOn(internals, 'buildListQuery').mockReturnValue(query)
}

function compileListQuery(query: Record<string, unknown>) {
  const kysely = createKysely()
  const service = new ActionLogService({ getKysely: () => kysely } as never)
  const internals = service as unknown as ServiceInternals
  return internals.buildListQuery(internals.parseListQuery(query)).compile()
}

describe('ActionLogService API-key self-view list query', () => {
  it('keeps encrypted and legacy rows owned by the key in SQL instead of matching plaintext actorSubject only', () => {
    const compiled = compileListQuery({ tenantId, actorSubject: keySubject })

    expect(compiled.sql).toContain('"action_logs"."actor_user_id" = $')
    expect(compiled.sql).toContain("jsonb_typeof(action_logs.context_json) = 'string'")
    expect(compiled.sql).toContain('action_logs.context_json is null')
    expect(compiled.sql).toContain('not jsonb_exists(action_logs.context_json')
    expect(compiled.parameters).toEqual(expect.arrayContaining([keyId, 'actorSubject', keySubject]))
  })

  it('does not add the context predicate for a user subject', () => {
    const compiled = compileListQuery({ tenantId, actorSubject: keyId })

    expect(compiled.sql).toContain('"action_logs"."actor_user_id" = $')
    expect(compiled.sql).not.toContain('context_json')
  })

  it('classifies encrypted rows after decryption so canonical and legacy key rows survive while foreign subjects are dropped', async () => {
    const plaintextContexts: Record<string, Record<string, unknown>> = {
      'cipher:canonical': { actorSubject: keySubject },
      'cipher:legacy': { source: 'api' },
      'cipher:same-uuid-user': { actorSubject: keyId },
      'cipher:malformed': { actorSubject: `${keySubject}:malformed` },
    }
    const storedRows = [
      { id: 'canonical', actorUserId: keyId, tenantId, contextJson: 'cipher:canonical' },
      { id: 'legacy', actorUserId: keyId, tenantId, contextJson: 'cipher:legacy' },
      { id: 'legacy-null', actorUserId: keyId, tenantId, contextJson: null },
      { id: 'same-uuid-user', actorUserId: keyId, tenantId, contextJson: 'cipher:same-uuid-user' },
      { id: 'malformed', actorUserId: keyId, tenantId, contextJson: 'cipher:malformed' },
      { id: 'undecryptable', actorUserId: keyId, tenantId, contextJson: 'cipher:unknown' },
    ]
    const tenantEncryptionService = {
      isEnabled: () => true,
      getDek: async () => null,
      decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => {
        const context = typeof payload.contextJson === 'string' ? plaintextContexts[payload.contextJson] : undefined
        return context ? { contextJson: JSON.stringify(context) } : {}
      },
    }
    const em = {
      find: jest.fn(async () => storedRows.map((entry) => ({ ...entry }))),
    }
    const service = new ActionLogService(em as never, tenantEncryptionService as never)
    const execute = jest.fn(async () => storedRows.map((entry) => ({ id: entry.id })))
    const pagedQuery = { offset: () => ({ execute }) }
    stubListQuery(service, { select: () => ({ limit: () => pagedQuery }) })
    jest.spyOn(service, 'count').mockResolvedValue(storedRows.length)

    const result = await service.list({ tenantId, actorSubject: keySubject })

    expect(result.items.map((entry) => entry.id)).toEqual(['canonical', 'legacy', 'legacy-null'])
  })

  it('does not post-filter rows for a user subject', async () => {
    const storedRows = [
      { id: 'user-row', actorUserId: keyId, tenantId, contextJson: { actorSubject: keyId } },
    ]
    const em = { find: jest.fn(async () => storedRows.map((entry) => ({ ...entry }))) }
    const service = new ActionLogService(em as never)
    const execute = jest.fn(async () => storedRows.map((entry) => ({ id: entry.id })))
    stubListQuery(service, { select: () => ({ limit: () => ({ offset: () => ({ execute }) }) }) })
    jest.spyOn(service, 'count').mockResolvedValue(1)

    const result = await service.list({ tenantId, actorSubject: keyId })

    expect(result.items.map((entry) => entry.id)).toEqual(['user-row'])
  })
})

describe('ActionLogService encrypted API-key replay scan bound', () => {
  const baseTime = new Date('2026-10-04T10:00:00.000Z')
  const row = (id: string, offsetSeconds: number, overrides: Partial<ActionLogQueryRow> = {}): ActionLogQueryRow => ({
    id,
    actorUserId: keyId,
    commandId: 'auth.users.update',
    contextJson: { source: 'api' },
    createdAt: new Date(baseTime.getTime() + offsetSeconds * 1_000),
    deletedAt: null,
    executionState: 'done',
    organizationId: null,
    tenantId,
    undoToken: `${id}-token`,
    updatedAt: new Date(baseTime.getTime() + offsetSeconds * 1_000),
    ...overrides,
  })

  it('stops after the page limit and falls back to the newest legacy row', async () => {
    const pageSize = 100
    const totalRows = (REPLAY_ENCRYPTED_SCAN_MAX_PAGES + 2) * pageSize
    const legacyRows = Array.from({ length: totalRows }, (_, index) => row(`legacy-${index}`, index + 1))
    const { find, service } = buildActionLogQueryHarness(
      [...legacyRows, row('ancient-canonical', 0, { contextJson: { actorSubject: keySubject } })],
      { encryptionEnabled: true },
    )

    const result = await service.latestUndoableForActor(keySubject, { tenantId })

    expect(result).toMatchObject({ id: `legacy-${totalRows - 1}` })
    expect(find).toHaveBeenCalledTimes(REPLAY_ENCRYPTED_SCAN_MAX_PAGES)
  })

  it('returns as soon as a canonical row is found without scanning further pages', async () => {
    const { find, service } = buildActionLogQueryHarness(
      [
        row('canonical', 500, { contextJson: { actorSubject: keySubject } }),
        ...Array.from({ length: 300 }, (_, index) => row(`older-legacy-${index}`, index)),
      ],
      { encryptionEnabled: true },
    )

    await expect(service.latestUndoableForActor(keySubject, { tenantId })).resolves.toMatchObject({ id: 'canonical' })
    expect(find).toHaveBeenCalledTimes(1)
  })
})
