import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { Document, DocumentShare } from '../data/entities'

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function hasDocumentsManage(ctx: DocumentsPermissionContext): boolean {
  if (ctx.isSuperAdmin === true) return true
  const features = normalizeStrings(ctx.features)
  return hasAllFeatures(['documents.manage'], features)
}

async function resolveRoleIds(em: EntityManager, ctx: DocumentsPermissionContext): Promise<string[]> {
  const explicitRoleIds = normalizeStrings(ctx.roleIds)
  const roleValues = normalizeStrings(ctx.roles)
  const uuidRoleValues = roleValues.filter(isUuid)
  const roleNames = roleValues.filter((value) => !isUuid(value))
  const initialIds = Array.from(new Set([...explicitRoleIds, ...uuidRoleValues]))
  if (!roleNames.length || !ctx.tenantId) return initialIds

  const roles = await em.find(
    Role,
    {
      tenantId: ctx.tenantId,
      deletedAt: null,
      name: { $in: roleNames },
    } as FilterQuery<Role>,
    { fields: ['id'] as const },
  )
  return Array.from(new Set([...initialIds, ...roles.map((role) => String(role.id))]))
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

  const document = await em.findOne(Document, {
    id: documentId,
    tenantId: ctx.tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!document) return null

  const userId = resolveUserId(ctx)
  if ((userId && document.ownerUserId === userId) || hasDocumentsManage(permissionCtx)) {
    return 'owner'
  }
  if (!userId) return null

  const roleIds = await resolveRoleIds(em, permissionCtx)
  const principals: Array<FilterQuery<DocumentShare>> = [
    { principalType: 'user', principalId: userId },
  ]
  if (roleIds.length > 0) {
    principals.push({ principalType: 'role', principalId: { $in: roleIds } } as FilterQuery<DocumentShare>)
  }

  const shares = await em.find(DocumentShare, {
    documentId,
    tenantId: ctx.tenantId,
    organizationId,
    deletedAt: null,
    $or: principals,
  } as FilterQuery<DocumentShare>)

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
