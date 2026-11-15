import '@open-mercato/core/modules/eudr/commands/statements'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `translated:${key}:${fallback ?? ''}`,
  }),
}))

type StatementRecord = {
  id: string
  organizationId: string
  tenantId: string
  status: string
  referenceNumber: string | null
  referenceIssuedAt: Date | null
  deletedAt: Date | null
  updatedAt: Date
}

type StatementSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string
  commodity: string
  referenceNumber: string | null
  verificationNumber: string | null
  status: string
  activityType: string | null
  actorRole: string | null
  referencedStatements: Array<{ referenceNumber: string; verificationNumber?: string | null }>
  quantityKg: string | null
  supplementaryUnit: string | null
  supplementaryQuantity: string | null
  orderId: string | null
  submittedAt: string | null
  referenceIssuedAt: string | null
  orderSnapshot: { orderNumber?: string | null } | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type Harness = {
  ctx: CommandRuntimeContext
  em: {
    fork: jest.Mock
    findOne: jest.Mock
    flush: jest.Mock
    getKysely: jest.Mock
  }
  dataEngine: {
    setCustomFields: jest.Mock
    markOrmEntityChange: jest.Mock
  }
  downstreamQuery: jest.Mock
}

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const STATEMENT_ID = 'stmt-1'
const HOUR_MS = 60 * 60 * 1000

function getCommand(id: string): CommandHandler<unknown, unknown> {
  const handler = commandRegistry.get(id) as CommandHandler<unknown, unknown> | null
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler
}

function buildRecord(overrides: Partial<StatementRecord> = {}): StatementRecord {
  return {
    id: STATEMENT_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    status: 'draft',
    referenceNumber: null,
    referenceIssuedAt: null,
    deletedAt: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  }
}

function buildHarness(record: StatementRecord, downstreamTotal = 0): Harness {
  const downstreamQuery = jest.fn(async () => ({ total: downstreamTotal }))
  const queryBuilder: Record<string, unknown> = {}
  for (const method of ['selectFrom', 'select', 'where']) {
    queryBuilder[method] = jest.fn(() => queryBuilder)
  }
  queryBuilder.executeTakeFirst = downstreamQuery
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(async () => record),
    flush: jest.fn(async () => undefined),
    getKysely: jest.fn(() => queryBuilder),
  }
  em.fork.mockReturnValue(em)
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }
  const ctx = {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  } as unknown as CommandRuntimeContext
  return { ctx, em, dataEngine, downstreamQuery }
}

function buildCreateLogEntry() {
  return {
    commandPayload: {
      undo: {
        after: {
          id: STATEMENT_ID,
          organizationId: ORGANIZATION_ID,
          tenantId: TENANT_ID,
          custom: null,
        },
      },
    },
  }
}

async function undoCreate(harness: Harness): Promise<unknown> {
  const command = getCommand('eudr.statements.create')
  try {
    await command.undo!({ logEntry: buildCreateLogEntry(), ctx: harness.ctx } as never)
    return null
  } catch (error) {
    return error
  }
}

function expectUndoRefusal(error: unknown, code: string, fallback: string) {
  expect(isCrudHttpError(error)).toBe(true)
  if (!isCrudHttpError(error)) return
  expect(error.status).toBe(409)
  expect(error.body).toEqual({ error: `translated:${code}:${fallback}`, code })
}

function expectNothingDeleted(record: StatementRecord, harness: Harness) {
  expect(record.deletedAt).toBeNull()
  expect(harness.em.flush).not.toHaveBeenCalled()
  expect(harness.dataEngine.setCustomFields).not.toHaveBeenCalled()
  expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
}

