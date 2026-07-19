import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { z } from 'zod'
import {
  deriveDocumentCapabilities,
  type DocumentCapabilities,
} from '../lib/capabilities'
import { resolveSubjectAccess } from '../lib/permissions'
import { Document } from '../data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasResolvedDocumentsOrganizationAccess } from '../lib/organizationAccess'
import { resolveOrganizationScopeService } from '../lib/platformServices'

export type DocumentsCommandScope = {
  tenantId: string
  organizationId: string
}

/**
 * Reuse an ambient command transaction when one is supplied. This keeps
 * composed command writes, row locks, and audit snapshots inside the caller's
 * atomic boundary instead of silently forking an independent transaction.
 */
export function resolveDocumentsCommandEntityManager(ctx: CommandRuntimeContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

type CurrentAcl = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

type RbacServiceLike = {
  invalidateUserCache: (userId: string) => Promise<void>
  loadAcl: (
    userId: string,
    scope: { tenantId: string; organizationId: string },
  ) => Promise<CurrentAcl>
}

const actorUuidSchema = z.string().uuid()

function normalizeActorUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return actorUuidSchema.safeParse(normalized).success ? normalized : null
}

function isApiKeyAuth(auth: NonNullable<CommandRuntimeContext['auth']>): boolean {
  return auth.isApiKey === true || auth.sub.trim().startsWith('api_key:')
}

export function resolveDocumentsCommandScope(
  ctx: CommandRuntimeContext,
  input: DocumentsCommandScope,
): DocumentsCommandScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  if (input.tenantId !== tenantId || input.organizationId !== organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  return { tenantId, organizationId }
}

export function resolveDocumentsCommandActor(ctx: CommandRuntimeContext): string {
  const auth = ctx.auth
  if (!auth) throw new CrudHttpError(403, { error: 'Forbidden' })

  const subject = auth.sub.trim()
  if (isApiKeyAuth(auth)) {
    const keyId = normalizeActorUuid(auth.keyId)
    if (!keyId || subject !== `api_key:${keyId}`) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    if (auth.userId === undefined || auth.userId === null) return keyId
    const backingUserId = normalizeActorUuid(auth.userId)
    if (backingUserId) return backingUserId
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }

  const actorUserId = normalizeActorUuid(subject)
  const claimedUserId = auth.userId === undefined || auth.userId === null
    ? actorUserId
    : normalizeActorUuid(auth.userId)
  if (actorUserId && claimedUserId === actorUserId) return actorUserId
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

function resolveDocumentsCommandAclSubject(ctx: CommandRuntimeContext): string {
  const subject = ctx.auth?.sub?.trim() ?? ''
  if (!subject) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  return subject
}

export async function resolveDocumentsCommandFeatures(
  ctx: CommandRuntimeContext,
  scope: DocumentsCommandScope,
): Promise<string[]> {
  // The RBAC subject and the domain actor are deliberately different for an
  // API key. `auth.sub` identifies the key and therefore its restricted role
  // grants, while `auth.userId` (when present) is only the backing user used
  // for ownership/share/audit fields. Loading ACL with the backing user would
  // silently promote a restricted key to all of that user's permissions.
  const aclSubject = resolveDocumentsCommandAclSubject(ctx)
  let rbacService: RbacServiceLike
  try {
    rbacService = ctx.container.resolve('rbacService') as RbacServiceLike
  } catch {
    return []
  }
  // `loadAcl` is intentionally cached for ordinary request guards. Commands
  // need a post-lock decision: evict both the distributed user entry and the
  // service's in-memory superadmin bit before reloading, so the request's
  // feature/role snapshot and a five-minute ACL cache cannot outlive a grant
  // revocation that completed while this command waited for its aggregate.
  if (
    typeof rbacService.invalidateUserCache !== 'function'
    || typeof rbacService.loadAcl !== 'function'
  ) {
    return []
  }
  await rbacService.invalidateUserCache(aclSubject)
  const acl = await rbacService.loadAcl(aclSubject, scope)
  if (acl.isSuperAdmin) return ['*']
  if (!hasResolvedDocumentsOrganizationAccess(acl, scope.organizationId)) {
    // Organization grants are hierarchical. Re-resolve the selected child
    // against the freshly loaded parent grants instead of comparing raw ids,
    // while replacing any stale token superadmin bit with the live ACL value.
    const organizationScopeService = resolveOrganizationScopeService(ctx.container)
    if (!organizationScopeService) return []
    const organizationScope = await organizationScopeService.resolve({
      auth: {
        ...(ctx.auth ?? {}),
        sub: aclSubject,
        tenantId: scope.tenantId,
        orgId: ctx.auth?.orgId ?? scope.organizationId,
        isSuperAdmin: false,
      } as NonNullable<AuthContext>,
      selectedId: scope.organizationId,
      tenantId: scope.tenantId,
      freshAcl: true,
    })
    if (!hasResolvedDocumentsOrganizationAccess(acl, scope.organizationId, organizationScope)) {
      return []
    }
  }
  return Array.from(new Set(Array.isArray(acl.features) ? acl.features : []))
}

export async function assertDocumentCommandCanEdit(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  documentId: string,
  scope: DocumentsCommandScope,
): Promise<string[]> {
  return assertDocumentCommandCapability(ctx, em, documentId, scope, 'canEdit')
}

export async function assertDocumentCommandCapability(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  documentId: string,
  scope: DocumentsCommandScope,
  capability: keyof Pick<
    DocumentCapabilities,
    'canView' | 'canComment' | 'canEdit' | 'canShare' | 'canDelete'
  >,
): Promise<string[]> {
  const features = await resolveDocumentsCommandFeatures(ctx, scope)
  // Role shares must use current assignments as well. The subject-aware
  // resolver reloads UserRole rows for users and the key's own active roles
  // for API keys, so neither token claims nor a backing user's broader roles
  // can survive the aggregate lock.
  const relationshipTier = await resolveSubjectAccess(
    em,
    documentId,
    scope,
    {
      subject: resolveDocumentsCommandAclSubject(ctx),
      userId: resolveDocumentsCommandActor(ctx),
    },
    ctx.container,
  )
  // Routes enforce the archived clamp with a specific 403; this command-level
  // derivation repeats it so redo and any future non-route dispatch cannot
  // mutate an archived document.
  const documentRow = await findOneWithDecryption(
    em,
    Document,
    { id: documentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['id', 'archivedAt'], filters: false },
    scope,
  )
  const capabilities = deriveDocumentCapabilities({
    relationshipTier,
    managerOverride: hasAllFeatures(['documents.manage'], features),
    archived: documentRow?.archivedAt != null,
    userFeatures: features,
  })
  if (!capabilities[capability]) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  return features
}

export function assertCommandFeature(features: readonly string[], feature: string): void {
  if (!hasAllFeatures([feature], Array.from(features))) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}
