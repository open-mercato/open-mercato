import { randomUUID } from 'crypto'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands/types'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { CatalogProductPrice } from '../../../catalog/data/entities'
import { omnibusConfigSchema, type OmnibusBlock } from '../../../catalog/lib/omnibusTypes'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: async () => ({}) }))
jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({ setRecordCustomFields: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn() }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: TestEm, entity: unknown, where: Row) => em.find(entity, where),
  findOneWithDecryption: (em: TestEm, entity: unknown, where: Row) => em.findOne(entity, where),
}))
jest.mock('../../../catalog/lib/omnibusPresentedEntry', () => ({
  ...jest.requireActual('../../../catalog/lib/omnibusPresentedEntry'),
  resolveOmnibusPresentedEntries: async () => new Map(),
}))

type Row = Record<string, unknown>
type TestEm = {
  rows: Map<string, Row[]>;
  trace: string[];
  fork(): TestEm;
  create(entity: unknown, data: Row): Row;
  persist(row: Row): void;
  find(entity: unknown, where?: Row): Promise<Row[]>;
  findOne(entity: unknown, where: Row): Promise<Row | null>;
  nativeDelete(entity: unknown, where: Row): Promise<void>;
  remove(row: Row): void;
  getReference(entity: unknown, id: string): { id: string };
  count(): Promise<number>;
  clear(): void;
  flush(): Promise<void>;
  isInTransaction(): boolean;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  transactional(work: (tx: TestEm) => Promise<void>): Promise<void>;
}
type StoredLog = CommandUndoLogEntry & { id: string; commandId: string; undoToken: string }
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const priceId = '44444444-4444-4444-8444-444444444444'
const frozen = {
  omnibusReferenceNet: '100000000000000.1234567890123456789',
  omnibusReferenceGross: '123000000000000.1234567890123456789',
  omnibusPromotionAnchorAt: new Date('2026-05-01T00:00:00.000Z'),
  omnibusApplicabilityReason: 'announced_promotion',
  isPersonalized: true,
  personalizationReason: 'customer_specific_price',
}

function fixedLineIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${(count - index).toString(16).padStart(12, '0')}`)
}

function legacyPayload(source: StoredLog) {
  const payload = source.commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
  delete payload.undo.lineIds
  return payload.undo
}

function lineIdentity(line: Row): Row {
  return JSON.parse(JSON.stringify(Object.fromEntries(
    ['id', 'comment', 'description', 'metadata', 'configuration', ...Object.keys(frozen)].map((key) => [key, line[key] ?? null]),
  ))) as Row
}

function permute<T>(values: T[], seed: number): T[] {
  const result = [...values]
  let state = seed
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const target = state % (index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function entityName(entity: unknown): string {
  return (entity as { name: string }).name
}

function makeEm(lineIds: string[] = []): TestEm {
  const rows = new Map<string, Row[]>()
  const trace: string[] = []
  let inTransaction = false
  let nextLineId = 0
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    const current = row[key]
    if (value && typeof value === 'object' && '$in' in value) return true
    if (value && typeof value === 'object' && 'id' in value) return current === value || (current as Row | null)?.id === value.id
    return (current && typeof current === 'object' && 'id' in current ? current.id : current) === value
  })
  const em: TestEm = {
    rows, trace,
    fork: (): TestEm => em,
    create: (entity: unknown, data: Row) => ({
      deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data,
      id: data.id ?? (['SalesOrderLine', 'SalesQuoteLine'].includes(entityName(entity)) ? undefined : randomUUID()),
      __entity: entityName(entity),
    }),
    persist: (row: Row) => {
      const name = String(row.__entity)
      const stored = rows.get(name) ?? []
      if (!stored.includes(row)) stored.push(row)
      rows.set(name, stored)
    },
    find: async (entity: unknown, where: Row = {}) => {
      if (entity === CatalogProductPrice) return [{ id: priceId, product: productId, currencyCode: 'EUR', customerId: 'buyer-1', priceKind: { id: priceId, isPromotion: true } }]
      return (rows.get(entityName(entity)) ?? []).filter((row) => matches(row, where)).sort((left, right) => Number(left.lineNumber ?? 0) - Number(right.lineNumber ?? 0))
    },
    findOne: async (entity: unknown, where: Row): Promise<Row | null> => (rows.get(entityName(entity)) ?? []).find((row) => matches(row, where)) ?? null,
    nativeDelete: async (entity: unknown, where: Row) => { rows.set(entityName(entity), (rows.get(entityName(entity)) ?? []).filter((row) => !matches(row, where))) },
    remove: (row: Row) => { rows.set(String(row.__entity), (rows.get(String(row.__entity)) ?? []).filter((entry) => entry !== row)) },
    getReference: (_entity: unknown, id: string) => ({ id }),
    count: async () => 0,
    clear: () => undefined,
    flush: async () => {
      for (const stored of rows.values()) for (const row of stored) {
        if (row.id === undefined || row.id === null) row.id = ['SalesOrderLine', 'SalesQuoteLine'].includes(String(row.__entity))
          ? lineIds[nextLineId++] ?? randomUUID()
          : randomUUID()
      }
      trace.push('flush')
    },
    isInTransaction: () => inTransaction,
    begin: async () => { inTransaction = true; trace.push('begin') },
    commit: async () => { inTransaction = false; trace.push('commit') },
    rollback: async () => { inTransaction = false; trace.push('rollback') },
    transactional: async (work: (tx: TestEm) => Promise<void>) => { await em.begin(); try { await work(em); await em.commit() } catch (error) { await em.rollback(); throw error } },
  }
  return em
}

function harness(lineIds?: string[]) {
  const em = makeEm(lineIds)
  const logs: StoredLog[] = []
  const log = jest.fn(async (input: StoredLog) => {
    const stored = JSON.parse(JSON.stringify({ ...input, id: randomUUID() })) as StoredLog
    logs.push(stored)
    return stored
  })
  const actionLogService = {
    log,
    findByUndoToken: async (token: string) => logs.find((entry) => entry.undoToken === token),
    claimForUndo: jest.fn(async () => true), releaseUndoClaim: jest.fn(async () => true),
    markUndone: jest.fn(async () => undefined),
    claimForRedo: jest.fn(async () => true), releaseRedoClaim: jest.fn(async () => true),
  }
  const service = {
    getConfig: jest.fn(async () => omnibusConfigSchema.parse({ enabled: true })),
    resolveOmnibusBlocks: jest.fn(async (): Promise<OmnibusBlock[]> => [{
      presentedPriceKindId: priceId, lookbackDays: 30, minimizationAxis: 'gross',
      promotionAnchorAt: frozen.omnibusPromotionAnchorAt.toISOString(), windowStart: null, windowEnd: null,
      coverageStartAt: null, lowestPriceNet: frozen.omnibusReferenceNet, lowestPriceGross: frozen.omnibusReferenceGross,
      previousPriceNet: null, previousPriceGross: null, currencyCode: 'EUR', applicable: true,
      applicabilityReason: 'announced_promotion',
    }]),
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em), actionLogService: asValue(actionLogService),
    dataEngine: asValue({}), eventBus: asValue({ emitEvent: jest.fn() }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'DOC-1' }) }),
    catalogOmnibusService: asValue(service),
  })
  const ctx: CommandRuntimeContext = {
    container, auth: null, organizationScope: null, selectedOrganizationId: organizationId, organizationIds: [organizationId],
  }
  return { em, ctx, service, logs, actionLogService, bus: new CommandBus() }
}

const input = {
  tenantId, organizationId, currencyCode: 'EUR',
  lines: [
    { name: 'priced', lineNumber: 9, productId, priceId, quantity: 1, currencyCode: 'EUR', unitPriceNet: 80, unitPriceGross: 80 },
    { name: 'manual', lineNumber: 2, quantity: 1, currencyCode: 'EUR', unitPriceNet: 40, unitPriceGross: 40 },
  ],
}

describe.each(['order', 'quote'] as const)('sales %s create through command bus', (kind) => {
  const commandId = `sales.${kind}s.create`
  const lineEntity = kind === 'order' ? 'SalesOrderLine' : 'SalesQuoteLine'
  const documentEntity = kind === 'order' ? 'SalesOrder' : 'SalesQuote'
  beforeAll(async () => { await import('../documents') })
  beforeEach(() => { jest.clearAllMocks(); registerCommandInterceptors([]) })

  async function expectReplayRefused(test: ReturnType<typeof harness>, replayInput: unknown) {
    const { bus, ctx, em, logs, service, actionLogService } = test
    const writes = (['create', 'persist', 'nativeDelete', 'remove', 'flush', 'begin', 'commit', 'rollback', 'transactional'] as const)
      .map((method) => jest.spyOn(em, method))
    em.trace.length = 0
    jest.clearAllMocks()
    await expect(bus.execute(commandId, { input: replayInput, ctx, redoLogEntry: logs[0] })).rejects.toMatchObject({ status: 400 })
    for (const write of writes) expect(write).not.toHaveBeenCalled()
    expect(em.rows.get(documentEntity)).toEqual([])
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.trace).toEqual([])
    expect(service.getConfig).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect((ctx.container.resolve('eventBus') as { emitEvent: jest.Mock }).emitEvent).not.toHaveBeenCalled()
    expect(actionLogService.releaseRedoClaim).toHaveBeenCalledTimes(1)
    expect(actionLogService.log).not.toHaveBeenCalled()
    expect(logs).toHaveLength(1)
  }

  it.each(['disabled', 'history changed', 'legacy log'] as const)('restores original IDs and six frozen fields after undo and %s', async (change) => {
    const { em, ctx, bus, service, logs, actionLogService } = harness()
    const original = await bus.execute(commandId, { input, ctx })
    const source = logs[0]
    const captured = JSON.parse(JSON.stringify(em.rows.get(lineEntity))) as Row[]
    expect((source.commandPayload as { undo: { lineIds: string[] } }).undo.lineIds).toEqual(
      input.lines.map((line) => captured.find((stored) => stored.name === line.name)?.id),
    )
    expect(captured.find((line) => line.name === 'priced')).toMatchObject({ ...frozen, omnibusPromotionAnchorAt: frozen.omnibusPromotionAnchorAt.toISOString() })
    await bus.undo(source.undoToken, ctx)
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.rows.get(documentEntity)).toEqual([])
    if (change === 'disabled') service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: false }))
    else service.resolveOmnibusBlocks.mockResolvedValue([{ ...(await service.resolveOmnibusBlocks())[0], lowestPriceNet: '1', lowestPriceGross: '2' }])
    if (change === 'legacy log') {
      const payload = source.commandPayload as { undo: { lineIds?: string[]; after: unknown } }
      delete payload.undo.lineIds
    }
    service.getConfig.mockClear()
    service.resolveOmnibusBlocks.mockClear()
    const redone = await bus.execute(commandId, { input, ctx, redoLogEntry: source })
    const restored = JSON.parse(JSON.stringify(em.rows.get(lineEntity))) as Row[]
    expect(restored.find((line) => line.name === 'priced')).toMatchObject({
      ...frozen, omnibusPromotionAnchorAt: frozen.omnibusPromotionAnchorAt.toISOString(),
    })
    expect(redone.result).toEqual(original.result)
    for (const line of captured) {
      expect(restored.find((entry) => entry.id === line.id)).toMatchObject(Object.fromEntries(
        ['id', 'name', 'lineNumber', ...Object.keys(frozen)].filter((key) => key in line).map((key) => [key, line[key]]),
      ))
    }
    expect(restored.find((line) => line.name === 'manual')).toMatchObject({
      omnibusReferenceNet: null, omnibusReferenceGross: null, omnibusPromotionAnchorAt: null,
      omnibusApplicabilityReason: null, isPersonalized: null, personalizationReason: null,
    })
    expect(service.getConfig).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    expect(actionLogService.claimForRedo).toHaveBeenCalledWith(source.id)
    expect(actionLogService.markUndone).toHaveBeenCalled()
    expect(logs).toHaveLength(2)
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(2)
    expect(em.trace).not.toContain('rollback')
    await bus.undo(logs[1].undoToken, ctx)
    expect(em.rows.get(lineEntity)).toEqual([])
  })

  it('ignores public IDs and snapshot fields on initial create', async () => {
    const { bus, ctx, em } = harness()
    await bus.execute(commandId, { input: {
      ...input, id: priceId, lines: [{ ...input.lines[0], id: priceId, ...frozen, omnibusReferenceGross: '1' }],
    }, ctx })
    expect(em.rows.get(lineEntity)?.[0]).toMatchObject(frozen)
    expect(em.rows.get(lineEntity)?.[0].id).not.toBe(priceId)
    expect(em.rows.get(documentEntity)?.[0].id).not.toBe(priceId)
  })

  it('keeps empty creation snapshots empty when Omnibus becomes enabled before redo', async () => {
    const { bus, ctx, em, logs, service } = harness()
    service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: false }))
    await bus.execute(commandId, { input, ctx })
    const originalIds = em.rows.get(lineEntity)?.map((line) => line.id)
    await bus.undo(logs[0].undoToken, ctx)
    service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: true }))
    service.getConfig.mockClear()
    await bus.execute(commandId, { input, ctx, redoLogEntry: logs[0] })
    expect(em.rows.get(lineEntity)?.map((line) => line.id)).toEqual(originalIds)
    for (const line of em.rows.get(lineEntity) ?? []) {
      expect(line).toMatchObject(Object.fromEntries(Object.keys(frozen).map((key) => [key, null])))
    }
    expect(service.getConfig).not.toHaveBeenCalled()
  })

  it('replays legacy snapshots without the six optional fields', async () => {
    const { bus, ctx, em, logs, service } = harness()
    await bus.execute(commandId, { input, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    for (const line of payload.undo.after.lines) for (const key of Object.keys(frozen)) delete line[key]
    service.getConfig.mockClear()
    await bus.execute(commandId, { input, ctx, redoLogEntry: logs[0] })
    for (const line of em.rows.get(lineEntity) ?? []) {
      expect(line).toMatchObject(Object.fromEntries(Object.keys(frozen).map((key) => [key, null])))
    }
    expect(service.getConfig).not.toHaveBeenCalled()
  })

  it('uses private input-order IDs when snapshot display ordering has duplicate line numbers', async () => {
    const { bus, ctx, em, logs } = harness()
    const duplicateNumbers = { ...input, lines: input.lines.map((line) => ({ ...line, lineNumber: 2 })) }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    const original = (em.rows.get(lineEntity) ?? []).map((line) => ({ id: line.id, name: line.name }))
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { after: { lines: Row[] } } }
    payload.undo.after.lines.reverse()
    await bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })
    expect((em.rows.get(lineEntity) ?? []).map((line) => ({ id: line.id, name: line.name }))).toEqual(original)
  })

  it('matches legacy duplicate numbers by content and preserves each ID and all six snapshot fields', async () => {
    const { bus, ctx, em, logs } = harness()
    const duplicateNumbers = { ...input, lines: input.lines.map((line) => ({ ...line, lineNumber: 2 })) }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    const identity = (line: Row) => Object.fromEntries(
      ['id', 'name', ...Object.keys(frozen)].map((key) => [key, line[key] ?? null]),
    )
    const original = JSON.parse(JSON.stringify((em.rows.get(lineEntity) ?? []).map(identity))) as Row[]
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    payload.undo.after.lines.reverse()
    await bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })
    expect(JSON.parse(JSON.stringify((em.rows.get(lineEntity) ?? []).map(identity)))).toEqual(original)
  })

  it.each(['absent', 'null', 'mixed', 'frozen'] as const)('replays interchangeable legacy tied lines with %s frozen fields', async (mode) => {
    const { bus, ctx, em, logs, service } = harness()
    if (mode !== 'frozen') service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: false }))
    const [block] = await service.resolveOmnibusBlocks()
    service.resolveOmnibusBlocks.mockResolvedValue([block, block])
    const duplicateNumbers = { ...input, lines: [input.lines[0], input.lines[0]].map((line) => ({ ...line, lineNumber: 2 })) }
    const original = await bus.execute(commandId, { input: duplicateNumbers, ctx })
    const originalIds = (em.rows.get(lineEntity) ?? []).map((line) => line.id).sort()
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    for (const [index, line] of payload.undo.after.lines.entries()) {
      for (const key of Object.keys(frozen)) {
        if (mode === 'absent' || (mode === 'mixed' && index === 0)) delete line[key]
        else if (mode !== 'frozen') line[key] = null
      }
    }
    payload.undo.after.lines.reverse()
    service.getConfig.mockClear()
    service.resolveOmnibusBlocks.mockClear()
    const redone = await bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })
    expect(redone.result).toEqual(original.result)
    expect((em.rows.get(lineEntity) ?? []).map((line) => line.id)).toEqual(originalIds)
    const expected = mode === 'frozen' ? frozen : Object.fromEntries(Object.keys(frozen).map((key) => [key, null]))
    for (const line of em.rows.get(lineEntity) ?? []) expect(line).toMatchObject(expected)
    expect(service.getConfig).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    await bus.undo(logs[1].undoToken, ctx)
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.rows.get(documentEntity)).toEqual([])
  })

  it('reserves the specific legacy comment before assigning the omitted-comment input', async () => {
    const lineIds = ['ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-4000-8000-000000000001']
    const { bus, ctx, em, logs, service } = harness(lineIds)
    service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: false }))
    const duplicateNumbers = {
      ...input,
      lines: [
        { ...input.lines[1], lineNumber: 2 },
        { ...input.lines[1], lineNumber: 2, comment: 'Gift wrap' },
      ],
    }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    const identity = (line: Row) => Object.fromEntries(
      ['id', 'comment', ...Object.keys(frozen)].map((key) => [key, line[key] ?? null]),
    )
    const original = (em.rows.get(lineEntity) ?? []).map(identity)
    expect(original.map((line) => line.id)).toEqual(lineIds)
    expect(original.map((line) => line.comment)).toEqual([null, 'Gift wrap'])
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    payload.undo.after.lines.reverse()
    await bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })
    expect((em.rows.get(lineEntity) ?? []).map(identity)).toEqual(original)
    await bus.undo(logs[1].undoToken, ctx)
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.rows.get(documentEntity)).toEqual([])
  })

  it.each([1, 7, 42, 9372, 20261120, 0x12345678])('matches overlapping legacy constraints in full under input/log permutation seed %s', async (seed) => {
    const test = harness(fixedLineIds(9))
    const { bus, ctx, em, logs, service } = test
    const base = input.lines[1]
    const lines = [
      { ...base, lineNumber: 2 },
      { ...base, lineNumber: 2, comment: 'Gift wrap' },
      { ...base, lineNumber: 2, comment: 'Gift wrap', description: 'Fragile' },
      { ...base, lineNumber: 7, comment: 'Gift wrap' },
      { ...base, lineNumber: 7, description: 'Fragile' },
      { ...base, lineNumber: 7, comment: 'Gift wrap', description: 'Fragile' },
      { ...base, lineNumber: 11 },
      { ...base, lineNumber: 11, metadata: { nested: { choices: [false, null, 'gift'] } } },
      { ...base, lineNumber: 11, metadata: { nested: { choices: [false, null, 'gift'] } }, configuration: { paper: ['blue', 'white'] } },
    ]
    const replayInput = { ...input, lines: permute(lines, seed) }
    await bus.execute(commandId, { input: replayInput, ctx })
    const originalIds = (em.rows.get(lineEntity) ?? []).map((line) => line.id)
    await bus.undo(logs[0].undoToken, ctx)
    const legacy = legacyPayload(logs[0])
    for (const [index, line] of legacy.after.lines.entries()) Object.assign(line, {
      ...frozen,
      omnibusReferenceNet: `80.00000000000000000${index + 1}`,
      omnibusReferenceGross: `90.00000000000000000${index + 1}`,
      omnibusPromotionAnchorAt: new Date(frozen.omnibusPromotionAnchorAt.getTime() + index).toISOString(),
      omnibusApplicabilityReason: `reason-${index}`,
      isPersonalized: index % 2 === 0,
      personalizationReason: index === 0 ? '' : `personal-${index}`,
    })
    const expected = legacy.after.lines.map(lineIdentity).sort((left, right) => String(left.id).localeCompare(String(right.id)))
    legacy.after.lines = permute(legacy.after.lines.reverse(), seed ^ 0xabcdef)
    service.getConfig.mockClear()
    service.resolveOmnibusBlocks.mockClear()
    await bus.execute(commandId, { input: replayInput, ctx, redoLogEntry: logs[0] })
    const restored = (em.rows.get(lineEntity) ?? []).map(lineIdentity).sort((left, right) => String(left.id).localeCompare(String(right.id)))
    expect(restored).toEqual(expected)
    expect((logs[1].commandPayload as { undo: { lineIds: string[] } }).undo.lineIds).toEqual(originalIds)
    expect(service.getConfig).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    await bus.undo(logs[1].undoToken, ctx)
    await bus.execute(commandId, { input: replayInput, ctx, redoLogEntry: logs[1] })
    expect((em.rows.get(lineEntity) ?? []).map(lineIdentity).sort((left, right) => String(left.id).localeCompare(String(right.id)))).toEqual(expected)
    await bus.undo(logs[2].undoToken, ctx)
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.rows.get(documentEntity)).toEqual([])
  })

  it.each(['identical', 'reserved', 'ambiguous'] as const)('bounds a 150-line legacy %s group', async (mode) => {
    const test = harness(fixedLineIds(150))
    const { bus, ctx, em, logs, service } = test
    service.getConfig.mockResolvedValue(omnibusConfigSchema.parse({ enabled: false }))
    const replayInput = {
      ...input,
      lines: Array.from({ length: 150 }, (_, index) => ({
        ...input.lines[1], lineNumber: 2,
        ...(mode === 'reserved' && index >= 75 ? { comment: `Reserved ${index}` } : {}),
      })),
    }
    await bus.execute(commandId, { input: replayInput, ctx })
    const original = (em.rows.get(lineEntity) ?? []).map(lineIdentity)
    await bus.undo(logs[0].undoToken, ctx)
    const legacy = legacyPayload(logs[0])
    legacy.after.lines = permute(legacy.after.lines, 9372)
    if (mode === 'ambiguous') legacy.after.lines[149].isPersonalized = false
    const started = Date.now()
    if (mode === 'ambiguous') {
      await expectReplayRefused(test, replayInput)
    } else {
      await bus.execute(commandId, { input: replayInput, ctx, redoLogEntry: logs[0] })
      const restored = (em.rows.get(lineEntity) ?? []).map(lineIdentity)
      const interchangeable = original.filter((line) => line.comment === null).sort((left, right) => String(left.id).localeCompare(String(right.id)))
      expect(restored.filter((line) => line.comment === null)).toEqual(interchangeable)
      for (const line of original.filter((entry) => entry.comment !== null)) expect(restored.find((entry) => entry.id === line.id)).toEqual(line)
      expect(restored).toHaveLength(150)
      await bus.undo(logs[1].undoToken, ctx)
      expect(em.rows.get(lineEntity)).toEqual([])
    }
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it.each(['missing row ID', 'duplicate row ID', 'corrupt row ID', 'duplicate private ID', 'missing private ID', 'unknown private ID', 'corrupt private ID', 'null private IDs'] as const)('refuses %s before any replay writes', async (mode) => {
    const test = harness(fixedLineIds(2))
    const { bus, ctx, logs } = test
    await bus.execute(commandId, { input, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: unknown; after: { lines: Row[] } } }
    if (mode.endsWith('row ID')) {
      delete payload.undo.lineIds
      if (mode === 'missing row ID') delete payload.undo.after.lines[0].id
      if (mode === 'duplicate row ID') payload.undo.after.lines[0].id = payload.undo.after.lines[1].id
      if (mode === 'corrupt row ID') payload.undo.after.lines[0].id = 'corrupt'
    } else {
      const ids = payload.undo.lineIds as string[]
      if (mode === 'duplicate private ID') ids[1] = ids[0]
      if (mode === 'missing private ID') ids.pop()
      if (mode === 'unknown private ID') ids[1] = randomUUID()
      if (mode === 'corrupt private ID') ids[1] = 'corrupt'
      if (mode === 'null private IDs') payload.undo.lineIds = null
    }
    await expectReplayRefused(test, input)
  })

  it.each([
    { field: 'kind', value: 'product', corrupt: 'service' },
    { field: 'statusEntryId', value: organizationId, corrupt: tenantId },
    { field: 'productId', value: productId, corrupt: tenantId },
    { field: 'productVariantId', value: priceId, corrupt: tenantId },
    { field: 'name', value: 'manual', corrupt: 'different' },
    { field: 'description', value: 'Fragile', corrupt: null },
    { field: 'comment', value: 'Gift wrap', corrupt: null },
    { field: 'quantityUnit', value: 'ea', corrupt: 'kg' },
    { field: 'currencyCode', value: 'EUR', corrupt: 'PLN' },
    { field: 'promotionCode', value: 'GIFT', corrupt: null },
    { field: 'customFieldSetId', value: priceId, corrupt: tenantId },
    { field: 'configuration', value: { nested: [false, null, 'gift'] }, corrupt: { nested: [false, null, 'other'] } },
    { field: 'promotionSnapshot', value: { nested: [false, null, 'gift'] }, corrupt: { nested: [false, null, 'other'] } },
    { field: 'metadata', value: { nested: [false, null, 'gift'] }, corrupt: { nested: [false, null, 'other'] } },
    { field: 'customFields', value: { nested: [false, null, 'gift'] }, corrupt: { nested: [false, null, 'other'] } },
    ...['unitPriceNet', 'unitPriceGross'].map((field) => ({
      field, value: '1.000000000000000001', corrupt: '1.000000000000000002',
    })),
    ...['quantity', 'discountPercent', 'taxRate'].map((field) => ({ field, value: '1.25', corrupt: '1.5' })),
  ])('enforces $field against every original tied row, including the last remaining row', async ({ field, value, corrupt }) => {
    const test = harness(fixedLineIds(2))
    const { bus, ctx, logs } = test
    const originalInput = { ...input, lines: [input.lines[1], input.lines[1]].map((line) => ({ ...line, lineNumber: 2 })) }
    await bus.execute(commandId, { input: originalInput, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const legacy = legacyPayload(logs[0])
    for (const line of legacy.after.lines) line[field] = value
    legacy.after.lines[1][field] = corrupt
    const replayInput = { ...originalInput, lines: originalInput.lines.map((line) => ({ ...line, [field]: value })) }
    await expectReplayRefused(test, replayInput)
  })

  it('checks structured and exact constraints even when a primitive field leaves one candidate', async () => {
    for (const field of ['metadata', 'unitPriceNet']) {
      const test = harness(fixedLineIds(2))
      const { bus, ctx, logs } = test
      const replayInput = {
        ...input,
        lines: [
          { ...input.lines[1], lineNumber: 2, comment: 'Gift wrap', metadata: { choice: [false, null] }, unitPriceNet: '40.000000000000000001' },
          { ...input.lines[1], lineNumber: 2, comment: 'Fragile', metadata: { choice: [false, null] }, unitPriceNet: '40.000000000000000001' },
        ],
      }
      await bus.execute(commandId, { input: replayInput, ctx })
      await bus.undo(logs[0].undoToken, ctx)
      const legacy = legacyPayload(logs[0])
      legacy.after.lines[0][field] = field === 'metadata' ? { choice: [null, false] } : '40.000000000000000002'
      await expectReplayRefused(test, replayInput)
    }
  })

  it.each(['equal dates', ...Object.keys(frozen)])('evaluates full alternating cycles with %s frozen payloads', async (field) => {
    const test = harness(fixedLineIds(3))
    const { bus, ctx, em, logs } = test
    const replayInput = {
      ...input,
      lines: [
        { ...input.lines[1], lineNumber: 2, comment: 'Gift wrap' },
        { ...input.lines[1], lineNumber: 2, description: 'Fragile' },
        { ...input.lines[1], lineNumber: 2, metadata: { gift: true } },
      ],
    }
    await bus.execute(commandId, { input: replayInput, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const legacy = legacyPayload(logs[0])
    legacy.after.lines[0].metadata = { gift: true }
    legacy.after.lines[1].comment = 'Gift wrap'
    legacy.after.lines[2].description = 'Fragile'
    for (const line of legacy.after.lines) Object.assign(line, frozen, { omnibusPromotionAnchorAt: frozen.omnibusPromotionAnchorAt.toISOString() })
    if (field === 'equal dates') {
      legacy.after.lines[1].omnibusPromotionAnchorAt = '2026-04-30T20:00:00.000-04:00'
      await bus.execute(commandId, { input: replayInput, ctx, redoLogEntry: logs[0] })
      for (const line of em.rows.get(lineEntity) ?? []) expect(line).toMatchObject(frozen)
      expect((em.rows.get(lineEntity) ?? []).map((line) => line.id).sort()).toEqual(fixedLineIds(3).sort())
      await bus.undo(logs[1].undoToken, ctx)
    } else {
      legacy.after.lines[2][field] = {
        omnibusReferenceNet: '100000000000000.1234567890123456788',
        omnibusReferenceGross: '123000000000000.1234567890123456788',
        omnibusPromotionAnchorAt: '2026-05-01T00:00:00.001Z',
        omnibusApplicabilityReason: '', isPersonalized: false, personalizationReason: '',
      }[field]
      await expectReplayRefused(test, replayInput)
    }
  })

  it('preserves the unique-position legacy bridge despite historical content normalization', async () => {
    const { bus, ctx, em, logs } = harness(fixedLineIds(2))
    await bus.execute(commandId, { input, ctx })
    const ids = (em.rows.get(lineEntity) ?? []).map((line) => line.id)
    await bus.undo(logs[0].undoToken, ctx)
    const legacy = legacyPayload(logs[0])
    for (const line of legacy.after.lines) Object.assign(line, { name: 'Historical name', metadata: { old: true }, unitPriceNet: '999' })
    await bus.execute(commandId, { input, ctx, redoLogEntry: logs[0] })
    expect((em.rows.get(lineEntity) ?? []).map((line) => line.id)).toEqual(ids)
    expect((em.rows.get(lineEntity) ?? []).map((line) => line.name)).toEqual(input.lines.map((line) => line.name))
    await bus.undo(logs[1].undoToken, ctx)
  })

  it.each(Object.keys(frozen) as Array<keyof typeof frozen>)('refuses an ambiguous legacy duplicate with differing %s before creating a document or line', async (field) => {
    const { bus, ctx, em, logs, service, actionLogService } = harness()
    const [block] = await service.resolveOmnibusBlocks()
    service.resolveOmnibusBlocks.mockResolvedValue([block, block])
    const duplicateNumbers = { ...input, lines: [input.lines[0], input.lines[0]].map((line) => ({ ...line, lineNumber: 2 })) }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    payload.undo.after.lines[0][field] = {
      omnibusReferenceNet: '1', omnibusReferenceGross: '2', omnibusPromotionAnchorAt: '2026-06-01T00:00:00.000Z',
      omnibusApplicabilityReason: 'different', isPersonalized: false, personalizationReason: 'different',
    }[field]
    payload.undo.after.lines.reverse()
    em.trace.length = 0
    service.getConfig.mockClear()
    jest.mocked(emitCrudSideEffects).mockClear()
    await expect(bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })).rejects.toMatchObject({ status: 400 })
    expect(em.rows.get(documentEntity)).toEqual([])
    expect(em.rows.get(lineEntity)).toEqual([])
    expect(em.trace).toEqual([])
    expect(service.getConfig).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(actionLogService.releaseRedoClaim).toHaveBeenCalled()
    expect(logs).toHaveLength(1)
  })

  it('distinguishes legacy tied lines by exact amounts beyond Number precision', async () => {
    const { bus, ctx, em, logs } = harness()
    const exactPrices = ['80.000000000000000001', '80.000000000000000002']
    const duplicateNumbers = {
      ...input,
      lines: exactPrices.map((unitPriceNet) => ({ ...input.lines[0], lineNumber: 2, unitPriceNet })),
    }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    const original = (em.rows.get(lineEntity) ?? []).map((line) => ({ id: line.id, unitPriceNet: line.unitPriceNet }))
    expect(original.map((line) => line.unitPriceNet)).toEqual(exactPrices)
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
    payload.undo.after.lines.reverse()
    await bus.execute(commandId, { input: duplicateNumbers, ctx, redoLogEntry: logs[0] })
    expect((em.rows.get(lineEntity) ?? []).map((line) => ({ id: line.id, unitPriceNet: line.unitPriceNet }))).toEqual(original)
  })

  it('retains the command bus replay authorization guard', async () => {
    const { bus, ctx, em, logs } = harness()
    await bus.execute(commandId, { input, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    ctx.replayTransactionGuard = async () => { throw new Error('[internal] replay denied') }
    await expect(bus.execute(commandId, { input, ctx, redoLogEntry: logs[0] })).rejects.toThrow('replay denied')
    expect(em.rows.get(documentEntity)).toEqual([])
  })
})
