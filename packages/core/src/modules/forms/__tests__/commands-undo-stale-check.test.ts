import 'reflect-metadata'

jest.mock('../events', () => ({
  emitFormsEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    em: { findOne: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options: unknown,
  ) => em.findOne(entity, where, options),
}))

import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { archiveFormCommand, renameFormCommand, restoreFormCommand } from '../commands/form'
import { closeDistributionCommand, updateDistributionCommand } from '../commands/distribution'
import { archiveVersionCommand, updateDraftCommand } from '../commands/form-version'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const recordId = '33333333-3333-4333-8333-333333333333'
const archivedAt = '2026-01-01T00:05:00.000Z'

type Row = Record<string, unknown>
type UndoCase = {
  name: string
  handler: CommandHandler<never, never>
  before: Row
  after: Row
  field: string
  newer: unknown
}

const scope = { id: recordId, tenantId, organizationId }
const asHandler = (handler: unknown) => handler as CommandHandler<never, never>
const renameBefore = { name: 'Draft Intake Form', description: null, defaultLocale: 'en', supportedLocales: ['en'], retentionDays: null }
const distributionBefore = {
  status: 'active', title: 'Intake', maxResponses: 10, opensAt: archivedAt, closesAt: null, redirectUrl: null,
  allowMultipleSubmissions: false, requireCustomerAuth: false, settings: { theme: 'light' },
}
const draftBefore = { schema: { title: 'v1' }, uiSchema: {}, roles: [], schemaHash: 'hash-v1', registryVersion: 'r1', changelog: null }

const cases: UndoCase[] = [
  {
    name: 'forms.form.rename',
    handler: asHandler(renameFormCommand),
    before: renameBefore,
    after: { ...renameBefore, name: 'Patient Intake Form' },
    field: 'name',
    newer: 'Patient Intake Form (Spanish)',
  },
  {
    name: 'forms.form.archive',
    handler: asHandler(archiveFormCommand),
    before: { status: 'active', archivedAt: null },
    after: { status: 'archived', archivedAt },
    field: 'status',
    newer: 'active',
  },
  {
    name: 'forms.form.restore',
    handler: asHandler(restoreFormCommand),
    before: { status: 'archived', archivedAt },
    after: { status: 'active', archivedAt: null },
    field: 'status',
    newer: 'archived',
  },
  {
    name: 'forms.distribution.update',
    handler: asHandler(updateDistributionCommand),
    before: distributionBefore,
    after: { ...distributionBefore, maxResponses: 20 },
    field: 'status',
    newer: 'closed',
  },
  {
    name: 'forms.distribution.close',
    handler: asHandler(closeDistributionCommand),
    before: { status: 'active' },
    after: { status: 'closed' },
    field: 'status',
    newer: 'paused',
  },
  {
    name: 'forms.form_version.update_draft',
    handler: asHandler(updateDraftCommand),
    before: draftBefore,
    after: { ...draftBefore, status: 'draft', schema: { title: 'v2' }, schemaHash: 'hash-v2' },
    field: 'schemaHash',
    newer: 'hash-v3',
  },
  {
    name: 'forms.form_version.archive',
    handler: asHandler(archiveVersionCommand),
    before: { status: 'published', archivedAt: null },
    after: { status: 'archived', archivedAt },
    field: 'status',
    newer: 'published',
  },
]

function entityRow(values: Row): Row {
  const row: Row = { ...scope, ...values }
  for (const key of ['archivedAt', 'opensAt']) if (typeof row[key] === 'string') row[key] = new Date(String(row[key]))
  return row
}

function createHarness(row: Row) {
  const findOne = jest.fn(async () => row)
  const flush = jest.fn(async () => undefined)
  const refresh = jest.fn(async (entity: Row) => entity)
  const em = {
    fork: () => em,
    transactional: async <T>(callback: (tx: typeof em) => Promise<T>) => callback(em),
    findOne,
    flush,
    refresh,
  }
  const ctx = {
    container: {
      resolve: (key: string) => (key === 'em' ? em : undefined),
      hasRegistration: () => false,
    },
  } as unknown as CommandRuntimeContext
  return { ctx, findOne, flush, refresh }
}

