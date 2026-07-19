import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { documentCreateSchema, documentEntityTypeSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { resolveUserLabels } from '../lib/userLabels'
import { deriveDocumentCapabilities } from '../lib/capabilities'
import { getVisibleDocumentPage } from '../lib/visibility'
import { loadDocumentShareCounts } from '../lib/shareCounts'
import { loadDocumentFavoriteIds } from '../lib/favorites'
import { getEntityRegistryEntry } from '../lib/entityRegistry'
import { verifyEntityRegistryTargetAccess } from '../lib/entityRegistry.server'
import { isDocumentEntityRegistryModuleEnabled } from '../lib/entityRegistryAvailability.server'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
} from './_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from './_commands'
import type { DocumentCreateCommandInput } from '../commands/document-crud'

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().optional(),
  id: z.string().uuid().optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  favorite: z.string().optional().transform((value) => parseBooleanWithDefault(value, false)),
  folderId: z.string().uuid().optional().nullable(),
  entityType: documentEntityTypeSchema.optional(),
  entityId: z.string().uuid().optional(),
}).superRefine((query, context) => {
  if (Boolean(query.entityType) !== Boolean(query.entityId)) {
    context.addIssue({
      code: 'custom',
      message: 'documents.validation.links.entityFilterPairRequired',
    })
  }
})

const capabilitiesSchema = z.object({
  canView: z.boolean(),
  canComment: z.boolean(),
  canEdit: z.boolean(),
  canShare: z.boolean(),
  canDelete: z.boolean(),
  canCreate: z.boolean(),
  canManageTemplates: z.boolean(),
  canArchive: z.boolean(),
  canDuplicate: z.boolean(),
})

const collectionCapabilitiesSchema = z.object({
  canCreateDocument: z.boolean(),
  canCreateFolder: z.boolean(),
  canLinkDocuments: z.boolean(),
  canInstantiateTemplate: z.boolean(),
  canManageTemplates: z.boolean(),
})

const documentListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  folderId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  ownerLabel: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  isActive: z.boolean(),
  archivedAt: z.string().nullable(),
  isFavorite: z.boolean(),
  sharedWithCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  relationshipTier: z.enum(['owner', 'editor', 'commenter', 'viewer']).nullable(),
  capabilities: capabilitiesSchema,
})

const listResponseSchema = z.object({
  items: z.array(documentListItemSchema),
  collectionCapabilities: collectionCapabilitiesSchema,
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

const createResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.create'] },
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean
  }
  return false
}

