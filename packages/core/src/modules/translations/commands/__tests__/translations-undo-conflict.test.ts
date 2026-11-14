import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitTranslationsEvent: jest.fn().mockResolvedValue(undefined),
}))

type Translations = Record<string, Record<string, string | null>>
type Row = {
  id: string
  entity_type: string
  entity_id: string
  organization_id: string | null
  tenant_id: string
  translations: Translations
  created_at: string
  updated_at: string
}
type Where = { column: string; value: unknown }

const KEY = {
  entityType: 'catalog:catalog_product',
  entityId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

function resolveValue(value: unknown): unknown {
  const node = (value as { toOperationNode?: () => { parameters?: Array<{ value?: unknown }> } } | null)?.toOperationNode?.()
  if (!node) return value
  const parameter = node.parameters?.[0]?.value
  if (typeof parameter === 'string') return JSON.parse(parameter)
  return new Date().toISOString()
}

class FakeDb {
  rows: Row[] = []
  nextId = 1
  lockedReads = 0
  failNextInsertWithUniqueViolation = false

  selectFrom() {
    return this.query('select')
  }

  updateTable() {
    return this.query('update')
  }

  insertInto() {
    return this.query('insert')
  }

  deleteFrom() {
    return this.query('delete')
  }

  transaction() {
    return { execute: async <T>(callback: (trx: FakeDb) => Promise<T>) => callback(this) }
  }

  private query(kind: 'select' | 'update' | 'insert' | 'delete') {
    const db = this
    const wheres: Where[] = []
    let patch: Record<string, unknown> = {}
    let columns: string[] | null = null
    const matches = (row: Row) => wheres.every((where) => (row as Record<string, unknown>)[where.column] === where.value)
    const builder = {
      selectAll() { return builder },
      select(selected: string[]) { columns = selected; return builder },
      forUpdate() { db.lockedReads += 1; return builder },
      where(...args: unknown[]) {
        if (args.length === 3) wheres.push({ column: String(args[0]), value: args[2] })
        return builder
      },
      set(values: Record<string, unknown>) { patch = values; return builder },
      values(values: Record<string, unknown>) { patch = values; return builder },
      async executeTakeFirst() {
        if (kind === 'select') {
          const row = db.rows.find(matches)
          if (!row) return undefined
          if (!columns) return { ...row }
          return Object.fromEntries(columns.map((column) => [column, (row as Record<string, unknown>)[column]]))
        }
        if (kind === 'update') {
          const targets = db.rows.filter(matches)
          for (const row of targets) {
            for (const [column, value] of Object.entries(patch)) {
              (row as Record<string, unknown>)[column] = resolveValue(value)
            }
          }
          return { numUpdatedRows: BigInt(targets.length) }
        }
        if (kind === 'delete') {
          const before = db.rows.length
          db.rows = db.rows.filter((row) => !matches(row))
          return { numDeletedRows: BigInt(before - db.rows.length) }
        }
        if (db.failNextInsertWithUniqueViolation) {
          db.failNextInsertWithUniqueViolation = false
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'entity_translations_scope_uq',
          })
        }
        const inserted: Record<string, unknown> = { id: `row-${db.nextId++}` }
        for (const [column, value] of Object.entries(patch)) inserted[column] = resolveValue(value)
        db.rows.push(inserted as Row)
        return undefined
      },
      async execute() {
        return builder.executeTakeFirst()
      },
    }
    return builder
  }
}

type SaveHandler = CommandHandler<typeof KEY & { translations: Translations }, { rowId: string }>
type DeleteHandler = CommandHandler<typeof KEY, { deleted: boolean }>
type LogEntry = Record<string, unknown>

function loadHandlers(): { save: SaveHandler; remove: DeleteHandler } {
  let save: SaveHandler | undefined
  let remove: DeleteHandler | undefined
  jest.isolateModules(() => {
    require('../translations')
    save = registerCommand.mock.calls.find(([handler]) => handler.id === 'translations.translation.save')?.[0]
    remove = registerCommand.mock.calls.find(([handler]) => handler.id === 'translations.translation.delete')?.[0]
  })
  if (!save || !remove) throw new Error('translation commands were not registered')
  return { save, remove }
}

function makeCtx(db: FakeDb): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { getKysely: () => db }
        throw new Error(`unexpected resolve(${name})`)
      },
    },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: KEY.organizationId,
    organizationIds: [KEY.organizationId],
  } as unknown as CommandRuntimeContext
}

async function runSave(handler: SaveHandler, ctx: CommandRuntimeContext, translations: Translations): Promise<LogEntry> {
  const input = { ...KEY, translations }
  const prepared = await handler.prepare!(input, ctx)
  const result = await handler.execute(input, ctx)
  const after = await handler.captureAfter!(input, result, ctx)
  const log = await handler.buildLog!({ input, result, ctx, snapshots: { before: prepared?.before, after } } as never)
  return JSON.parse(JSON.stringify(log)) as LogEntry
}

async function runSaveWithLaterSaveBeforeCapture(
  handler: SaveHandler,
  ctx: CommandRuntimeContext,
  translations: Translations,
  laterTranslations: Translations,
): Promise<LogEntry> {
  const input = { ...KEY, translations }
  const prepared = await handler.prepare!(input, ctx)
  const result = await handler.execute(input, ctx)
  await runSave(handler, ctx, laterTranslations)
  const after = await handler.captureAfter!(input, result, ctx)
  const log = await handler.buildLog!({ input, result, ctx, snapshots: { before: prepared?.before, after } } as never)
  return JSON.parse(JSON.stringify(log)) as LogEntry
}

