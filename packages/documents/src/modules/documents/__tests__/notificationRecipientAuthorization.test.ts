import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { Document, DocumentShare, DocumentWatcher } from '../data/entities'
import type { DocumentsProjectionDescriptor } from '../commands/projection-types'
import { interceptors } from '../commands/interceptors'
import { resolveUserAccess, resolveUserDocumentTier } from '../lib/permissions'
import { resolveWatcherRecipients } from '../lib/watchers'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, ...args: unknown[]) => em.findOne(...args as Parameters<EntityManager['findOne']>),
  findWithDecryption: (em: EntityManager, ...args: unknown[]) => em.find(...args as Parameters<EntityManager['find']>),
}))

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const documentId = 'document-1'
const recipientUserId = 'recipient-1'
const actorUserId = 'actor-1'
const commentId = 'comment-1'
const accessKinds = ['owner', 'direct', 'role', 'manager'] as const
type AccessKind = typeof accessKinds[number]

function fixture(accessKind: AccessKind = 'direct', sharePermission: 'viewer' | 'editor' = 'viewer') {
  let features = ['documents.view', ...(accessKind === 'manager' ? ['documents.manage'] : [])]
  let organizationAllowed = true
  let missingRbac = false
  let missingDocument = false
  let inheritedOrganizations: string[] | null = null
  let expandedOrganizationIds: string[] = []
  const document = { id: documentId, ...scope, ownerUserId: accessKind === 'owner' ? recipientUserId : actorUserId }
  const share = { permission: sharePermission, principalType: accessKind === 'role' ? 'role' : 'user', principalId: accessKind === 'role' ? 'role-1' : recipientUserId }
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (
      entity === Document && !missingDocument
      && where.id === documentId && where.tenantId === scope.tenantId
      && where.organizationId === scope.organizationId && where.deletedAt === null
        ? document : null
    )),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (where.tenantId !== scope.tenantId || where.organizationId !== scope.organizationId || where.deletedAt !== null) return []
      if (entity === DocumentWatcher) return [{ userId: recipientUserId }]
      if (entity === DocumentShare && accessKind !== 'owner' && accessKind !== 'manager') return [share]
      return []
    }),
  } as unknown as EntityManager
  const userHasAllFeatures = jest.fn(async (userId: string, required: string[], requestedScope: typeof scope) => authorizeFeatures(required, {
    grantedFeatures: features,
    scopeAllowed: organizationAllowed && userId === recipientUserId
      && requestedScope.tenantId === scope.tenantId && requestedScope.organizationId === scope.organizationId,
  }))
  const create = jest.fn(async () => undefined)
  const container = {
    resolve(name: string): unknown {
      if (name === 'em') return em
      if (name === 'rbacService' && !missingRbac) return { userHasAllFeatures }
      if (name === 'organizationScopeService' && inheritedOrganizations !== null) return {
        resolve: jest.fn(),
        resolveForRequest: jest.fn(),
        resolveFresh: jest.fn(async () => ({
          acl: { features: [...features], organizations: inheritedOrganizations, isSuperAdmin: false },
          scope: { ...scope, selectedId: scope.organizationId, allowedIds: expandedOrganizationIds, filterIds: expandedOrganizationIds },
        })),
      }
      if (name === 'notificationService') return { create, deleteBySource: jest.fn() }
      if (name === 'authPrincipalService') return {
        principalExists: jest.fn(),
        resolveLabels: jest.fn(),
        listSuperAdminUserIds: jest.fn(),
        filterActiveRoleIds: jest.fn(),
        resolveActiveUserRoleIds: jest.fn(async () => accessKind === 'role' ? ['role-1'] : []),
      }
      throw new Error('[internal] service unavailable')
    },
  }
  const watcherRecipients = () => resolveWatcherRecipients({ em, container, scope, documentId, actorUserId })
  const project = async (kind: 'mention-notification' | 'watch-notification') => {
    const common = { recipientUserId, documentId, documentTitle: 'New private title', ...scope }
    const descriptor: DocumentsProjectionDescriptor = kind === 'mention-notification'
      ? { ...common, kind, commentId, authorUserId: actorUserId }
      : { ...common, kind, notificationType: 'documents.watch.commented', bodyKey: 'documents.notifications.watch.commented.body', sourceEntityType: 'documents:document_comment', sourceEntityId: commentId, linkHref: `/backend/documents/${documentId}` }
    const interceptor = interceptors.find((candidate) => candidate.targetCommand === 'documents.comment.create')!
    await interceptor.afterExecute?.({}, { projections: [descriptor] }, {
      commandId: 'documents.comment.create',
      auth: { sub: actorUserId },
      selectedOrganizationId: scope.organizationId,
      container,
    } as CommandInterceptorContext)
  }
  return {
    em, container, create, userHasAllFeatures, watcherRecipients, project,
    setFeatures: (grants: string[]) => { features = grants },
    denyOrganization: () => { organizationAllowed = false },
    removeRbac: () => { missingRbac = true },
    removeDocument: () => { missingDocument = true },
    grantInheritedOrganization: (grants = ['parent-org'], expanded = ['parent-org', scope.organizationId]) => {
      organizationAllowed = false
      inheritedOrganizations = grants
      expandedOrganizationIds = expanded
    },
  }
}

