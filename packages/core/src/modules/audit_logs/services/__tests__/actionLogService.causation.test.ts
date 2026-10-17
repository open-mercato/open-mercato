import { ZodError } from 'zod'
import { ActionLogService } from '../actionLogService'
import type { ActionLogCreateInput } from '@open-mercato/core/modules/audit_logs/data/validators'
import {
  reportCausationDegradation,
  runWithCausation,
} from '@open-mercato/shared/lib/causation/server'
import type { CausationEnvelope } from '@open-mercato/shared/lib/causation/types'

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: jest.fn(),
}))

const reportDegradation = reportCausationDegradation as jest.MockedFunction<typeof reportCausationDegradation>

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORG_ID = '10000000-0000-4000-8000-000000000002'
const USER_ID = '10000000-0000-4000-8000-000000000003'
const KEY_ID = '55555555-5555-4555-8555-555555555555'
const CORRELATION_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_LOG_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_LOG_ID = '44444444-4444-4444-8444-444444444444'
const WORKFLOW_INSTANCE_ID = '66666666-6666-4666-8666-666666666666'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WORKFLOW_ENVELOPE: CausationEnvelope = {
  correlationId: CORRELATION_ID,
  causedByLogId: PARENT_LOG_ID,
  frames: [{ kind: 'user' }, { kind: 'workflow', id: WORKFLOW_INSTANCE_ID, ref: 'step-1' }],
}

type PersistedLog = Record<string, unknown> & {
  causeKind: string | null
  causeId: string | null
  correlationId: string | null
  causedByLogId: string | null
  contextJson: Record<string, unknown> | null
}

function buildLogService() {
  const persisted: PersistedLog[] = []
  const forkEm = {
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({ ...payload })),
    persist: jest.fn((entity: PersistedLog) => {
      persisted.push(entity)
      return { flush: jest.fn(async () => undefined) }
    }),
  }
  const em = { fork: jest.fn(() => forkEm) }
  const service = new ActionLogService(em as never)
  return { service, persisted }
}

function baseInput(overrides: Partial<ActionLogCreateInput> = {}): ActionLogCreateInput {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    actorUserId: USER_ID,
    commandId: 'customers.people.update',
    resourceKind: 'customers.person',
    resourceId: 'person-1',
    ...overrides,
  }
}

