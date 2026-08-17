import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import {
  ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
  resolveActiveOrganizationId,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
  type CrudMutationGuardValidationSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  Document,
  DocumentContent,
  DocumentFolder,
  DocumentShare,
} from '../data/entities'
import {
  deriveDocumentCapabilities,
  type DocumentCapabilities,
} from '../lib/capabilities'
import {
  resolveActiveSubjectRoleIds,
  resolvePermission,
  type DocumentTier,
} from '../lib/permissions'
import { hasResolvedDocumentsOrganizationAccess } from '../lib/organizationAccess'
import { containsCanonicalUuid } from '../lib/displayLabels'
import {
  DOCUMENTS_JSON_BODY_LIMITS,
  readBoundedJsonBody,
} from '../lib/requestBody'
import { resolveOrganizationScopeService } from '../lib/platformServices'

const logger = createLogger('documents').child({ component: 'api' })

export type DocumentsAuthContext = NonNullable<AuthContext> & {
  features: string[]
  roleIds: string[]
  resolvedRoleIds: string[]
  organizationId: string
}

export type DocumentsRouteContext = {
  container: AwilixContainer
  em: EntityManager
  auth: DocumentsAuthContext
  tenantId: string
  organizationId: string
  request: Request
}

type RbacServiceLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{
    isSuperAdmin: boolean
    features: string[]
    organizations: string[] | null
  }>
}

export type MutationGuardResult = CrudMutationGuardValidationSuccess | null

export type DocumentCapabilityProjection = {
  relationshipTier: DocumentTier | null
  capabilities: DocumentCapabilities
}

export const routeErrorSchema = z.object({ error: z.string() })

const actorUuidSchema = z.string().uuid()

export const ROUTE_ERROR_TRANSLATIONS: Record<string, { key: string; fallback: string }> = {
  Unauthorized: { key: 'api.errors.unauthorized', fallback: 'Unauthorized' },
  Forbidden: { key: 'api.errors.forbidden', fallback: 'Forbidden' },
  'Organization context is required': {
    key: 'documents.errors.organizationRequired',
    fallback: 'Organization context is required',
  },
  'Validation failed': { key: 'api.errors.invalidPayload', fallback: 'Invalid payload.' },
  'Internal server error': { key: 'api.errors.internal', fallback: 'Internal server error' },
  'Record changed by another user': {
    key: 'documents.errors.recordChanged',
    fallback: 'Record changed by another user',
  },
  'Document not found': { key: 'documents.documents.notFound', fallback: 'Document not found.' },
  'documents.content.notFound': {
    key: 'documents.content.notFound',
    fallback: 'Document content not found.',
  },
  'documents.versions.notFound': {
    key: 'documents.versions.notFound',
    fallback: 'Version not found.',
  },
  'documents.folders.error.invalidPlacement': {
    key: 'documents.folders.error.invalidPlacement',
    fallback: 'This folder cannot be placed there.',
  },
  'Folder not found': { key: 'documents.folders.notFound', fallback: 'Folder not found.' },
  'Share not found': { key: 'documents.share.notFound', fallback: 'Share not found.' },
  'Comment not found': { key: 'documents.comments.notFound', fallback: 'Comment not found.' },
  'Document comment limit reached': {
    key: 'documents.comments.limitExceeded',
    fallback: 'This document has reached its comment limit.',
  },
  'Document version history storage limit exceeded': {
    key: 'documents.versions.quotaExceeded',
    fallback: 'Version history could not retain this snapshot within the document storage limit.',
  },
  'documents.errors.requestBodyTooLarge': {
    key: 'documents.errors.requestBodyTooLarge',
    fallback: 'Request body is too large.',
  },
  'Share principal not found in this organization': {
    key: 'documents.share.principalNotFound',
    fallback: 'Share principal not found in this organization',
  },
  'Private attachment partition is not configured': {
    key: 'documents.attachments.partitionUnavailable',
    fallback: 'Private attachment partition is not configured',
  },
  'Expected multipart/form-data': {
    key: 'documents.attachments.multipartRequired',
    fallback: 'Expected multipart/form-data',
  },
  'File is required': { key: 'documents.attachments.fileRequired', fallback: 'File is required' },
  'Attachment exceeds the maximum upload size.': {
    key: 'documents.attachments.tooLarge',
    fallback: 'Attachment exceeds the maximum upload size.',
  },
  'Executable file types are not allowed as attachments.': {
    key: 'documents.attachments.executableBlocked',
    fallback: 'Executable file types are not allowed as attachments.',
  },
  'Active content uploads are not allowed.': {
    key: 'documents.attachments.activeContentBlocked',
    fallback: 'Active content uploads are not allowed.',
  },
  'Attachment storage quota exceeded for this tenant.': {
    key: 'documents.attachments.quotaExceeded',
    fallback: 'Attachment storage quota exceeded for this tenant.',
  },
  'Attachment not found': { key: 'documents.attachments.notFound', fallback: 'Attachment not found' },
  'Partition misconfigured': {
    key: 'documents.attachments.partitionMisconfigured',
    fallback: 'Attachment partition is misconfigured',
  },
  'File not available': {
    key: 'documents.attachments.fileUnavailable',
    fallback: 'File not available',
  },
  'Unsupported format': { key: 'documents.export.unsupportedFormat', fallback: 'Unsupported format' },
  'documents.export.runtimeUnavailable': {
    key: 'documents.export.runtimeUnavailable',
    fallback: 'PDF export is temporarily unavailable.',
  },
  'documents.errors.organizationSelectionInvalid': {
    key: 'documents.errors.organizationSelectionInvalid',
    fallback: 'Your selected organization is no longer available. Please re-select an organization and try again.',
  },
}

