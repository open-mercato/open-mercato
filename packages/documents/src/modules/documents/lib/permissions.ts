import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Document, DocumentShare } from '../data/entities'
import {
  resolveApiKeyPrincipalService,
  resolveAuthPrincipalService,
  resolveDocumentsRbacService,
  type DocumentsServiceContainer,
} from './platformServices'

export type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

export const TIER_RANK: Record<DocumentTier, number> = {
  owner: 3,
  editor: 2,
  commenter: 1,
  viewer: 0,
}

type DocumentsPermissionContext = NonNullable<AuthContext> & {
  features?: string[]
  roleIds?: string[]
  resolvedRoleIds?: string[]
  organizationId?: string | null
}

function resolveUserId(ctx: AuthContext): string | null {
  if (!ctx) return null
  if (typeof ctx.userId === 'string' && ctx.userId.trim().length > 0) return ctx.userId
  if (typeof ctx.sub === 'string' && ctx.sub.trim().length > 0 && !ctx.sub.startsWith('api_key:')) return ctx.sub
  return null
}

function resolveOrganizationId(ctx: DocumentsPermissionContext): string | null {
  if (typeof ctx.organizationId === 'string' && ctx.organizationId.trim().length > 0) {
    return ctx.organizationId
  }
  if (typeof ctx.orgId === 'string' && ctx.orgId.trim().length > 0) return ctx.orgId
  return null
}

function normalizeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0),
    ),
  )
}

function hasDocumentsManage(ctx: DocumentsPermissionContext): boolean {
  if (ctx.isSuperAdmin === true) return true
  const features = normalizeStrings(ctx.features)
  return hasAllFeatures(['documents.manage'], features)
}

export async function resolveActiveUserRoleIds(
  container: DocumentsServiceContainer | null | undefined,
  scope: { tenantId: string; organizationId: string },
  userId: string,
): Promise<string[]> {
  const service = resolveAuthPrincipalService(container)
  if (!service) return []
  return normalizeStrings(await service.resolveActiveUserRoleIds(userId, scope))
}

export async function resolveActiveSubjectRoleIds(
  container: DocumentsServiceContainer | null | undefined,
  scope: { tenantId: string; organizationId: string },
  subject: string,
): Promise<string[]> {
  if (!subject.startsWith('api_key:')) {
    return resolveActiveUserRoleIds(container, scope, subject)
  }

  const apiKeyId = subject.slice('api_key:'.length).trim()
  if (!apiKeyId) return []
  const apiKeyService = resolveApiKeyPrincipalService(container)
  const authService = resolveAuthPrincipalService(container)
  if (!apiKeyService || !authService) return []
  const assigned = normalizeStrings(await apiKeyService.resolveAssignedRoleIds(apiKeyId, scope))
  if (assigned.length === 0) return []
  return normalizeStrings(await authService.filterActiveRoleIds(assigned, scope))
}

function maxShareTier(shares: DocumentShare[]): DocumentTier | null {
  let best: DocumentTier | null = null
  for (const share of shares) {
    const permission = share.permission
    if (permission !== 'viewer' && permission !== 'commenter' && permission !== 'editor') continue
    if (!best || TIER_RANK[permission] > TIER_RANK[best]) best = permission
  }
  return best
}

export async function resolvePermission(
  em: EntityManager,
  documentId: string,
  ctx: AuthContext,
): Promise<DocumentTier | null> {
  if (!ctx || !ctx.tenantId) return null
  const permissionCtx = ctx as DocumentsPermissionContext
  const organizationId = resolveOrganizationId(permissionCtx)
  if (!organizationId) return null

  const document = await findOneWithDecryption(
    em,
    Document,
    {
      id: documentId,
      tenantId: ctx.tenantId,
      organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId },
  )
  if (!document) return null

  const userId = resolveUserId(ctx)
  if ((userId && document.ownerUserId === userId) || hasDocumentsManage(permissionCtx)) {
    return 'owner'
  }
  if (!userId) return null

  // Never trust role ids/names carried by the request token. Role shares are
  // resolved from active UserRole links to active roles in the current tenant.
  // Only consume the server-projected role set. Raw token roleIds/roles are
  // authentication hints and can outlive an assignment revocation.
  const roleIds = normalizeStrings(permissionCtx.resolvedRoleIds)
  const principals: Array<FilterQuery<DocumentShare>> = [
    { principalType: 'user', principalId: userId },
  ]
  if (roleIds.length > 0) {
    principals.push({ principalType: 'role', principalId: { $in: roleIds } } as FilterQuery<DocumentShare>)
  }

  const shares = await findWithDecryption(
    em,
    DocumentShare,
    {
      documentId,
      tenantId: ctx.tenantId,
      organizationId,
      deletedAt: null,
      $or: principals,
    } as FilterQuery<DocumentShare>,
    undefined,
    { tenantId: ctx.tenantId, organizationId },
  )

  return maxShareTier(shares)
}

