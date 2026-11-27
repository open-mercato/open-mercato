import { asFunction, asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import type { EventBus } from '@open-mercato/events/types'
import { invalidateCrudCache } from '../../crud/cache'
import { registerTelemetryErrorReporter } from '../../telemetry/runtime'
import { DefaultDataEngine, type DataEngine } from '../../data/engine'
import { CommandBus } from '../command-bus'
import { registerCommandInterceptors } from '../command-interceptor-store'
import { withAtomicFlush } from '../flush'
import { registerCommand, unregisterCommand } from '../registry'
import { getTransactionLifetime } from '../transaction-lifetime'
import type { CommandExecuteResult, CommandRuntimeContext } from '../types'

jest.mock('../../crud/cache', () => ({
  ...jest.requireActual('../../crud/cache'),
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/core/modules/entities/lib/validation', () => ({
  validateCustomFieldValuesServer: jest.fn(async () => ({ ok: true, fieldErrors: {} })),
}))
jest.mock('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer', () => ({
  sanitizeCustomFieldHtmlRichTextValuesServer: jest.fn(async (_em: unknown, input: { values: unknown }) => input.values),
}))

type Input = { id: string }
type Result = { id: string }
const commandId = 'example.todo.ambient-test'
const events = { module: 'example', entity: 'todo' }
const indexer = { entityType: 'example:todo' }
const scope = { tenantId: 'tenant', organizationId: 'organization' }

function fixture() {
  const chronology: string[] = []
  const data = { rows: [] as string[], customFields: [] as string[], logs: [] as string[] }
  let snapshot: typeof data | undefined
  const em = {
    isInTransaction: () => snapshot !== undefined,
    async begin() {
      snapshot = structuredClone(data)
      chronology.push('begin')
    },
    async commit() {
      snapshot = undefined
      chronology.push('commit')
    },
    async rollback() {
      Object.assign(data, snapshot)
      snapshot = undefined
      chronology.push('rollback')
    },
    async flush() { chronology.push('flush') },
  } as unknown as EntityManager

  const container = createContainer()
  const dispose = jest.fn(async () => undefined)
  jest.mocked(invalidateCrudCache).mockImplementation(async () => {
    expect(em.isInTransaction()).toBe(false)
    chronology.push('invalidate-cache')
  })
  const requestEm = {} as EntityManager
  const engine = new DefaultDataEngine(requestEm, container)
  const emitEvent: EventBus['emitEvent'] = jest.fn(async (name) => { chronology.push(name) })
  const actionLogService = {
    log: jest.fn(async (input, actionLogEm) => {
      expect(actionLogEm).toBe(em)
      expect(em.isInTransaction()).toBe(true)
      chronology.push('log')
      data.logs.push(input.resourceId)
      return { id: 'log-entry' }
    }),
  }
  container.register({
    em: asValue(requestEm),
    dataEngine: asValue(engine),
    eventBus: asValue({ emitEvent }),
    actionLogService: asValue(actionLogService),
    scopedResource: asFunction(() => ({})).scoped().disposer(dispose),
  })
  const context: CommandRuntimeContext = {
    container, auth: null, organizationScope: null, selectedOrganizationId: null, organizationIds: null,
  }
  const contextFor = (transactionalEm: EntityManager = em): CommandRuntimeContext => ({
    ...context, transactionalEm, transactionLifetime: getTransactionLifetime(em) ?? undefined,
  })
  const bus = new CommandBus()
  return { bus, em, engine, emitEvent, chronology, actionLogService, data, context, contextFor, dispose }
}

function registerAmbientCommand(setup: ReturnType<typeof fixture>): void {
  const { chronology, data, em, engine } = setup
  jest.mocked(setRecordCustomFields).mockImplementation(async (customFieldEm, input) => {
    expect(customFieldEm).toBe(em)
    expect(em.isInTransaction()).toBe(true)
    data.customFields.push(input.recordId)
    chronology.push('custom-fields')
  })
  registerCommand<Input, Result>({
    id: commandId,
    prepare(input, ctx) {
      expect(ctx.container.resolve('em')).toBe(em)
      expect(ctx.transactionalEm).toBe(em)
      chronology.push(`snapshot:${input.id}`)
      return { before: { registered: false } }
    },
    async execute(input, ctx) {
      ctx.container.resolve('scopedResource')
      const commandEngine = ctx.container.resolve<DataEngine>('dataEngine')
      expect(commandEngine).not.toBe(engine)
      await ctx.beforeTransactionalWrite?.(em, input)
      data.rows.push(input.id)
      chronology.push('write')
      const identifiers = { id: input.id, ...scope }
      await commandEngine.setCustomFields({
        entityId: 'example:todo',
        recordId: input.id,
        values: { enabled: true },
        ...scope,
      })
      commandEngine.markOrmEntityChange({ action: 'created', entity: input, identifiers, events, indexer })
      await commandEngine.flushOrmEntityChanges()
      await commandEngine.emitOrmEntityEvent({
        action: 'deleted',
        entity: input,
        identifiers,
        events: { ...events, entity: 'direct' },
      })
      return { id: input.id }
    },
    captureAfter(input, _result, ctx) {
      expect(ctx.transactionalEm).toBe(em)
      chronology.push(`after-snapshot:${input.id}`)
      return { registered: true }
    },
    buildLog({ input }) {
      return { resourceKind: 'example.todo', resourceId: input.id }
    },
  })
  registerCommandInterceptors([{ moduleId: 'example', interceptors: [{
    id: 'example.ambient-after',
    targetCommand: commandId,
    afterExecute: async () => {
      expect(em.isInTransaction()).toBe(false)
      chronology.push('after-execute')
      return { modifiedResult: { id: 'presentation-id' } }
    },
  }] }])
}

afterEach(() => {
  unregisterCommand(commandId)
  registerCommandInterceptors([])
  jest.clearAllMocks()
})

it('validates ownership before interceptors and preserves the existing lifecycle for lifetime-less calls', async () => {
  const setup = fixture()
  const beforeExecute = jest.fn()
  const execute = jest.fn(() => ({ id: 'legacy' }))
  registerCommand({ id: commandId, execute })
  registerCommandInterceptors([{ moduleId: 'example', interceptors: [{
    id: 'example.before', targetCommand: commandId, beforeExecute,
  }] }])
  await withAtomicFlush(setup.em, [async () => {
    const lifetime = getTransactionLifetime(setup.em)
    if (!lifetime) throw new Error('[internal] Missing fixture owner')
    await expect(setup.bus.execute(commandId, {
      input: { id: 'wrong-lifetime' },
      ctx: { ...setup.context, transactionLifetime: lifetime, transactionalEm: {} as EntityManager },
    })).rejects.toThrow('requires its active transaction lifetime owner')
    expect(beforeExecute).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()

    const result = await setup.bus.execute(commandId, {
      input: { id: 'legacy' }, ctx: { ...setup.context, transactionalEm: setup.em },
    })
    expect(result.ambient).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(beforeExecute).toHaveBeenCalledTimes(1)
  }], { transaction: true })
})

it('keeps logs and custom fields on the outer EM and publishes committed effects once', async () => {
  const setup = fixture()
  registerAmbientCommand(setup)
  setup.engine.markOrmEntityChange({
    action: 'updated', entity: { id: 'legacy' }, identifiers: { id: 'legacy', ...scope },
    events: { ...events, entity: 'legacy' },
  })
  let handle: CommandExecuteResult<Result>['ambient']
  await withAtomicFlush(setup.em, [async () => {
    const command = await setup.bus.execute<Input, Result>(commandId, {
      input: { id: 'authoritative' },
      ctx: {
        ...setup.contextFor(),
        beforeTransactionalWrite: async () => { setup.chronology.push('verified') },
      },
    })
    handle = command.ambient
    expect(handle?.tentativeResult).toEqual({ id: 'authoritative' })
    expect(handle?.logEntry?.id).toBe('log-entry')
    expect(() => handle?.finalizedResult()).toThrow('no committed result')
    expect(setup.emitEvent).not.toHaveBeenCalled()
    expect(invalidateCrudCache).not.toHaveBeenCalled()
    expect(setup.dispose).not.toHaveBeenCalled()
    expect(setup.chronology).toEqual([
      'begin', 'verified', 'snapshot:authoritative', 'write', 'custom-fields', 'after-snapshot:authoritative', 'log',
    ])
  }], { transaction: true })

  expect(handle?.finalizedResult()).toEqual({ id: 'presentation-id' })
  expect(setup.data).toEqual({ rows: ['authoritative'], customFields: ['authoritative'], logs: ['authoritative'] })
  const committedAt = setup.chronology.indexOf('commit')
  expect(setup.chronology.slice(committedAt + 1)).toEqual([
    'after-execute', 'invalidate-cache', 'example.todo.updated', 'example.todo.created', 'query_index.upsert_one',
    'query_index.coverage.refresh', 'example.direct.deleted',
  ])
  expect(setup.emitEvent).toHaveBeenCalledTimes(5)
  expect(invalidateCrudCache).toHaveBeenCalledTimes(1)
  expect(invalidateCrudCache).toHaveBeenCalledWith(expect.anything(), 'example.todo',
    expect.objectContaining({ id: 'authoritative' }), null, expect.any(String), expect.any(Array))
  expect(setup.dispose).toHaveBeenCalledTimes(1)

  await setup.engine.flushOrmEntityChanges()
  expect(setup.chronology.at(-1)).toBe('example.legacy.updated')
})

it('discards all deferred effects when the owner rolls back after the command returns', async () => {
  const setup = fixture()
  registerAmbientCommand(setup)
  let handle: CommandExecuteResult<Result>['ambient']
  await expect(withAtomicFlush(setup.em, [async () => {
    const command = await setup.bus.execute<Input, Result>(commandId, {
      input: { id: 'abandoned' }, ctx: setup.contextFor(),
    })
    handle = command.ambient
    expect(handle?.tentativeResult).toEqual({ id: 'abandoned' })
    expect(setup.emitEvent).not.toHaveBeenCalled()
    throw new Error('[internal] Outer composition rejected')
  }], { transaction: true })).rejects.toThrow('Outer composition rejected')

  expect(() => handle?.finalizedResult()).toThrow('no committed result')
  expect(setup.data).toEqual({ rows: [], customFields: [], logs: [] })
  expect(setup.chronology.at(-1)).toBe('rollback')
  expect(setup.chronology).not.toContain('after-execute')
  expect(invalidateCrudCache).not.toHaveBeenCalled()
  expect(setup.dispose).toHaveBeenCalledTimes(1)
  await setup.engine.flushOrmEntityChanges()
  expect(setup.emitEvent).not.toHaveBeenCalled()
})

it('keeps a committed response and remaining effects when reporting an afterExecute failure also throws', async () => {
  const setup = fixture()
  registerAmbientCommand(setup)
  const report = jest.fn(() => { throw new Error('[internal] Reporter unavailable') })
  const restore = registerTelemetryErrorReporter(report)
  registerCommandInterceptors([{ moduleId: 'example', interceptors: [{
    id: 'example.ambient-failing-after',
    targetCommand: commandId,
    priority: 1,
    afterExecute: async () => { throw new Error('[internal] Private exception detail') },
  }, {
    id: 'example.ambient-follow-up',
    targetCommand: commandId,
    priority: 2,
    afterExecute: async () => ({ modifiedResult: { id: 'final-id' } }),
  }] }])
  let handle: CommandExecuteResult<Result>['ambient']
  try {
    await withAtomicFlush(setup.em, [async () => {
      const command = await setup.bus.execute<Input, Result>(commandId, {
        input: { id: 'authoritative' }, ctx: setup.contextFor(),
      })
      handle = command.ambient
    }], { transaction: true })
  } finally {
    restore()
  }
  expect(handle?.finalizedResult()).toEqual({ id: 'final-id' })
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({ message: '[internal] Ambient command completion failed' }),
    expect.objectContaining({
      code: 'shared.ambient_command_completion_failed',
      attributes: { commandId, reason: 'after_execute_interceptor' },
    }),
  )
  expect(setup.emitEvent).toHaveBeenCalled()
  expect(setup.dispose).toHaveBeenCalledTimes(1)
})