const ROUTE_ERROR_KEY_FALLBACKS = Object.fromEntries(
  Object.values(ROUTE_ERROR_TRANSLATIONS).map(({ key, fallback }) => [key, fallback]),
) as Record<string, string>

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

function resolveSelectedOrganization(
  auth: NonNullable<AuthContext>,
  scope: { selectedId?: string | null; filterIds?: string[] | null; allowedIds?: string[] | null; tenantId?: string | null } | null,
): string | null {
  // Every document row carries one organization, so there is no "all
  // organizations" view of this module. When the super-admin switcher clears
  // `auth.orgId`, keep the operator on their own organization (the shared
  // helper refuses the fallback once the tenant override moved them elsewhere)
  // instead of failing every request.
  const activeOrganizationId = resolveActiveOrganizationId(auth)
  const allowed = scope?.filterIds ?? scope?.allowedIds ?? (activeOrganizationId ? [activeOrganizationId] : null)
  const candidates = [
    scope?.selectedId ?? null,
    activeOrganizationId,
    Array.isArray(allowed) && allowed.length > 0 ? allowed[0] : null,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (!Array.isArray(allowed) || allowed.includes(candidate)) return candidate
  }
  return null
}

function readAuthScopeId(auth: NonNullable<AuthContext>, key: 'actorTenantId' | 'actorOrgId'): string | null {
  const value = auth[key]
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function normalizeActorUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return actorUuidSchema.safeParse(normalized).success ? normalized : null
}

function isApiKeyAuth(auth: NonNullable<AuthContext>): boolean {
  return auth.isApiKey === true || auth.sub.trim().startsWith('api_key:')
}

export function hasDocumentsFeature(auth: DocumentsAuthContext, feature: string): boolean {
  if (auth.isSuperAdmin === true) return true
  return hasAllFeatures([feature], auth.features)
}

export function hasAnyDocumentsFeature(auth: DocumentsAuthContext, features: string[]): boolean {
  if (auth.isSuperAdmin === true) return true
  return features.some((feature) => hasAllFeatures([feature], auth.features))
}

export function deriveCapabilitiesForContext(
  ctx: DocumentsRouteContext,
  relationshipTier: DocumentTier | null,
  options: { archived?: boolean } = {},
): DocumentCapabilities {
  return deriveDocumentCapabilities({
    relationshipTier,
    managerOverride: hasDocumentsFeature(ctx.auth, 'documents.manage'),
    archived: options.archived === true,
    userFeatures: ctx.auth.features,
  })
}

export async function resolveDocumentCapabilityProjection(
  ctx: DocumentsRouteContext,
  documentId: string,
  options: { archived?: boolean } = {},
): Promise<DocumentCapabilityProjection> {
  const relationshipTier = await resolvePermission(ctx.em, documentId, ctx.auth)
  return {
    relationshipTier,
    capabilities: deriveCapabilitiesForContext(ctx, relationshipTier, options),
  }
}

