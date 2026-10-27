import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Document } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockLockDocumentAggregateRoot = jest.fn()
const mockLoadLockedDocumentContent = jest.fn()
const mockAssertDocumentCommandCapability = jest.fn()
const mockResolveDocumentsCommandFeatures = jest.fn()
const mockEmitCrudUndoSideEffects = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: (...args: unknown[]) => mockEmitCrudUndoSideEffects(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../commands/aggregate', () => ({
  assertNoPostCreateDocumentDependents: jest.fn(async () => undefined),
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockDocumentAggregateRoot(...args),
  loadLockedDocumentContent: (...args: unknown[]) => mockLoadLockedDocumentContent(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCapability: (...args: unknown[]) => mockAssertDocumentCommandCapability(...args),
    resolveDocumentsCommandFeatures: (...args: unknown[]) => mockResolveDocumentsCommandFeatures(...args),
  }
})

import {
  createDocumentCommand,
  deleteDocumentCommand,
  updateDocumentCommand,
  type DocumentCreateCommandInput,
  type DocumentDeleteCommandInput,
  type DocumentUpdateCommandInput,
} from '../commands/document-crud'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '55555555-5555-4555-8555-555555555555'
const NEW_FOLDER_ID = '66666666-6666-4666-8666-666666666666'
const DOCUMENT_ID = '77777777-7777-4777-8777-777777777777'
const BEFORE_UPDATED_AT = '2026-07-10T10:00:00.000Z'
const AFTER_UPDATED_AT = '2026-07-10T10:01:00.000Z'

type DocumentSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  title: string
  folderId: string | null
  ownerUserId: string
  createdByUserId: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function snapshot(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    title: 'Before',
    folderId: FOLDER_ID,
    ownerUserId: ACTOR_ID,
    createdByUserId: ACTOR_ID,
    isActive: true,
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: BEFORE_UPDATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function documentFrom(snapshotValue: DocumentSnapshot): Document {
  return Object.assign(new Document(), {
    ...snapshotValue,
    createdAt: new Date(snapshotValue.createdAt),
    updatedAt: new Date(snapshotValue.updatedAt),
    deletedAt: snapshotValue.deletedAt ? new Date(snapshotValue.deletedAt) : null,
  })
}

function fakeEntityManager(): EntityManager {
  return {
    begin: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  } as unknown as EntityManager
}

function commandContext(em: EntityManager, features: string[]): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: ACTOR_ID,
      userId: ACTOR_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      features,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    transactionalEm: em,
  }
}

function logEntry(
  input: DocumentUpdateCommandInput | DocumentDeleteCommandInput,
  before: DocumentSnapshot,
  after: DocumentSnapshot,
) {
  return {
    commandPayload: {
      __redoInput: input,
      undo: {
        before: { document: before, content: null },
        after: { document: after, content: null },
      },
    },
  }
}

async function commandPayload(
  command: typeof updateDocumentCommand | typeof deleteDocumentCommand,
  input: DocumentUpdateCommandInput | DocumentDeleteCommandInput,
  before: { document: DocumentSnapshot; content: ReturnType<typeof contentSnapshot> | null },
  after: { document: DocumentSnapshot; content: ReturnType<typeof contentSnapshot> | null },
): Promise<Record<string, unknown>> {
  const metadata = await command.buildLog!({
    input: input as never,
    result: {
      id: DOCUMENT_ID,
      updatedAt: after.document.updatedAt,
      before,
      after,
    } as never,
    ctx: {} as CommandRuntimeContext,
    snapshots: {},
  })
  return metadata!.payload as Record<string, unknown>
}

function contentSnapshot(updatedAt: string, deletedAt: string | null = null) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    documentId: DOCUMENT_ID,
    updatedAt,
    deletedAt,
  }
}