export async function loadScopedDocument(
  em: EntityManager,
  documentId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<Document | null> {
  return findOneWithDecryption(
    em,
    Document,
    {
      id: documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

/**
 * Resolve one user's tier against an already scoped document. Callers that
 * evaluate many users for the same document load it once and reuse it here
 * instead of re-reading the identical row per user.
 */
export async function resolveLoadedDocumentUserAccess(
  em: EntityManager,
  document: Document,
  scope: { tenantId: string; organizationId: string },
  userId: string,
  container?: DocumentsServiceContainer | null,
): Promise<DocumentTier | null> {
  if (document.ownerUserId === userId) return 'owner'
  if (await resolveDocumentsRbacService(container)?.userHasAllFeatures(
    userId,
    ['documents.manage'],
    scope,
  )) return 'owner'

  const roleIds = await resolveActiveUserRoleIds(container, scope, userId)

  const principals: Array<FilterQuery<DocumentShare>> = [
    { principalType: 'user', principalId: userId },
  ]
  if (roleIds.length > 0) {
    principals.push({ principalType: 'role', principalId: { $in: roleIds } } as FilterQuery<DocumentShare>)
  }

  const shares = await findWithDecryption(
    em,
    DocumentShare,
    {
      documentId: document.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      $or: principals,
    } as FilterQuery<DocumentShare>,
    undefined,
    scope,
  )

  return maxShareTier(shares)
}

export async function resolveUserAccess(
  em: EntityManager,
  documentId: string,
  scope: { tenantId: string; organizationId: string },
  userId: string,
  container?: DocumentsServiceContainer | null,
): Promise<DocumentTier | null> {
  const document = await loadScopedDocument(em, documentId, scope)
  if (!document) return null
  return resolveLoadedDocumentUserAccess(em, document, scope, userId, container)
}

export async function resolveSubjectAccess(
  em: EntityManager,
  documentId: string,
  scope: { tenantId: string; organizationId: string },
  identity: { subject: string; userId: string },
  container?: DocumentsServiceContainer | null,
): Promise<DocumentTier | null> {
  const document = await findOneWithDecryption(
    em,
    Document,
    {
      id: documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!document) return null
  if (document.ownerUserId === identity.userId) return 'owner'

  const roleIds = await resolveActiveSubjectRoleIds(container, scope, identity.subject)
  const principals: Array<FilterQuery<DocumentShare>> = [
    { principalType: 'user', principalId: identity.userId },
  ]
  if (roleIds.length > 0) {
    principals.push({ principalType: 'role', principalId: { $in: roleIds } } as FilterQuery<DocumentShare>)
  }

  const shares = await findWithDecryption(
    em,
    DocumentShare,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      $or: principals,
    } as FilterQuery<DocumentShare>,
    undefined,
    scope,
  )
  return maxShareTier(shares)
}

export function hasTier(tier: DocumentTier | null, required: DocumentTier): boolean {
  if (!tier) return false
  return TIER_RANK[tier] >= TIER_RANK[required]
}

export async function assertTier(
  em: EntityManager,
  documentId: string,
  ctx: AuthContext,
  required: DocumentTier,
): Promise<DocumentTier> {
  const tier = await resolvePermission(em, documentId, ctx)
  if (!tier || !hasTier(tier, required)) {
    throw forbidden('Forbidden')
  }
  return tier
}