async function runDelete(handler: DeleteHandler, ctx: CommandRuntimeContext): Promise<LogEntry> {
  const prepared = await handler.prepare!(KEY, ctx)
  const result = await handler.execute(KEY, ctx)
  const log = await handler.buildLog!({ input: KEY, result, ctx, snapshots: { before: prepared?.before } } as never)
  return JSON.parse(JSON.stringify(log)) as LogEntry
}

function undo(handler: SaveHandler | DeleteHandler, ctx: CommandRuntimeContext, logEntry: LogEntry) {
  return handler.undo!({ input: {} as never, ctx, logEntry: logEntry as never })
}

function insertRow(db: FakeDb, translations: Translations): void {
  db.rows.push({
    id: `row-${db.nextId++}`,
    entity_type: KEY.entityType,
    entity_id: KEY.entityId,
    organization_id: KEY.organizationId,
    tenant_id: KEY.tenantId,
    translations,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
}

const conflict = expect.objectContaining({
  status: 409,
  body: expect.objectContaining({ code: 'translations.errors.undoConflict' }),
})

describe('translations undo refuses to overwrite later changes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('restores the previous translations when nothing changed after the save', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const updateLog = await runSave(save, ctx, { en: { name: 'Sneaker' } })

    await undo(save, ctx, updateLog)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual({ en: { name: 'Shoe' } })
    expect(db.lockedReads).toBeGreaterThan(0)
  })

  it('refuses to undo an update after another operator saved the record', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const updateLog = await runSave(save, ctx, { en: { name: 'Sneaker' } })
    await runSave(save, ctx, { en: { name: 'Sneaker' }, fr: { name: 'Baskets' } })

    await expect(undo(save, ctx, updateLog)).rejects.toEqual(conflict)

    expect(db.rows[0].translations).toEqual({ en: { name: 'Sneaker' }, fr: { name: 'Baskets' } })
  })

  it('refuses to undo an update when another save committed before its after snapshot was taken', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const newer = { en: { name: 'Sneaker' }, fr: { name: 'Baskets' } }
    const updateLog = await runSaveWithLaterSaveBeforeCapture(save, ctx, { en: { name: 'Sneaker' } }, newer)

    await expect(undo(save, ctx, updateLog)).rejects.toEqual(conflict)

    expect(db.rows[0].translations).toEqual(newer)
  })

  it('refuses to undo a create when another save committed before its after snapshot was taken', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    const newer = { en: { name: 'Shoe' }, de: { name: 'Schuh' } }
    const createLog = await runSaveWithLaterSaveBeforeCapture(save, ctx, { en: { name: 'Shoe' } }, newer)

    await expect(undo(save, ctx, createLog)).rejects.toEqual(conflict)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual(newer)
  })

  it('refuses to undo an update after another operator deleted the record', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const updateLog = await runSave(save, ctx, { en: { name: 'Sneaker' } })
    await runDelete(remove, ctx)

    await expect(undo(save, ctx, updateLog)).rejects.toEqual(conflict)

    expect(db.rows).toHaveLength(0)
  })

  it('refuses to undo a create after another operator saved the record', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    const createLog = await runSave(save, ctx, { en: { name: 'Shoe' } })
    await runSave(save, ctx, { en: { name: 'Shoe' }, de: { name: 'Schuh' } })

    await expect(undo(save, ctx, createLog)).rejects.toEqual(conflict)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual({ en: { name: 'Shoe' }, de: { name: 'Schuh' } })
  })

  it('removes the record when undoing an unchanged create', async () => {
    const { save } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    const createLog = await runSave(save, ctx, { en: { name: 'Shoe' } })

    await undo(save, ctx, createLog)

    expect(db.rows).toHaveLength(0)
  })

  it('refuses to undo a delete when different translations exist again', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const deleteLog = await runDelete(remove, ctx)
    insertRow(db, { de: { name: 'Schuh' } })

    await expect(undo(remove, ctx, deleteLog)).rejects.toEqual(conflict)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual({ de: { name: 'Schuh' } })
  })

  it('accepts a delete undo when the same translations already exist again', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' }, de: { name: 'Schuh' } })
    const deleteLog = await runDelete(remove, ctx)
    insertRow(db, { de: { name: 'Schuh' }, en: { name: 'Shoe' } })

    await expect(undo(remove, ctx, deleteLog)).resolves.toBeUndefined()

    expect(db.rows).toHaveLength(1)
  })

  it('restores a deleted record when nothing replaced it', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const deleteLog = await runDelete(remove, ctx)

    await undo(remove, ctx, deleteLog)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual({ en: { name: 'Shoe' } })
  })

  it('keeps a single operator undo chain working through a delete undo', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const updateLog = await runSave(save, ctx, { en: { name: 'Sneaker' } })
    const deleteLog = await runDelete(remove, ctx)

    await undo(remove, ctx, deleteLog)
    await undo(save, ctx, updateLog)

    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].translations).toEqual({ en: { name: 'Shoe' } })
  })

  it('keeps a create undo working after its delete was undone', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    const createLog = await runSave(save, ctx, { en: { name: 'Shoe' } })
    const createdId = db.rows[0].id
    const deleteLog = await runDelete(remove, ctx)

    await undo(remove, ctx, deleteLog)
    expect(db.rows.map((row) => row.id)).toEqual([createdId])
    await undo(save, ctx, createLog)

    expect(db.rows).toHaveLength(0)
  })

  it('maps a concurrent re-create during delete undo to a conflict', async () => {
    const { save, remove } = loadHandlers()
    const db = new FakeDb()
    const ctx = makeCtx(db)
    await runSave(save, ctx, { en: { name: 'Shoe' } })
    const deleteLog = await runDelete(remove, ctx)
    db.failNextInsertWithUniqueViolation = true

    await expect(undo(remove, ctx, deleteLog)).rejects.toEqual(conflict)
  })
})