describe('document undo folder validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
    mockLoadLockedDocumentContent.mockResolvedValue(null)
    mockResolveDocumentsCommandFeatures.mockResolvedValue(['documents.edit', 'documents.delete'])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('requires documents.delete before undoing a document create', async () => {
    const after = snapshot()
    const document = documentFrom(after)
    const em = fakeEntityManager()
    mockLockDocumentAggregateRoot.mockResolvedValue(document)
    mockResolveDocumentsCommandFeatures.mockResolvedValue(['documents.create'])
    const input: DocumentCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      contentId: '88888888-8888-4888-8888-888888888888',
      title: after.title,
      folderId: after.folderId,
    }

    await expect(createDocumentCommand.undo!({
      input,
      ctx: commandContext(em, ['documents.create']),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: {
            before: { document: null, content: null },
            after: { document: after, content: null },
          },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(document.deletedAt).toBeNull()
    expect((em as unknown as { flush: jest.Mock }).flush).not.toHaveBeenCalled()
    expect((em as unknown as { rollback: jest.Mock }).rollback).toHaveBeenCalledTimes(1)
    expect((em as unknown as { commit: jest.Mock }).commit).not.toHaveBeenCalled()
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('rejects update undo when the snapshot folder was deleted without mutating the document', async () => {
    const before = snapshot()
    const after = snapshot({
      title: 'After',
      folderId: NEW_FOLDER_ID,
      updatedAt: AFTER_UPDATED_AT,
    })
    const document = documentFrom(after)
    const em = fakeEntityManager()
    mockLockDocumentAggregateRoot.mockResolvedValue(document)
    mockAssertDocumentCommandCapability.mockResolvedValue(['documents.edit'])
    mockFindOneWithDecryption.mockResolvedValue(null)
    const input: DocumentUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: DOCUMENT_ID,
      title: after.title,
      folderId: after.folderId,
    }

    await expect(updateDocumentCommand.undo!({
      input,
      ctx: commandContext(em, ['documents.edit']),
      logEntry: logEntry(input, before, after),
    })).rejects.toMatchObject({ status: 404 })

    expect(document).toMatchObject({
      title: 'After',
      folderId: NEW_FOLDER_ID,
      updatedAt: new Date(AFTER_UPDATED_AT),
    })
    expect((em as unknown as { rollback: jest.Mock }).rollback).toHaveBeenCalledTimes(1)
    expect((em as unknown as { commit: jest.Mock }).commit).not.toHaveBeenCalled()
    expect(mockEmitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('binds update redo to the exact post-undo version and rejects double redo', async () => {
    const before = snapshot()
    const after = snapshot({ title: 'After', folderId: NEW_FOLDER_ID, updatedAt: AFTER_UPDATED_AT })
    const document = documentFrom(after)
    const em = fakeEntityManager()
    mockLockDocumentAggregateRoot.mockResolvedValue(document)
    mockAssertDocumentCommandCapability.mockResolvedValue(['documents.edit'])
    mockFindOneWithDecryption.mockResolvedValue({ id: FOLDER_ID, ownerUserId: ACTOR_ID })
    const input: DocumentUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: DOCUMENT_ID,
      title: after.title,
      folderId: after.folderId,
    }

    const payload = await commandPayload(
      updateDocumentCommand,
      input,
      { document: before, content: null },
      { document: after, content: null },
    )
    const redoInput = (payload.__redoInput as DocumentUpdateCommandInput)

    await expect(updateDocumentCommand.undo!({
      input,
      ctx: commandContext(em, ['documents.edit']),
      logEntry: { commandPayload: payload },
    })).resolves.toBeUndefined()

    expect(document).toMatchObject({
      title: 'Before',
      folderId: FOLDER_ID,
      isActive: true,
      updatedAt: new Date('2026-07-10T10:01:00.001Z'),
    })
    expect(redoInput.redoExpectation?.document.updatedAt).toBe(document.updatedAt.toISOString())
    expect((em as unknown as { commit: jest.Mock }).commit).toHaveBeenCalledTimes(1)
    expect(mockEmitCrudUndoSideEffects).toHaveBeenCalledTimes(1)

    mockLockDocumentAggregateRoot.mockResolvedValue(document)
    const redone = await updateDocumentCommand.execute(
      redoInput,
      commandContext(em, ['documents.edit']),
    )
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(redoInput.redoExpectation!.document.updatedAt))

    await expect(updateDocumentCommand.execute(
      redoInput,
      commandContext(em, ['documents.edit']),
    )).rejects.toMatchObject({ status: 409 })
  })

  it('rejects update redo after a same-value intervening write advances the version', async () => {
    const before = snapshot({ folderId: null })
    const after = snapshot({
      title: 'After',
      folderId: null,
      updatedAt: AFTER_UPDATED_AT,
    })
    const input: DocumentUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: DOCUMENT_ID,
      title: after.title,
    }
    const payload = await commandPayload(
      updateDocumentCommand,
      input,
      { document: before, content: null },
      { document: after, content: null },
    )
    const redoInput = payload.__redoInput as DocumentUpdateCommandInput
    const document = documentFrom(redoInput.redoExpectation!.document)
    // Another writer saved the same visible values. Scalar-only comparisons
    // would miss this; the version token must still make redo conflict.
    document.updatedAt = new Date(document.updatedAt.getTime() + 1)
    const em = fakeEntityManager()
    mockLockDocumentAggregateRoot.mockResolvedValue(document)
    mockAssertDocumentCommandCapability.mockResolvedValue(['documents.edit'])

    await expect(updateDocumentCommand.execute(
      redoInput,
      commandContext(em, ['documents.edit']),
    )).rejects.toMatchObject({ status: 409 })

    expect((em as unknown as { flush: jest.Mock }).flush).not.toHaveBeenCalled()
    expect(document.title).toBe(before.title)
  })

  it('makes destructive document deletion audit-only with no custom undo payload', async () => {
    const beforeDocument = snapshot({ folderId: null })
    const afterDocument = snapshot({
      folderId: null,
      isActive: false,
      updatedAt: AFTER_UPDATED_AT,
      deletedAt: AFTER_UPDATED_AT,
    })
    const beforeContent = contentSnapshot('2026-07-10T10:00:00.500Z')
    const afterContent = contentSnapshot(
      '2026-07-10T10:01:00.001Z',
      '2026-07-10T10:01:00.001Z',
    )
    const input: DocumentDeleteCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: DOCUMENT_ID,
    }
    const metadata = await deleteDocumentCommand.buildLog!({
      input,
      result: {
        id: DOCUMENT_ID,
        updatedAt: afterDocument.updatedAt,
        before: { document: beforeDocument, content: beforeContent },
        after: { document: afterDocument, content: afterContent },
      },
      ctx: {} as CommandRuntimeContext,
      snapshots: {},
    })

    expect(deleteDocumentCommand.isUndoable).toBe(false)
    expect(deleteDocumentCommand.undo).toBeUndefined()
    expect(metadata).toMatchObject({
      resourceKind: 'documents:document',
      resourceId: DOCUMENT_ID,
      snapshotBefore: { document: beforeDocument, content: beforeContent },
      snapshotAfter: { document: afterDocument, content: afterContent },
    })
    expect(metadata).not.toHaveProperty('payload')
  })
})