export async function loadDocumentArchivedState(
  ctx: DocumentsRouteContext,
  documentId: string,
): Promise<{ archivedAt: Date | null }> {
  const document = await findOneWithDecryption(
    ctx.em,
    Document,
    {
      id: documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    { fields: ['id', 'archivedAt'] },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!document) throw new CrudHttpError(404, { error: 'documents.documents.notFound' })
  return { archivedAt: document.archivedAt ?? null }
}

export async function assertDocumentNotArchived(
  ctx: DocumentsRouteContext,
  documentId: string,
): Promise<void> {
  const state = await loadDocumentArchivedState(ctx, documentId)
  if (state.archivedAt !== null) {
    throw new CrudHttpError(403, { error: 'documents.errors.documentArchived' })
  }
}

export async function resolveDocumentsContext(
  request: Request,
  requiredFeatures: string[],
): Promise<DocumentsRouteContext> {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'api.errors.unauthorized' })
  }

  const authenticatedActorUserId = resolveActorUserId(auth)
  const actorTenantId = readAuthScopeId(auth, 'actorTenantId') ?? auth.tenantId
  const actorOrganizationId = readAuthScopeId(auth, 'actorOrgId') ?? auth.orgId
  const rbacService = container.resolve('rbacService') as RbacServiceLike
  const actorAcl = await rbacService.loadAcl(auth.sub, {
    tenantId: actorTenantId,
    organizationId: actorOrganizationId,
  })
  // Organization scope resolution historically accepts the authenticated
  // superadmin bit to support tenant/org switching. Replace that potentially
  // stale token bit with the live RBAC decision before asking the shared scope
  // resolver to expand parent grants into descendant organizations.
  const scopeAuth = {
    ...auth,
    // API-key authentication validates both keyId and any backing user. Keep
    // the prefixed subject for ACL while projecting its UUID domain actor for
    // ownership/share/audit helpers. An unbound key uses its own key UUID.
    userId: authenticatedActorUserId,
    isSuperAdmin: actorAcl.isSuperAdmin === true,
  }
  const organizationScopeService = resolveOrganizationScopeService(container)
  if (!organizationScopeService) {
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }
  const scope = await organizationScopeService.resolveForRequest({ auth: scopeAuth, request })
  // The caller explicitly selected an organization that no longer resolves to a
  // real, accessible org (stale selected-org cookie after a delete or an access
  // loss). The scope resolver falls back to another allowed org, so continuing
  // would silently read and write against an organization the caller never
  // chose. Fail loud on every documents operation instead — the same contract
  // `makeCrudRoute` enforces via `rejectInvalidOrgSelection` (#3936).
  if (scope?.selectionRejected) {
    throw new CrudHttpError(422, {
      error: 'documents.errors.organizationSelectionInvalid',
      code: 'organization_selection_invalid',
    })
  }
  const tenantId = scope?.tenantId ?? auth.tenantId
  const organizationId = resolveSelectedOrganization(scopeAuth, scope)
  if (!tenantId) {
    throw new CrudHttpError(400, { error: 'documents.errors.organizationRequired' })
  }
  if (!organizationId) {
    // An unrestricted caller with no resolvable organization (a super-admin
    // viewing a foreign tenant with "all organizations" selected) is a 400, not
    // a 401 (which `apiFetch` would turn into a refresh loop) and not a 403 (the
    // caller is allowed in; they only need to pick an organization). A caller
    // whose grants expand to no organization at all stays a 403.
    const unrestricted = (scope?.filterIds ?? scope?.allowedIds ?? null) === null
    if (unrestricted) {
      throw new CrudHttpError(400, {
        error: 'documents.errors.organizationRequired',
        code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
      })
    }
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }

  const acl = await rbacService.loadAcl(auth.sub, { tenantId, organizationId })
  if (!hasResolvedDocumentsOrganizationAccess(acl, organizationId, scope)) {
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }
  const roleIds = await resolveActiveSubjectRoleIds(
    container,
    { tenantId, organizationId },
    auth.sub,
  )
  const documentsAuth: DocumentsAuthContext = {
    ...scopeAuth,
    tenantId,
    orgId: organizationId,
    organizationId,
    roleIds,
    resolvedRoleIds: roleIds,
    // JWT/trusted-request claims are only authentication hints. The current
    // RBAC projection is authoritative for features and superadmin status so
    // a revoked grant cannot survive in a long-lived token.
    features: acl.isSuperAdmin === true ? ['*'] : normalizeStrings(acl.features),
    isSuperAdmin: acl.isSuperAdmin === true,
  }

  if (!hasAnyDocumentsFeature(documentsAuth, requiredFeatures)) {
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }

  return {
    container,
    em,
    auth: documentsAuth,
    tenantId,
    organizationId,
    request,
  }
}

export function resolveActorUserId(auth: NonNullable<AuthContext>): string {
  const subject = auth.sub.trim()
  if (isApiKeyAuth(auth)) {
    // `keyId` is populated only by successful API-key authentication. Do not
    // recover an actor by parsing an arbitrary prefixed subject when that
    // validated field is absent, malformed, or disagrees with the subject.
    const keyId = normalizeActorUuid(auth.keyId)
    if (!keyId || subject !== `api_key:${keyId}`) {
      throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    }
    if (auth.userId === undefined || auth.userId === null) return keyId
    const backingUserId = normalizeActorUuid(auth.userId)
    if (backingUserId) return backingUserId
    throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
  }

  const actorUserId = normalizeActorUuid(subject)
  const claimedUserId = auth.userId === undefined || auth.userId === null
    ? actorUserId
    : normalizeActorUuid(auth.userId)
  if (actorUserId && claimedUserId === actorUserId) return actorUserId
  throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
}