function readDate(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    const date = value instanceof Date
      ? value
      : typeof value === 'string' && value.length > 0
        ? new Date(value)
        : null
    if (date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date(0).toISOString()
}

function readNullableDate(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value === null || value === undefined) continue
    const date = value instanceof Date
      ? value
      : typeof value === 'string' && value.length > 0
        ? new Date(value)
        : null
    if (date && !Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const url = new URL(request.url)
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))

    let relationFilter: { entityType: z.infer<typeof documentEntityTypeSchema>; entityId: string } | null = null
    if (query.entityType && query.entityId) {
      const registryEntry = getEntityRegistryEntry(query.entityType)
      if (
        !registryEntry
        || !isDocumentEntityRegistryModuleEnabled(registryEntry)
        || !hasDocumentsFeature(ctx.auth, registryEntry.requiredFeature)
      ) {
        throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
      }
      const verifiedTarget = await verifyEntityRegistryTargetAccess(request, {
        entityType: query.entityType,
        entityId: query.entityId,
      })
      relationFilter = {
        entityType: query.entityType,
        entityId: verifiedTarget.id,
      }
    }

    const actorUserId = resolveActorUserId(ctx.auth)
    const managerOverride = hasDocumentsFeature(ctx.auth, 'documents.manage')
    const visiblePage = await getVisibleDocumentPage({
      em: ctx.em,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: actorUserId,
      roleIds: ctx.auth.roleIds,
      managerOverride,
      page: query.page,
      pageSize: query.pageSize,
      id: query.id ?? null,
      archived: query.archived,
      favoriteUserId: query.favorite ? actorUserId : null,
      search: query.search ?? null,
      folderId: query.folderId ?? null,
      relationFilter,
    })
    const orderedIds = visiblePage.rows.map((row) => row.id)
    const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
    const hydration = orderedIds.length > 0
      ? await queryEngine.query<Record<string, unknown>>(DOCUMENTS_ENTITY_IDS.document, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          filters: { id: { $in: orderedIds } },
          page: { page: 1, pageSize: orderedIds.length },
          extensions: {
            userId: actorUserId,
            container: ctx.container,
            userFeatures: ctx.auth.features,
            resolve: <T = unknown>(name: string) => ctx.container.resolve(name) as T,
          },
        })
      : { items: [] as Record<string, unknown>[] }
    const hydratedById = new Map(
      hydration.items
        .map((item) => [readString(item, 'id'), item] as const)
        .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[0] !== null),
    )
    const pageDocuments = orderedIds
      .map((id) => hydratedById.get(id) ?? null)
      .filter((item): item is Record<string, unknown> => item !== null)
    const ownerLabels = await resolveUserLabels(
      ctx.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      pageDocuments
        .map((document) => readString(document, 'ownerUserId', 'owner_user_id'))
        .filter((id): id is string => id !== null),
    )
    const shareCounts = await loadDocumentShareCounts(
      ctx.em,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      orderedIds,
    )
    const favoriteDocumentIds = await loadDocumentFavoriteIds(
      ctx.em,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: actorUserId },
      orderedIds,
    )
    const visibleRowsById = new Map(visiblePage.rows.map((row) => [row.id, row]))
    const items = pageDocuments.map((document) => {
      const id = readString(document, 'id') ?? ''
      const ownerUserId = readString(document, 'ownerUserId', 'owner_user_id') ?? ''
      const visibleRow = visibleRowsById.get(id)
      const relationshipTier = visibleRow?.relationshipTier ?? null
      const archivedAt = readNullableDate(document, 'archivedAt', 'archived_at')
      return {
        id,
        title: readString(document, 'title') ?? '',
        folderId: readString(document, 'folderId', 'folder_id'),
        ownerUserId,
        ownerLabel: ownerLabels.get(ownerUserId)?.label ?? null,
        createdByUserId: readString(document, 'createdByUserId', 'created_by_user_id') ?? '',
        isActive: readBoolean(document, 'isActive', 'is_active'),
        archivedAt,
        isFavorite: favoriteDocumentIds.has(id),
        sharedWithCount: shareCounts.get(id) ?? 0,
        createdAt: readDate(document, 'createdAt', 'created_at'),
        updatedAt: readDate(document, 'updatedAt', 'updated_at'),
        relationshipTier,
        capabilities: deriveDocumentCapabilities({
          relationshipTier,
          managerOverride,
          archived: archivedAt !== null,
          userFeatures: ctx.auth.features,
        }),
      }
    })

    return NextResponse.json({
      items,
      collectionCapabilities: {
        canCreateDocument: hasDocumentsFeature(ctx.auth, 'documents.create'),
        canCreateFolder: hasDocumentsFeature(ctx.auth, 'documents.edit'),
        canLinkDocuments: hasDocumentsFeature(ctx.auth, 'documents.edit'),
        canInstantiateTemplate:
          hasDocumentsFeature(ctx.auth, 'documents.create')
          && hasDocumentsFeature(ctx.auth, 'documents.edit'),
        canManageTemplates: hasDocumentsFeature(ctx.auth, 'documents.templates.manage'),
      },
      total: visiblePage.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(visiblePage.total / query.pageSize)),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.list')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.create'])
    const body = await readBody(request)
    const input = documentCreateSchema.parse(body)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
    })

    const commandInput: DocumentCreateCommandInput = {
      ...input,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: randomUUID(),
      contentId: randomUUID(),
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      DocumentCreateCommandInput,
      { id: string; updatedAt: string }
    >('documents.document.create', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
    })

    const response = NextResponse.json(
      { id: result.id, updatedAt: result.updatedAt },
      { status: 201 },
    )
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document collection',
  methods: {
    GET: {
      summary: 'List visible documents',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Visible document metadata', schema: listResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document',
      requestBody: { contentType: 'application/json', schema: documentCreateSchema },
      responses: [{ status: 201, description: 'Document created', schema: createResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, POST }
