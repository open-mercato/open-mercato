import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentFolder } from '../data/entities'
import {
  DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION,
  DOCUMENTS_MAX_LISTED_FOLDERS,
} from '../lib/constants'
import { getVisibleFolders } from '../lib/visibility'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/find')
  return {
    ...actual,
    findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    resolveDocumentsCommandFeatures: async () => ['documents.edit'],
  }
})

import { createFolderCommand, type FolderCreateCommandInput } from '../commands/folders'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'

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
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => Object.assign(
      new DocumentFolder(),
      data,
      {
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        updatedAt: new Date('2026-07-10T10:00:00.000Z'),
        deletedAt: null,
      },
    )),
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

const createInput: FolderCreateCommandInput = {
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  folderId: FOLDER_ID,
  name: 'Created folder',
  parentFolderId: null,
}

describe('organization folder creation cap', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockResolvedValue(null)
  })

  it('rejects a create that would push the organization past the cap', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION)

    await expect(createFolderCommand.execute(createInput, commandContext(em)))
      .rejects.toMatchObject({
        status: 422,
        body: { error: 'documents.errors.folderLimitReached' },
      })
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('counts only active folders inside the acting organization', async () => {
    const em = fakeEntityManager(DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION - 1)

    await expect(createFolderCommand.execute(createInput, commandContext(em)))
      .resolves.toMatchObject({ id: FOLDER_ID })
    expect(em.count).toHaveBeenCalledWith(DocumentFolder, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      deletedAt: null,
    })
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

    await expect(createFolderCommand.execute(createInput, commandContext(em)))
      .rejects.toMatchObject({ status: 422 })
    expect(lockOrder).toEqual(['lock', 'count'])
  })
})

function folderRow(id: string, parentFolderId: string | null, name: string): DocumentFolder {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ownerUserId: USER_ID,
    parentFolderId,
    name,
    createdAt: new Date('2026-07-10T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T10:00:00.000Z'),
    deletedAt: null,
  } as DocumentFolder
}

const listingScope = {
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  roleIds: [],
  managerOverride: true,
  canEditAction: true,
}

describe('manager-override folder listing bound', () => {
  it('bounds the organization-wide folder read', async () => {
    const find = jest.fn(async () => [folderRow('root', null, 'Root')])
    const em = { find } as unknown as EntityManager

    await expect(getVisibleFolders({ em, ...listingScope })).resolves.toHaveLength(1)
    expect(find).toHaveBeenCalledWith(
      DocumentFolder,
      expect.anything(),
      expect.objectContaining({ limit: DOCUMENTS_MAX_LISTED_FOLDERS + 1 }),
    )
  })

  it('lists a coherent subtree instead of failing an organization over the bound', async () => {
    // Alphabetical truncation cuts this root away while keeping its child, so
    // the unbounded hierarchy contract would reject the whole listing.
    const truncatedRoot = folderRow('truncated-root', null, 'zzz truncated root')
    const orphan = folderRow('orphan', truncatedRoot.id, 'aaa orphan')
    const roots = Array.from(
      { length: DOCUMENTS_MAX_LISTED_FOLDERS - 1 },
      (_, index) => folderRow(`root-${index}`, null, `root ${index}`),
    )
    const em = {
      find: jest.fn(async () => [orphan, ...roots, truncatedRoot]),
    } as unknown as EntityManager

    const rows = await getVisibleFolders({ em, ...listingScope })

    expect(rows).toHaveLength(DOCUMENTS_MAX_LISTED_FOLDERS - 1)
    expect(rows.some((row) => row.folder.id === orphan.id)).toBe(false)
    expect(rows.every((row) => row.canEdit && row.visibility === 'owned')).toBe(true)
  })

  it('leaves an organization under the bound untouched', async () => {
    const root = folderRow('root', null, 'Root')
    const child = folderRow('child', root.id, 'Child')
    const em = { find: jest.fn(async () => [child, root]) } as unknown as EntityManager

    const rows = await getVisibleFolders({ em, ...listingScope })

    expect(rows.map((row) => row.folder.id)).toEqual([child.id, root.id])
  })
})
