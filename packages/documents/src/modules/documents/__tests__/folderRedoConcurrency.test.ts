import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentFolder } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockResolveDocumentsCommandFeatures = jest.fn(async () => ['documents.edit'])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../lib/visibility', () => ({
  getFolderPlacementIssue: jest.fn(async () => null),
  hasActiveFolderContents: jest.fn(async () => false),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    resolveDocumentsCommandFeatures: (...args: unknown[]) => (
      mockResolveDocumentsCommandFeatures(...args)
    ),
  }
})

import {
  createFolderCommand,
  deleteFolderCommand,
  updateFolderCommand,
  type FolderCreateCommandInput,
  type FolderDeleteCommandInput,
  type FolderUpdateCommandInput,
} from '../commands/folders'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
const BEFORE_UPDATED_AT = '2026-07-10T10:00:00.000Z'
const AFTER_UPDATED_AT = '2026-07-10T10:01:00.000Z'

type FolderSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  parentFolderId: string | null
  ownerUserId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function snapshot(overrides: Partial<FolderSnapshot> = {}): FolderSnapshot {
  return {
    id: FOLDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    name: 'Before',
    parentFolderId: null,
    ownerUserId: USER_ID,
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: BEFORE_UPDATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function folderFrom(value: FolderSnapshot): DocumentFolder {
  return Object.assign(new DocumentFolder(), {
    ...value,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    deletedAt: value.deletedAt ? new Date(value.deletedAt) : null,
  })
}

function fakeEntityManager(): EntityManager {
  let inTransaction = false
  const execute = jest.fn(async () => [])
  return {
    begin: jest.fn(async () => { inTransaction = true }),
    flush: jest.fn(async () => undefined),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    isInTransaction: jest.fn(() => inTransaction),
    execute,
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => Object.assign(
      new DocumentFolder(),
      data,
      {
        createdAt: new Date(BEFORE_UPDATED_AT),
        updatedAt: new Date(BEFORE_UPDATED_AT),
        deletedAt: null,
      },
    )),
    persist: jest.fn(),
  } as unknown as EntityManager
}

function hierarchyLockExecute(em: EntityManager): jest.Mock {
  return em.execute as jest.Mock
}

function commandContext(em: EntityManager): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    transactionalEm: em,
  }
}

async function commandPayload(
  command: typeof updateFolderCommand | typeof deleteFolderCommand,
  input: FolderUpdateCommandInput | FolderDeleteCommandInput,
  before: FolderSnapshot,
  after: FolderSnapshot,
): Promise<Record<string, unknown>> {
  const metadata = await command.buildLog!({
    input: input as never,
    result: {
      id: FOLDER_ID,
      updatedAt: after.updatedAt,
      before,
      after,
    } as never,
    ctx: {} as CommandRuntimeContext,
    snapshots: {},
  })
  return metadata!.payload as Record<string, unknown>
}

describe('folder redo concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('serializes create and create-undo through the scoped hierarchy lock', async () => {
    const input: FolderCreateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      folderId: FOLDER_ID,
      name: 'Created folder',
      parentFolderId: null,
    }
    const em = fakeEntityManager()
    let createdFolder: DocumentFolder | null = null
    ;(em.create as jest.Mock).mockImplementation((_entity: unknown, data: Record<string, unknown>) => {
      createdFolder = Object.assign(new DocumentFolder(), data, {
        createdAt: new Date(BEFORE_UPDATED_AT),
        updatedAt: new Date(BEFORE_UPDATED_AT),
        deletedAt: null,
      })
      return createdFolder
    })
    mockFindOneWithDecryption.mockImplementation(async () => createdFolder)

    const result = await createFolderCommand.execute(input, commandContext(em))
    await createFolderCommand.undo!({
      input,
      ctx: commandContext(em),
      logEntry: {
        commandPayload: {
          __redoInput: input,
          undo: { before: null, after: result.after },
        },
      },
    })

    expect(createdFolder?.deletedAt).toBeInstanceOf(Date)
    expect(hierarchyLockExecute(em)).toHaveBeenCalledTimes(2)
  })

  it('binds update redo to undo state and rejects same-value edits and double redo', async () => {
    const before = snapshot()
    const after = snapshot({ name: 'After', updatedAt: AFTER_UPDATED_AT })
    const input: FolderUpdateCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: FOLDER_ID,
      name: after.name,
    }
    const payload = await commandPayload(updateFolderCommand, input, before, after)
    const redoInput = payload.__redoInput as FolderUpdateCommandInput
    const folder = folderFrom(after)
    const em = fakeEntityManager()
    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      _entity: unknown,
      _where: unknown,
      options?: { lockMode?: LockMode },
    ) => {
      expect(options?.lockMode).toBe(LockMode.PESSIMISTIC_WRITE)
      return folder
    })

    await updateFolderCommand.undo!({
      input,
      ctx: commandContext(em),
      logEntry: { commandPayload: payload },
    })
    expect(folder.updatedAt.toISOString()).toBe(
      redoInput.redoExpectation!.folder.updatedAt,
    )

    const expectedVersion = folder.updatedAt
    folder.updatedAt = new Date(folder.updatedAt.getTime() + 1)
    await expect(updateFolderCommand.execute(redoInput, commandContext(em)))
      .rejects.toMatchObject({ status: 409 })

    folder.updatedAt = expectedVersion
    await expect(updateFolderCommand.execute(redoInput, commandContext(em)))
      .resolves.toMatchObject({ id: FOLDER_ID })
    await expect(updateFolderCommand.execute(redoInput, commandContext(em)))
      .rejects.toMatchObject({ status: 409 })
    expect(hierarchyLockExecute(em)).toHaveBeenCalledTimes(4)
  })

  it('binds delete redo to undo state and rejects same-value edits and double redo', async () => {
    const before = snapshot()
    const after = snapshot({
      updatedAt: AFTER_UPDATED_AT,
      deletedAt: AFTER_UPDATED_AT,
    })
    const input: FolderDeleteCommandInput = {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      id: FOLDER_ID,
    }
    const payload = await commandPayload(deleteFolderCommand, input, before, after)
    const redoInput = payload.__redoInput as FolderDeleteCommandInput
    const folder = folderFrom(after)
    const em = fakeEntityManager()
    mockFindOneWithDecryption.mockResolvedValue(folder)

    await deleteFolderCommand.undo!({
      input,
      ctx: commandContext(em),
      logEntry: { commandPayload: payload },
    })
    expect(folder.updatedAt.toISOString()).toBe(
      redoInput.redoExpectation!.folder.updatedAt,
    )
    expect(folder.deletedAt).toBeNull()

    const expectedVersion = folder.updatedAt
    folder.updatedAt = new Date(folder.updatedAt.getTime() + 1)
    await expect(deleteFolderCommand.execute(redoInput, commandContext(em)))
      .rejects.toMatchObject({ status: 409 })

    folder.updatedAt = expectedVersion
    await expect(deleteFolderCommand.execute(redoInput, commandContext(em)))
      .resolves.toMatchObject({ id: FOLDER_ID })
    await expect(deleteFolderCommand.execute(redoInput, commandContext(em)))
      .rejects.toMatchObject({ status: 409 })
    expect(hierarchyLockExecute(em)).toHaveBeenCalledTimes(4)
  })
})
