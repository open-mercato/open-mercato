import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
  type CrudMutationGuardValidationSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import {
  Document,
  DocumentContent,
  DocumentFolder,
  DocumentShare,
} from '../data/entities'

export type DocumentsAuthContext = NonNullable<AuthContext> & {
  features: string[]
  roleIds: string[]
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

export type SearchIndexerLike = {
  indexRecordById: (params: {
    entityId: string
    recordId: string
    tenantId: string
    organizationId?: string | null
  }) => Promise<unknown>
  deleteRecord?: (params: {
    entityId: string
    recordId: string
    tenantId: string
    organizationId?: string | null
  }) => Promise<unknown>
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

export const routeErrorSchema = z.object({ error: z.string() })

export const okResponseSchema = z.object({ ok: z.boolean() })

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

function resolveSelectedOrganization(
  auth: NonNullable<AuthContext>,
  scope: { selectedId?: string | null; filterIds?: string[] | null; allowedIds?: string[] | null; tenantId?: string | null } | null,
): string | null {
  const allowed = scope?.filterIds ?? scope?.allowedIds ?? (auth.orgId ? [auth.orgId] : null)
  const organizationId = scope?.selectedId ?? auth.orgId ?? (Array.isArray(allowed) && allowed.length > 0 ? allowed[0] : null)
  if (!organizationId) return null
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(organizationId)) return null
  return organizationId
}

async function resolveRoleIds(em: EntityManager, auth: NonNullable<AuthContext>): Promise<string[]> {
  const explicitRoleIds = normalizeStrings((auth as { roleIds?: unknown }).roleIds)
  const roleValues = normalizeStrings(auth.roles)
  const uuidRoleValues = roleValues.filter(isUuid)
  const roleNames = roleValues.filter((value) => !isUuid(value))
  const initialIds = Array.from(new Set([...explicitRoleIds, ...uuidRoleValues]))
  if (!roleNames.length || !auth.tenantId) return initialIds

  const roles = await em.find(
    Role,
    {
      tenantId: auth.tenantId,
      deletedAt: null,
      name: { $in: roleNames },
    } as FilterQuery<Role>,
    { fields: ['id'] as const },
  )
  return Array.from(new Set([...initialIds, ...roles.map((role) => String(role.id))]))
}

function mergeFeatures(auth: NonNullable<AuthContext>, aclFeatures: string[], aclIsSuperAdmin: boolean): string[] {
  if (auth.isSuperAdmin === true || aclIsSuperAdmin) return ['*']
  return Array.from(new Set([...aclFeatures, ...normalizeStrings((auth as { features?: unknown }).features)]))
}

export function hasDocumentsFeature(auth: DocumentsAuthContext, feature: string): boolean {
  if (auth.isSuperAdmin === true) return true
  return hasAllFeatures([feature], auth.features)
}

export function hasAnyDocumentsFeature(auth: DocumentsAuthContext, features: string[]): boolean {
  if (auth.isSuperAdmin === true) return true
  return features.some((feature) => hasAllFeatures([feature], auth.features))
}

export async function resolveDocumentsContext(
  request: Request,
  requiredFeatures: string[],
): Promise<DocumentsRouteContext> {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = scope?.tenantId ?? auth.tenantId
  const organizationId = resolveSelectedOrganization(auth, scope)
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Organization context is required' })
  }

  const rbacService = container.resolve('rbacService') as RbacServiceLike
  const acl = await rbacService.loadAcl(auth.sub, { tenantId, organizationId })
  const roleIds = await resolveRoleIds(em, auth)
  const documentsAuth: DocumentsAuthContext = {
    ...auth,
    tenantId,
    orgId: organizationId,
    organizationId,
    roleIds,
    features: mergeFeatures(auth, acl.features, acl.isSuperAdmin),
    isSuperAdmin: auth.isSuperAdmin === true || acl.isSuperAdmin,
  }

  if (!hasAnyDocumentsFeature(documentsAuth, requiredFeatures)) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
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

export function resolveActorUserId(auth: DocumentsAuthContext): string {
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0 && !auth.sub.startsWith('api_key:')) return auth.sub
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  return (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
}

export function handleDocumentsRouteError(error: unknown, label: string): Response {
  if (isCrudHttpError(error)) {
    return NextResponse.json(error.body, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
  }
  console.error(`[documents] ${label} failed`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function loadScopedDocument(ctx: DocumentsRouteContext, id: string): Promise<Document> {
  const document = await ctx.em.findOne(Document, {
    id,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
  return document
}

export async function loadScopedFolder(ctx: DocumentsRouteContext, id: string): Promise<DocumentFolder> {
  const folder = await ctx.em.findOne(DocumentFolder, {
    id,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!folder) throw new CrudHttpError(404, { error: 'Folder not found' })
  return folder
}

export async function assertFolderWritable(ctx: DocumentsRouteContext, folder: DocumentFolder): Promise<void> {
  const userId = resolveActorUserId(ctx.auth)
  if (folder.ownerUserId === userId || hasDocumentsFeature(ctx.auth, 'documents.manage')) return
  throw new CrudHttpError(403, { error: 'Forbidden' })
}

export async function loadScopedShare(
  ctx: DocumentsRouteContext,
  documentId: string,
  shareId: string,
): Promise<DocumentShare> {
  const share = await ctx.em.findOne(DocumentShare, {
    id: shareId,
    documentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!share) throw new CrudHttpError(404, { error: 'Share not found' })
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

export function resolveSearchIndexer(container: AwilixContainer): SearchIndexerLike {
  const candidate = container.resolve('searchIndexer') as Partial<SearchIndexerLike> | null
  if (!candidate || typeof candidate.indexRecordById !== 'function') {
    throw new Error('[internal] searchIndexer is not available')
  }
  return candidate as SearchIndexerLike
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