describe('eudr.statements.create undo', () => {
  it('refuses to delete a statement that was archived after it was created', async () => {
    const record = buildRecord({ status: 'archived' })
    const harness = buildHarness(record)

    const error = await undoCreate(harness)

    expectUndoRefusal(error, 'eudr.errors.archivedReadOnly', 'Archived statements are read-only.')
    expectNothingDeleted(record, harness)
  })

  it('refuses to delete an available statement that a downstream statement references', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'dds-1',
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const harness = buildHarness(record, 1)

    const error = await undoCreate(harness)

    expectUndoRefusal(
      error,
      'eudr.errors.referencedDownstream',
      'This statement is referenced by a downstream statement.',
    )
    expect(harness.downstreamQuery).toHaveBeenCalledTimes(1)
    expectNothingDeleted(record, harness)
  })

  it('refuses to delete an available statement whose amendment window has elapsed', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-2',
      referenceIssuedAt: new Date(Date.now() - 73 * HOUR_MS),
    })
    const harness = buildHarness(record)

    const error = await undoCreate(harness)

    expectUndoRefusal(error, 'eudr.errors.amendWindowElapsed', 'The amendment window has elapsed.')
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expectNothingDeleted(record, harness)
  })

  it('still deletes a draft statement', async () => {
    const record = buildRecord({ status: 'draft' })
    const harness = buildHarness(record)

    const error = await undoCreate(harness)

    expect(error).toBeNull()
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted', entity: record }),
    )
  })

  it('still deletes an available statement inside its amendment window with no downstream references', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-3',
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const harness = buildHarness(record, 0)

    const error = await undoCreate(harness)

    expect(error).toBeNull()
    expect(harness.downstreamQuery).toHaveBeenCalledTimes(1)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
  })

  it.each(['draft', 'submitted', 'withdrawn'])(
    'still deletes a referenced %s statement without checking downstream references',
    async (status) => {
      const record = buildRecord({
        status,
        referenceNumber: 'DDS-5',
        referenceIssuedAt: new Date(Date.now() - 73 * HOUR_MS),
      })
      const harness = buildHarness(record, 1)

      const error = await undoCreate(harness)

      expect(error).toBeNull()
      expect(harness.downstreamQuery).not.toHaveBeenCalled()
      expect(record.deletedAt).toBeInstanceOf(Date)
      expect(harness.em.flush).toHaveBeenCalledTimes(1)
    },
  )

  it('still deletes a statement with an unrecognised status', async () => {
    const record = buildRecord({ status: 'legacy' })
    const harness = buildHarness(record, 1)

    const error = await undoCreate(harness)

    expect(error).toBeNull()
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expect(record.deletedAt).toBeInstanceOf(Date)
  })

  it('still deletes an available statement without a reference number without querying downstream', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: null,
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const harness = buildHarness(record, 1)

    const error = await undoCreate(harness)

    expect(error).toBeNull()
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expect(record.deletedAt).toBeInstanceOf(Date)
  })
})

function buildSnapshot(overrides: Partial<StatementSnapshot> = {}): StatementSnapshot {
  return {
    id: STATEMENT_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    title: 'Coffee import',
    commodity: 'coffee',
    referenceNumber: null,
    verificationNumber: null,
    status: 'draft',
    activityType: null,
    actorRole: null,
    referencedStatements: [],
    quantityKg: null,
    supplementaryUnit: null,
    supplementaryQuantity: null,
    orderId: null,
    submittedAt: null,
    referenceIssuedAt: null,
    orderSnapshot: null,
    notes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    deletedAt: null,
    custom: null,
    ...overrides,
  }
}

async function undoUpdate(
  harness: Harness,
  before: StatementSnapshot,
  after: StatementSnapshot,
): Promise<unknown> {
  const command = getCommand('eudr.statements.update')
  try {
    await command.undo!({ logEntry: { commandPayload: { undo: { before, after } } }, ctx: harness.ctx } as never)
    return null
  } catch (error) {
    return error
  }
}