export async function readBody(
  request: Request,
  maxBytes = DOCUMENTS_JSON_BODY_LIMITS.standard,
): Promise<Record<string, unknown>> {
  return (await readBoundedJsonBody<Record<string, unknown>>(request, maxBytes, {})) ?? {}
}

async function localizeRouteErrorBody(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawError = typeof body.error === 'string' ? body.error : null
  if (!rawError) return body

  if (containsCanonicalUuid(rawError)) {
    const { key, fallback } = ROUTE_ERROR_TRANSLATIONS['Internal server error']!
    try {
      const { translate } = await resolveTranslations()
      return { ...body, error: translate(key, fallback) }
    } catch {
      return { ...body, error: fallback }
    }
  }

  const literal = ROUTE_ERROR_TRANSLATIONS[rawError]
  const key = literal?.key ?? rawError
  const fallback = literal?.fallback ?? ROUTE_ERROR_KEY_FALLBACKS[key]
  if (!key.startsWith('documents.') && !key.startsWith('api.')) return body

  try {
    const { translate } = await resolveTranslations()
    return { ...body, error: translate(key, fallback) }
  } catch {
    return { ...body, error: fallback ?? key }
  }
}

export async function handleDocumentsRouteError(error: unknown, label: string): Promise<Response> {
  if (isCrudHttpError(error)) {
    const body = error.body && typeof error.body === 'object' && !Array.isArray(error.body)
      ? error.body as Record<string, unknown>
      : { error: 'api.errors.internal' }
    return NextResponse.json(await localizeRouteErrorBody(body), { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      await localizeRouteErrorBody({ error: 'api.errors.invalidPayload', details: error.issues }),
      { status: 400 },
    )
  }
  logger.error(`${label} failed`, { err: error })
  return NextResponse.json(
    await localizeRouteErrorBody({ error: 'api.errors.internal' }),
    { status: 500 },
  )
}

export async function loadScopedDocument(ctx: DocumentsRouteContext, id: string): Promise<Document> {
  const document = await findOneWithDecryption(ctx.em, Document, {
    id,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  }, undefined, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  if (!document) throw new CrudHttpError(404, { error: 'documents.documents.notFound' })
  return document
}

export async function loadScopedShare(
  ctx: DocumentsRouteContext,
  documentId: string,
  shareId: string,
): Promise<DocumentShare> {
  const share = await findOneWithDecryption(ctx.em, DocumentShare, {
    id: shareId,
    documentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  }, undefined, { tenantId: ctx.tenantId, organizationId: ctx.organizationId })
  if (!share) throw new CrudHttpError(404, { error: 'documents.share.notFound' })
  return share
}

export function serializeDocument(document: Document): Record<string, unknown> {
  return {
    id: document.id,
    title: document.title,
    folderId: document.folderId ?? null,
    ownerUserId: document.ownerUserId,
    createdByUserId: document.createdByUserId,
    isActive: document.isActive,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  }
}

export function serializeContent(content: DocumentContent | null): Record<string, unknown> {
  return {
    contentHtml: content?.contentHtml ?? '',
    contentText: content?.contentText ?? '',
    updatedAt: content?.updatedAt ? content.updatedAt.toISOString() : null,
  }
}

export function serializeFolder(folder: DocumentFolder): Record<string, unknown> {
  return {
    id: folder.id,
    name: folder.name,
    parentFolderId: folder.parentFolderId ?? null,
    ownerUserId: folder.ownerUserId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}

export function serializeShare(share: DocumentShare): Record<string, unknown> {
  return {
    id: share.id,
    documentId: share.documentId,
    principalType: share.principalType,
    principalId: share.principalId,
    permission: share.permission,
    createdByUserId: share.createdByUserId,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
  }
}

export async function validateMutationGuard(
  ctx: DocumentsRouteContext,
  input: {
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete' | 'custom'
    mutationPayload?: Record<string, unknown> | null
  },
): Promise<MutationGuardResult> {
  const guardResult = await validateCrudMutationGuard(ctx.container, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: resolveActorUserId(ctx.auth),
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    operation: input.operation,
    requestMethod: ctx.request.method,
    requestHeaders: ctx.request.headers,
    mutationPayload: input.mutationPayload ?? null,
  })
  if (guardResult && !guardResult.ok) {
    throw new CrudHttpError(guardResult.status, guardResult.body)
  }
  return guardResult
}

export async function runMutationGuardAfterSuccess(
  ctx: DocumentsRouteContext,
  guardResult: MutationGuardResult,
  input: {
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete' | 'custom'
  },
): Promise<void> {
  if (!guardResult?.shouldRunAfterSuccess) return
  await runCrudMutationGuardAfterSuccess(ctx.container, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: resolveActorUserId(ctx.auth),
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    operation: input.operation,
    requestMethod: ctx.request.method,
    requestHeaders: ctx.request.headers,
    metadata: guardResult.metadata ?? null,
  })
}