describe('document notification recipient authorization', () => {
  it.each(accessKinds)('stops fresh watch and mention notifications after view revocation for %s access', async (accessKind) => {
    const current = fixture(accessKind)
    expect(await current.watcherRecipients()).toEqual([recipientUserId])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).toHaveBeenCalledTimes(2)
    current.create.mockClear()

    current.setFeatures(accessKind === 'manager' ? ['documents.manage'] : [])
    expect(await current.watcherRecipients()).toEqual([])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
    expect(current.userHasAllFeatures).toHaveBeenCalledWith(recipientUserId, ['documents.view'], scope)
  })

  it.each(['documents.*', '*'])('preserves effective wildcard grant %s for delivery', async (grant) => {
    const current = fixture()
    current.setFeatures([grant])
    expect(await current.watcherRecipients()).toEqual([recipientUserId])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).toHaveBeenCalledTimes(2)
    expect(current.create).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId, titleVariables: { documentTitle: 'New private title' } }), scope)
  })

  it.each(accessKinds)('fails closed without RBAC for %s access', async (accessKind) => {
    const current = fixture(accessKind)
    current.removeRbac()
    await expect(resolveUserAccess(current.em, documentId, scope, recipientUserId, current.container)).resolves.toBeNull()
    expect(await current.watcherRecipients()).toEqual([])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
  })

  it('rechecks the organization even for an owner with wildcard grants', async () => {
    const current = fixture('owner')
    current.setFeatures(['*'])
    current.denyOrganization()
    expect(await current.watcherRecipients()).toEqual([])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
  })

  it('suppresses prepared notifications if the document disappears before persistence', async () => {
    const current = fixture('owner')
    expect(await current.watcherRecipients()).toEqual([recipientUserId])
    current.removeDocument()
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
  })

  it('keeps commands successful and notifications suppressed when authorization fails', async () => {
    const current = fixture('owner')
    current.userHasAllFeatures.mockRejectedValue(new Error('[internal] authorization unavailable'))
    expect(await current.watcherRecipients()).toEqual([])
    await expect(current.project('mention-notification')).resolves.toBeUndefined()
    await expect(current.project('watch-notification')).resolves.toBeUndefined()
    expect(current.create).not.toHaveBeenCalled()
  })

  it.each(['direct', 'role'] as const)('keeps the retained %s editor tier separate from effective view access', async (accessKind) => {
    const current = fixture(accessKind, 'editor')
    current.setFeatures([])
    await expect(resolveUserDocumentTier(current.em, documentId, scope, recipientUserId, current.container)).resolves.toBe('editor')
    await expect(resolveUserAccess(current.em, documentId, scope, recipientUserId, current.container)).resolves.toBeNull()
  })

  it('preserves inherited parent organization access and still enforces view revocation', async () => {
    const current = fixture('owner')
    current.grantInheritedOrganization()
    expect(await current.watcherRecipients()).toEqual([recipientUserId])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).toHaveBeenCalledTimes(2)
    current.create.mockClear()

    current.setFeatures([])
    expect(await current.watcherRecipients()).toEqual([])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
  })

  it.each([
    { grants: [], expanded: [scope.organizationId] },
    { grants: ['parent-org'], expanded: [scope.organizationId] },
    { grants: ['other-org'], expanded: ['parent-org', scope.organizationId] },
  ])('rejects empty or unresolved organization grants: $grants', async ({ grants, expanded }) => {
    const current = fixture('owner')
    current.grantInheritedOrganization(grants, expanded)
    expect(await current.watcherRecipients()).toEqual([])
    await current.project('mention-notification')
    await current.project('watch-notification')
    expect(current.create).not.toHaveBeenCalled()
  })
})