function runUndo(handler: CommandHandler<never, never>, ctx: CommandRuntimeContext, undo: Row) {
  return handler.undo!({ logEntry: { commandPayload: { undo } }, ctx } as never)
}

function checkedUndo(testCase: UndoCase): Row {
  return { before: { ...scope, ...testCase.before }, after: { ...scope, ...testCase.after }, staleCheck: true }
}

describe('forms undo refuses to overwrite a newer change', () => {
  it.each(cases)('$name refuses with 409 when a restored field changed after the action', async (testCase) => {
    const row = entityRow({ ...testCase.after, [testCase.field]: testCase.newer })
    const { ctx, flush } = createHarness(row)

    await expect(runUndo(testCase.handler, ctx, checkedUndo(testCase))).rejects.toMatchObject({
      status: 409,
      body: { code: 'forms.errors.undo_conflict' },
    })
    expect(row[testCase.field]).toEqual(testCase.newer)
    expect(flush).not.toHaveBeenCalled()
  })

  it.each(cases)('$name restores under a row lock when only other columns changed', async (testCase) => {
    const row = entityRow({ ...testCase.after, updatedAt: new Date(), responseCount: 3 })
    const { ctx, findOne, flush } = createHarness(row)

    await runUndo(testCase.handler, ctx, checkedUndo(testCase))

    expect(row[testCase.field]).toEqual(testCase.before[testCase.field])
    expect(flush).toHaveBeenCalledTimes(1)
    expect(findOne).toHaveBeenCalledWith(expect.anything(), scope, { lockMode: LockMode.PESSIMISTIC_WRITE })
  })

  it.each(cases)('$name still restores a log entry written before the check existed', async (testCase) => {
    const row = entityRow({ ...testCase.after, [testCase.field]: testCase.newer })
    const { ctx, flush } = createHarness(row)

    await runUndo(testCase.handler, ctx, { before: { ...scope, ...testCase.before }, after: { ...scope, ...testCase.before } })

    expect(row[testCase.field]).toEqual(testCase.before[testCase.field])
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it.each(cases)('$name marks new log entries for the check', async (testCase) => {
    const log = await testCase.handler.buildLog!({
      input: {},
      result: { updatedAt: archivedAt },
      snapshots: { before: { ...scope, ...testCase.before }, after: { ...scope, ...testCase.after } },
      ctx: {},
    } as never)

    expect(log?.payload).toMatchObject({ undo: { staleCheck: true } })
  })

  it.each(cases)('$name refreshes the row before logging the after snapshot', async (testCase) => {
    const row = entityRow({ ...renameBefore, ...draftBefore, ...testCase.after, createdAt: new Date(), updatedAt: new Date() })
    const { ctx, refresh } = createHarness(row)

    await testCase.handler.captureAfter!({} as never, { formId: recordId, distributionId: recordId, versionId: recordId } as never, ctx)

    expect(refresh).toHaveBeenCalledWith(row)
  })

  it('undoes two renames by the same admin one after the other', async () => {
    const row: Row = { ...scope, ...renameBefore, name: 'Third Name' }
    const { ctx } = createHarness(row)
    const firstRename = { before: { ...scope, ...renameBefore }, after: { ...scope, ...renameBefore, name: 'Second Name' }, staleCheck: true }
    const secondRename = { before: firstRename.after, after: { ...scope, ...renameBefore, name: 'Third Name' }, staleCheck: true }

    await runUndo(asHandler(renameFormCommand), ctx, secondRename)
    await runUndo(asHandler(renameFormCommand), ctx, firstRename)

    expect(row.name).toBe('Draft Intake Form')
  })
})
