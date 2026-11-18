import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentFolder } from '../data/entities'
import { DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION } from '../lib/constants'

const mockFindOneWithDecryption = jest.fn()

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
    resolveDocumentsCommandFeatures: async () => ['documents.edit'],
  }
})

import { deleteFolderCommand, type FolderDeleteCommandInput } from '../commands/folders'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
const BEFORE_UPDATED_AT = '2026-07-10T10:00:00.000Z'
const AFTER_UPDATED_AT = '2026-07-10T10:01:00.000Z'

const deleteInput: FolderDeleteCommandInput = {
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  id: FOLDER_ID,
}

const beforeSnapshot = {
  id: FOLDER_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  name: 'Deleted folder',
  parentFolderId: null,
  ownerUserId: USER_ID,
  createdAt: '2026-07-10T09:00:00.000Z',
  updatedAt: BEFORE_UPDATED_AT,
  deletedAt: null,
}

const afterSnapshot = {
  ...beforeSnapshot,
  updatedAt: AFTER_UPDATED_AT,
  deletedAt: AFTER_UPDATED_AT,
}

function deletedFolder(updatedAt: string = AFTER_UPDATED_AT): DocumentFolder {
  return Object.assign(new DocumentFolder(), {
    ...beforeSnapshot,
    createdAt: new Date(beforeSnapshot.createdAt),
    updatedAt: new Date(updatedAt),
    deletedAt: new Date(AFTER_UPDATED_AT),
  })
}

function fakeEntityManager(activeFolderCount: number): EntityManager {
  let inTransaction = false
  return {
    begin: jest.fn(async () => { inTransaction = true }),
    flush: jest.fn(async () => undefined),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    isInTransaction: jest.fn(() => inTransaction),
    execute: jest.fn(async () => []),
    count: jest.fn(async () => activeFolderCount),
    persist: jest.fn(),
  } as unknown as EntityManager
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

async function deleteLogEntry(): Promise<{ commandPayload: unknown }> {
  const metadata = await deleteFolderCommand.buildLog!({
    input: deleteInput,
    result: { id: FOLDER_ID, updatedAt: AFTER_UPDATED_AT, before: beforeSnapshot, after: afterSnapshot },
    ctx: {} as CommandRuntimeContext,
    snapshots: {},
  })
  return { commandPayload: metadata!.payload }
}

async function undoDelete(em: EntityManager): Promise<void> {
  await deleteFolderCommand.undo!({
    input: deleteInput,
    ctx: commandContext(em),
    logEntry: await deleteLogEntry(),
  } as never)
}

describe('organization folder cap on folder delete undo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects an undo that would push the organization past the cap', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)
    const folder = deletedFolder()
    mockFindOneWithDecryption.mockResolvedValue(folder)

    await expect(undoDelete(em)).rejects.toMatchObject({
      status: 422,
      body: { error: 'documents.errors.folderLimitReached' },
    })
    expect(folder.deletedAt?.toISOString()).toBe(AFTER_UPDATED_AT)
    expect(em.count).toHaveBeenCalledWith(DocumentFolder, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      deletedAt: null,
    })
  })

  it('restores the folder while the organization is under the cap', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION - 1)
    const folder = deletedFolder()
    mockFindOneWithDecryption.mockResolvedValue(folder)

    await undoDelete(em)

    expect(folder.deletedAt).toBeNull()
  })

  it('counts capacity while the scoped hierarchy lock is held', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)
    const lockOrder: string[] = []
    ;(em.execute as jest.Mock).mockImplementation(async () => {
      lockOrder.push('lock')
      return []
    })
    ;(em.count as jest.Mock).mockImplementation(async () => {
      lockOrder.push('count')
      return DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION
    })
    mockFindOneWithDecryption.mockResolvedValue(deletedFolder())

    await expect(undoDelete(em)).rejects.toMatchObject({ status: 422 })
    expect(lockOrder).toEqual(['lock', 'count'])
  })

  it('reports a stale undo as a conflict before checking capacity', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)
    mockFindOneWithDecryption.mockResolvedValue(deletedFolder('2026-07-10T10:02:00.000Z'))

    await expect(undoDelete(em)).rejects.toMatchObject({ status: 409 })
    expect(em.count).not.toHaveBeenCalled()
  })
})