describe('eudr.statements.update undo', () => {
  it('refuses to reopen a statement that was archived after the update', async () => {
    const record = buildRecord({ status: 'archived' })
    const original = { ...record }
    const harness = buildHarness(record)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ title: 'Coffee import (draft)' }),
      buildSnapshot({ updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expectUndoRefusal(error, 'eudr.errors.archivedReadOnly', 'Archived statements are read-only.')
    expect(record).toEqual(original)
    expectNothingDeleted(record, harness)
  })

  it('refuses to undo the update that archived the statement', async () => {
    const record = buildRecord({ status: 'archived' })
    const original = { ...record }
    const harness = buildHarness(record)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ status: 'draft' }),
      buildSnapshot({ status: 'archived', updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expectUndoRefusal(error, 'eudr.errors.archivedReadOnly', 'Archived statements are read-only.')
    expect(record).toEqual(original)
    expectNothingDeleted(record, harness)
  })

  it('refuses to move a referenced available statement back to submitted', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-6',
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const original = { ...record }
    const harness = buildHarness(record, 1)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ status: 'submitted', referenceNumber: 'DDS-6' }),
      buildSnapshot({ status: 'available', referenceNumber: 'DDS-6', updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expectUndoRefusal(
      error,
      'eudr.errors.referencedDownstream',
      'This statement is referenced by a downstream statement.',
    )
    expect(record).toEqual(original)
    expectNothingDeleted(record, harness)
  })

  it('refuses to reopen an available statement whose amendment window has elapsed', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-7',
      referenceIssuedAt: new Date(Date.now() - 73 * HOUR_MS),
    })
    const harness = buildHarness(record)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ title: 'Coffee import (draft)' }),
      buildSnapshot({ updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expectUndoRefusal(error, 'eudr.errors.amendWindowElapsed', 'The amendment window has elapsed.')
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expectNothingDeleted(record, harness)
  })

  it('still reverts a status change while the statement stays deletable', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-8',
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const harness = buildHarness(record, 0)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ status: 'submitted', referenceNumber: 'DDS-8' }),
      buildSnapshot({ status: 'available', referenceNumber: 'DDS-8', updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expect(error).toBeNull()
    expect(record.status).toBe('submitted')
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'updated', entity: record }),
    )
  })

  it('still reverts a field edit on an archived statement when the status is unchanged', async () => {
    const record = buildRecord({ status: 'archived' })
    const harness = buildHarness(record)

    const error = await undoUpdate(
      harness,
      buildSnapshot({ status: 'archived', notes: 'before' }),
      buildSnapshot({ status: 'archived', notes: 'after', updatedAt: '2026-09-03T00:00:00.000Z' }),
    )

    expect(error).toBeNull()
    expect(record.status).toBe('archived')
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
  })
})

describe('eudr.statements.delete', () => {
  it('keeps rejecting archived statements with the untranslated 400 body', async () => {
    const record = buildRecord({ status: 'archived' })
    const harness = buildHarness(record)
    const command = getCommand('eudr.statements.delete')

    let caught: unknown = null
    try {
      await command.execute({ body: { id: STATEMENT_ID } }, harness.ctx)
    } catch (error) {
      caught = error
    }

    expect(isCrudHttpError(caught)).toBe(true)
    if (!isCrudHttpError(caught)) return
    expect(caught.status).toBe(400)
    expect(caught.body).toEqual({ error: 'eudr.errors.archivedReadOnly' })
    expectNothingDeleted(record, harness)
  })

  it('keeps rejecting referenced available statements with the untranslated 400 body', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-4',
      referenceIssuedAt: new Date(Date.now() - HOUR_MS),
    })
    const harness = buildHarness(record, 2)
    const command = getCommand('eudr.statements.delete')

    let caught: unknown = null
    try {
      await command.execute({ body: { id: STATEMENT_ID } }, harness.ctx)
    } catch (error) {
      caught = error
    }

    expect(isCrudHttpError(caught)).toBe(true)
    if (!isCrudHttpError(caught)) return
    expect(caught.status).toBe(400)
    expect(caught.body).toEqual({ error: 'eudr.errors.referencedDownstream' })
    expectNothingDeleted(record, harness)
  })

  it('keeps rejecting available statements past the amendment window with the untranslated 400 body', async () => {
    const record = buildRecord({
      status: 'available',
      referenceNumber: 'DDS-9',
      referenceIssuedAt: new Date(Date.now() - 73 * HOUR_MS),
    })
    const harness = buildHarness(record)
    const command = getCommand('eudr.statements.delete')

    let caught: unknown = null
    try {
      await command.execute({ body: { id: STATEMENT_ID } }, harness.ctx)
    } catch (error) {
      caught = error
    }

    expect(isCrudHttpError(caught)).toBe(true)
    if (!isCrudHttpError(caught)) return
    expect(caught.status).toBe(400)
    expect(caught.body).toEqual({ error: 'eudr.errors.amendWindowElapsed' })
    expect(harness.downstreamQuery).not.toHaveBeenCalled()
    expectNothingDeleted(record, harness)
  })
})
