import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { DocumentFolder } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockResolveSubjectAccess = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('../lib/permissions', () => ({
  ...jest.requireActual('../lib/permissions'),
  resolveSubjectAccess: (...args: unknown[]) => mockResolveSubjectAccess(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { updateFolderCommand, type FolderUpdateCommandInput } from '../commands/folders'
import { assertDocumentCommandCapability } from '../commands/shared'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const STALE_ROLE_ID = '66666666-6666-4666-8666-666666666666'
const API_KEY_ID = '77777777-7777-4777-8777-777777777777'
const API_KEY_SUBJECT = `api_key:${API_KEY_ID}`
const CURRENT_VERSION = new Date('2030-01-01T00:00:00.000Z')

type Acl = { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }

function buildHarness(
  loadAcl: () => Promise<Acl>,
  authOverrides: Record<string, unknown> = {},
) {
  const order: string[] = []
  let inTransaction = false
  const folder = Object.assign(new DocumentFolder(), {
    id: FOLDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    name: 'Before',
    parentFolderId: null,
    ownerUserId: USER_ID,
    createdAt: CURRENT_VERSION,
    updatedAt: CURRENT_VERSION,
    deletedAt: null,
  })
  const rbacService = {
    invalidateUserCache: jest.fn(async () => { order.push('invalidate-acl') }),
    loadAcl: jest.fn(async () => {
      order.push('reload-acl')
      return loadAcl()
    }),
  }
  const em = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    fork: jest.fn(() => em),
    begin: jest.fn(async () => {
      inTransaction = true
      order.push('begin')
    }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => {
      order.push('commit')
      inTransaction = false
    }),
    rollback: jest.fn(async () => {
      order.push('rollback')
      inTransaction = false
    }),
    isInTransaction: jest.fn(() => inTransaction),
    execute: jest.fn(async () => { order.push('lock-hierarchy'); return [] }),
  } as unknown as EntityManager
  mockFindOneWithDecryption.mockImplementation(async (
    _em: EntityManager,
    entity: unknown,
    where: unknown,
    options?: { lockMode?: LockMode },
  ) => {
    if (entity !== DocumentFolder) return null
    expect(options?.lockMode).toBe(LockMode.PESSIMISTIC_WRITE)
    order.push('lock-folder')
    return folder
  })
  const ctx = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      // Deliberately stale request claims: lock-time authorization must ignore
      // all three and use the current ACL/role assignments instead.
      features: ['documents.*'],
      roleIds: [STALE_ROLE_ID],
      roles: [STALE_ROLE_ID],
      isSuperAdmin: true,
      ...authOverrides,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    transactionalEm: em,
  } satisfies CommandRuntimeContext
  return { ctx, em, folder, order, rbacService }
}

function updateInput(): FolderUpdateCommandInput {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    id: FOLDER_ID,
    name: 'After',
  }
}

describe('documents command lock-time authorization freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('rejects a revoked grant after locking even when the request claims feature and superadmin access', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: [],
      organizations: null,
    }))

    await expect(updateFolderCommand.execute(updateInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(harness.order.slice(0, 5)).toEqual([
      'begin',
      'lock-hierarchy',
      'lock-folder',
      'invalidate-acl',
      'reload-acl',
    ])
    expect(harness.rbacService.invalidateUserCache).toHaveBeenCalledWith(USER_ID)
    expect(harness.folder.name).toBe('Before')
    expect(harness.folder.updatedAt).toEqual(CURRENT_VERSION)
    expect(harness.em.flush).not.toHaveBeenCalled()
    expect(harness.em.rollback).toHaveBeenCalledTimes(1)
  })

  it('accepts a current superadmin grant and advances the version under a backwards clock', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: true,
      features: [],
      organizations: null,
    }))

    const result = await updateFolderCommand.execute(updateInput(), harness.ctx)

    expect(harness.order.indexOf('lock-folder')).toBeLessThan(harness.order.indexOf('invalidate-acl'))
    expect(harness.order.indexOf('invalidate-acl')).toBeLessThan(harness.order.indexOf('reload-acl'))
    expect(result.updatedAt).toBe('2030-01-01T00:00:00.001Z')
    expect(harness.folder.name).toBe('After')

    await updateFolderCommand.undo!({
      input: updateInput(),
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: updateInput(),
          undo: { before: result.before, after: result.after },
        },
      },
    })
    const undoVersion = harness.folder.updatedAt.toISOString()
    expect(Date.parse(undoVersion)).toBeGreaterThan(Date.parse(result.updatedAt))

    const redone = await updateFolderCommand.execute(updateInput(), harness.ctx)
    expect(Date.parse(redone.updatedAt)).toBeGreaterThan(Date.parse(undoVersion))
  })

  it('uses current role membership for role shares instead of token role ids', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: null,
    }))
    mockResolveSubjectAccess.mockResolvedValueOnce(null)

    await expect(assertDocumentCommandCapability(
      harness.ctx,
      harness.em,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      'canEdit',
    )).rejects.toMatchObject({ status: 403 })

    expect(mockResolveSubjectAccess).toHaveBeenCalledWith(
      harness.em,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { subject: USER_ID, userId: USER_ID },
      harness.ctx.container,
    )

    mockResolveSubjectAccess.mockResolvedValueOnce('editor')
    await expect(assertDocumentCommandCapability(
      harness.ctx,
      harness.em,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      'canEdit',
    )).resolves.toEqual(['documents.edit'])
  })

  it('rejects current features when the fresh ACL no longer permits the selected organization', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: ['77777777-7777-4777-8777-777777777777'],
    }))

    await expect(updateFolderCommand.execute(updateInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(harness.folder.name).toBe('Before')
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('does not turn an empty live organization allowlist into account-organization command access', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: [],
    }))
    ;(harness.em.find as jest.Mock).mockImplementation(async (entity: unknown) => (
      entity === Organization
        ? [{ id: ORGANIZATION_ID, descendantIds: [] }]
        : []
    ))

    await expect(updateFolderCommand.execute(updateInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(harness.folder.name).toBe('Before')
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('authorizes and rechecks API-key commands with the key subject, never the backing user ACL', async () => {
    let currentAcl: Acl = {
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: [ORGANIZATION_ID],
    }
    const harness = buildHarness(async () => currentAcl, {
      sub: API_KEY_SUBJECT,
      keyId: API_KEY_ID,
      userId: USER_ID,
      isApiKey: true,
      // These are deliberately broader than the key ACL and must be ignored.
      features: ['documents.*'],
      isSuperAdmin: true,
    })

    const result = await updateFolderCommand.execute(updateInput(), harness.ctx)

    expect(harness.folder.name).toBe('After')
    expect(harness.rbacService.invalidateUserCache).toHaveBeenLastCalledWith(API_KEY_SUBJECT)
    expect(harness.rbacService.loadAcl).toHaveBeenLastCalledWith(API_KEY_SUBJECT, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
    expect(harness.rbacService.loadAcl).not.toHaveBeenCalledWith(USER_ID, expect.anything())

    currentAcl = { isSuperAdmin: false, features: [], organizations: [ORGANIZATION_ID] }
    await expect(updateFolderCommand.undo!({
      input: updateInput(),
      ctx: harness.ctx,
      logEntry: {
        commandPayload: {
          __redoInput: updateInput(),
          undo: { before: result.before, after: result.after },
        },
      },
    })).rejects.toMatchObject({ status: 403 })

    expect(harness.folder.name).toBe('After')
    expect(harness.rbacService.invalidateUserCache).toHaveBeenLastCalledWith(API_KEY_SUBJECT)
    expect(harness.rbacService.loadAcl).toHaveBeenLastCalledWith(API_KEY_SUBJECT, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('fails closed when the RBAC override cannot invalidate its ACL cache', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: null,
    }))
    const loadAcl = harness.rbacService.loadAcl
    delete (harness.rbacService as Partial<typeof harness.rbacService>).invalidateUserCache

    await expect(updateFolderCommand.execute(updateInput(), harness.ctx)).rejects.toMatchObject({
      status: 403,
    })

    expect(loadAcl).not.toHaveBeenCalled()
    expect(harness.folder.name).toBe('Before')
  })

  it('aborts the mutation when ACL cache invalidation fails', async () => {
    const harness = buildHarness(async () => ({
      isSuperAdmin: false,
      features: ['documents.edit'],
      organizations: null,
    }))
    harness.rbacService.invalidateUserCache.mockRejectedValueOnce(new Error('cache unavailable'))

    await expect(updateFolderCommand.execute(updateInput(), harness.ctx)).rejects.toThrow('cache unavailable')

    expect(harness.rbacService.loadAcl).not.toHaveBeenCalled()
    expect(harness.folder.name).toBe('Before')
    expect(harness.em.flush).not.toHaveBeenCalled()
  })
})