describe('ActionLogService causation stamping', () => {
  const previousCausationFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    reportDegradation.mockClear()
  })

  afterEach(() => {
    if (previousCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousCausationFlag
  })

  it('projects the explicit envelope into the cause columns and the context', async () => {
    const { service, persisted } = buildLogService()

    await service.log(baseInput({ context: { source: 'ui' } }), undefined, WORKFLOW_ENVELOPE)

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toEqual(expect.objectContaining({
      causeKind: 'workflow',
      causeId: WORKFLOW_INSTANCE_ID,
      correlationId: CORRELATION_ID,
      causedByLogId: PARENT_LOG_ID,
      sourceKey: 'ui',
    }))
    expect(persisted[0].contextJson).toEqual({
      source: 'ui',
      actorSubject: USER_ID,
      causation: WORKFLOW_ENVELOPE,
    })
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  it('replaces a caller-provided context.causation with the server envelope', async () => {
    const { service, persisted } = buildLogService()
    const spoofed = { correlationId: CORRELATION_ID, frames: [{ kind: 'business_rule', id: 'rule-1' }] }

    await service.log(baseInput({ context: { causation: spoofed, kept: true } }), undefined, WORKFLOW_ENVELOPE)

    expect(persisted[0].causeKind).toBe('workflow')
    expect(persisted[0].contextJson).toEqual(expect.objectContaining({ kept: true, causation: WORKFLOW_ENVELOPE }))
  })

  it('never reads cause fields from the create input', async () => {
    const { service, persisted } = buildLogService()
    const input = {
      ...baseInput(),
      causeKind: 'workflow',
      causeId: WORKFLOW_INSTANCE_ID,
      correlationId: CORRELATION_ID,
      causedByLogId: PARENT_LOG_ID,
    } as ActionLogCreateInput

    await service.log(input)

    expect(persisted[0].causeKind).toBe('user')
    expect(persisted[0].causeId).toBeNull()
    expect(persisted[0].correlationId).not.toBe(CORRELATION_ID)
    expect(persisted[0].causedByLogId).toBeNull()
  })

  it('uses the ambient envelope when no causation argument is passed', async () => {
    const { service, persisted } = buildLogService()

    await runWithCausation(WORKFLOW_ENVELOPE, () => service.log(baseInput()))

    expect(persisted[0].causeKind).toBe('workflow')
    expect(persisted[0].correlationId).toBe(CORRELATION_ID)
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  it('treats an explicit null causation as "no envelope" and falls back instead of reading the ambient scope', async () => {
    const { service, persisted } = buildLogService()

    await runWithCausation(WORKFLOW_ENVELOPE, () => service.log(baseInput(), undefined, null))

    expect(persisted[0].causeKind).toBe('user')
    expect(persisted[0].correlationId).not.toBe(CORRELATION_ID)
  })

  const DERIVED_FROM_ACTOR = { derivedFrom: 'actor' }

  it.each([
    ['a user actor', USER_ID, { kind: 'user', meta: DERIVED_FROM_ACTOR }],
    ['an API-key actor', `api_key:${KEY_ID}`, { kind: 'api_key', id: KEY_ID, meta: DERIVED_FROM_ACTOR }],
    ['a system actor reference', 'system:example_sync', { kind: 'system', ref: 'system:example_sync', meta: DERIVED_FROM_ACTOR }],
    ['a bare system prefix', 'system:', { kind: 'unknown', meta: DERIVED_FROM_ACTOR }],
    ['an unrecognised actor string', 'not-a-principal', { kind: 'unknown', meta: DERIVED_FROM_ACTOR }],
    ['no actor', undefined, { kind: 'unknown', meta: DERIVED_FROM_ACTOR }],
  ])('builds an actor-derived fallback envelope for %s when no causation is available', async (_label, actorUserId, frame) => {
    const { service, persisted } = buildLogService()

    await service.log(baseInput({ actorUserId }))

    const expectedFrame = frame as { kind: string; id?: string }
    expect(persisted[0].causeKind).toBe(expectedFrame.kind)
    expect(persisted[0].causeId).toBe(expectedFrame.id ?? null)
    expect(persisted[0].correlationId).toMatch(UUID_PATTERN)
    expect(persisted[0].causedByLogId).toBeNull()
    expect(persisted[0].contextJson?.causation).toEqual({
      correlationId: persisted[0].correlationId,
      frames: [frame],
    })
    expect(reportDegradation).toHaveBeenCalledTimes(1)
    expect(reportDegradation).toHaveBeenCalledWith('log_fallback_actor', { resourceKind: 'customers.person' })
  })

  it('reports the fallback with a null resource kind when the input has none', async () => {
    const { service } = buildLogService()

    await service.log(baseInput({ resourceKind: undefined }))

    expect(reportDegradation).toHaveBeenCalledWith('log_fallback_actor', { resourceKind: null })
  })

  it('falls back and reports the degradation when the supplied envelope is malformed', async () => {
    const { service, persisted } = buildLogService()

    await service.log(baseInput(), undefined, { correlationId: CORRELATION_ID, frames: [] })

    expect(persisted[0].causeKind).toBe('user')
    expect(persisted[0].correlationId).not.toBe(CORRELATION_ID)
    expect(reportDegradation).toHaveBeenCalledWith('log_fallback_actor', { resourceKind: 'customers.person' })
  })

  it('keeps the cause columns null and the context free of causation with OM_CAUSATION=off', async () => {
    process.env.OM_CAUSATION = 'off'
    const { service, persisted } = buildLogService()

    await runWithCausation(WORKFLOW_ENVELOPE, () =>
      service.log(baseInput({ context: { causation: WORKFLOW_ENVELOPE, kept: true } }), undefined, WORKFLOW_ENVELOPE),
    )

    expect(persisted[0]).toEqual(expect.objectContaining({
      causeKind: null,
      causeId: null,
      correlationId: null,
      causedByLogId: null,
    }))
    expect(persisted[0].contextJson).toEqual({ kept: true, actorSubject: USER_ID })
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  it('reports nothing for a fallback-less write with OM_CAUSATION=off', async () => {
    process.env.OM_CAUSATION = 'off'
    const { service, persisted } = buildLogService()

    await service.log(baseInput())

    expect(persisted[0].causeKind).toBeNull()
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  describe('markUndone trace row', () => {
    function buildUndoService() {
      const source = { id: SOURCE_LOG_ID, executionState: 'done', undoToken: 'token' }
      const persisted: PersistedLog[] = []
      const forkEm = {
        findOne: jest.fn(async () => source),
        create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({ ...payload })),
        persist: jest.fn((entity: PersistedLog) => {
          persisted.push(entity)
        }),
        flush: jest.fn(async () => undefined),
      }
      const service = new ActionLogService({ fork: jest.fn(() => forkEm) } as never)
      return { service, persisted, source }
    }

    const undoEnvelope: CausationEnvelope = {
      correlationId: CORRELATION_ID,
      frames: [{ kind: 'user' }, { kind: 'undo', id: SOURCE_LOG_ID }],
    }

    it('stamps the trace row from the ambient undo envelope', async () => {
      const { service, persisted, source } = buildUndoService()

      await runWithCausation(undoEnvelope, () => service.markUndone(SOURCE_LOG_ID, baseInput({
        context: { historyAction: 'undo', sourceLogId: SOURCE_LOG_ID },
      })))

      expect(source.executionState).toBe('undone')
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toEqual(expect.objectContaining({
        causeKind: 'undo',
        causeId: SOURCE_LOG_ID,
        correlationId: CORRELATION_ID,
      }))
      expect(persisted[0].contextJson).toEqual(expect.objectContaining({
        historyAction: 'undo',
        causation: undoEnvelope,
      }))
    })

    it('replaces causation inherited from the source row context with the undo envelope', async () => {
      const { service, persisted } = buildUndoService()

      await service.markUndone(SOURCE_LOG_ID, baseInput({
        context: { causation: WORKFLOW_ENVELOPE, inherited: 'kept', historyAction: 'undo' },
      }), undefined, undoEnvelope)

      expect(persisted[0].causeKind).toBe('undo')
      expect(persisted[0].contextJson).toEqual({
        inherited: 'kept',
        historyAction: 'undo',
        actorSubject: USER_ID,
        causation: undoEnvelope,
      })
    })

    it('drops inherited causation from the trace row context with OM_CAUSATION=off', async () => {
      process.env.OM_CAUSATION = 'off'
      const { service, persisted } = buildUndoService()

      await runWithCausation(undoEnvelope, () => service.markUndone(SOURCE_LOG_ID, baseInput({
        context: { causation: WORKFLOW_ENVELOPE, inherited: 'kept', historyAction: 'undo' },
      })))

      expect(persisted[0].causeKind).toBeNull()
      expect(persisted[0].contextJson).toEqual({ inherited: 'kept', historyAction: 'undo', actorSubject: USER_ID })
    })

    it('prefers an explicit causation argument for the trace row', async () => {
      const { service, persisted } = buildUndoService()

      await service.markUndone(SOURCE_LOG_ID, baseInput(), undefined, undoEnvelope)

      expect(persisted[0].causeKind).toBe('undo')
      expect(persisted[0].causeId).toBe(SOURCE_LOG_ID)
    })
  })
})

describe('ActionLogService cause filters', () => {
  type WhereCall = [string, string, unknown]

  function buildQueryService() {
    const whereCalls: WhereCall[] = []
    const builder = {
      selectAll: () => builder,
      leftJoin: () => builder,
      orderBy: () => builder,
      where: (...args: unknown[]) => {
        if (typeof args[0] === 'string') whereCalls.push(args as WhereCall)
        return builder
      },
    }
    const em = { getKysely: () => ({ selectFrom: () => builder }) }
    const service = new ActionLogService(em as never)
    const internals = service as unknown as {
      parseListQuery: (query: Record<string, unknown>) => Record<string, unknown>
      buildListQuery: (parsed: Record<string, unknown>) => unknown
    }
    const build = (query: Record<string, unknown>) => {
      internals.buildListQuery(internals.parseListQuery(query))
      return whereCalls
    }
    return { build }
  }

  it('filters by cause kind, cause id and correlation id', () => {
    const { build } = buildQueryService()

    const whereCalls = build({
      tenantId: TENANT_ID,
      causeKind: 'workflow',
      causeId: WORKFLOW_INSTANCE_ID,
      correlationId: CORRELATION_ID,
    })

    expect(whereCalls).toEqual(expect.arrayContaining([
      ['action_logs.cause_kind', '=', 'workflow'],
      ['action_logs.cause_id', '=', WORKFLOW_INSTANCE_ID],
      ['action_logs.correlation_id', '=', CORRELATION_ID],
    ]))
  })

  it('adds no cause predicates when no cause filter is requested', () => {
    const { build } = buildQueryService()

    const whereCalls = build({ tenantId: TENANT_ID })

    expect(whereCalls.some(([column]) => column.startsWith('action_logs.cause') || column === 'action_logs.correlation_id')).toBe(false)
  })

  it('rejects a causeId without a causeKind', () => {
    const { build } = buildQueryService()

    expect(() => build({ tenantId: TENANT_ID, causeId: WORKFLOW_INSTANCE_ID })).toThrow(ZodError)
  })

  it('rejects an unknown cause kind and a malformed correlation id', () => {
    const { build } = buildQueryService()

    expect(() => build({ causeKind: 'made_up' })).toThrow(ZodError)
    expect(() => build({ correlationId: 'not-a-uuid' })).toThrow(ZodError)
  })
})
