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

function entityName(entity: unknown): string {
  return (entity as { name: string }).name
}

function makeEm(): TestEm {
  const rows = new Map<string, Row[]>()
  const trace: string[] = []
  let inTransaction = false
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
      deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data, id: data.id ?? randomUUID(),
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
    flush: async () => { trace.push('flush') },
    isInTransaction: () => inTransaction,
    begin: async () => { inTransaction = true; trace.push('begin') },
    commit: async () => { inTransaction = false; trace.push('commit') },
    rollback: async () => { inTransaction = false; trace.push('rollback') },
    transactional: async (work: (tx: TestEm) => Promise<void>) => { await em.begin(); try { await work(em); await em.commit() } catch (error) { await em.rollback(); throw error } },
  }
  return em
}

function harness() {
  const em = makeEm()
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

  it.each(['disabled', 'history changed', 'legacy log'] as const)('restores original IDs and six frozen fields after undo and %s', async (change) => {
    const { em, ctx, bus, service, logs, actionLogService } = harness()
    const original = await bus.execute(commandId, { input, ctx })
    const source = logs[0]
    const captured = JSON.parse(JSON.stringify(em.rows.get(lineEntity))) as Row[]
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

  it('refuses an ambiguous legacy duplicate before creating a document or line', async () => {
    const { bus, ctx, em, logs, service, actionLogService } = harness()
    const duplicateNumbers = { ...input, lines: [input.lines[0], input.lines[0]].map((line) => ({ ...line, lineNumber: 2 })) }
    await bus.execute(commandId, { input: duplicateNumbers, ctx })
    await bus.undo(logs[0].undoToken, ctx)
    const payload = logs[0].commandPayload as { undo: { lineIds?: string[]; after: { lines: Row[] } } }
    delete payload.undo.lineIds
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
