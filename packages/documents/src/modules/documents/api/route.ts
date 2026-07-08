import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Document, DocumentContent, DocumentShare } from '../data/entities'
import { documentCreateSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { emitDocumentsEvent } from '../events'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  loadScopedFolder,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  resolveSearchIndexer,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeDocument,
  validateMutationGuard,
} from './_shared'

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().optional(),
  folderId: z.string().uuid().optional().nullable(),
})

const documentListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  folderId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(documentListItemSchema),
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

function matchesSearch(document: Document, search: string | undefined): boolean {
  if (!search) return true
  return document.title.toLowerCase().includes(search.toLowerCase())
}

async function resolveVisibleDocumentIds(
  documents: Document[],
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
): Promise<Set<string> | null> {
  if (hasDocumentsFeature(ctx.auth, 'documents.manage')) return null
  const userId = resolveActorUserId(ctx.auth)
  const visible = new Set<string>()
  for (const document of documents) {
    if (document.ownerUserId === userId) visible.add(document.id)
  }
  const remainingIds = documents
    .map((document) => document.id)
    .filter((documentId) => !visible.has(documentId))
  if (!remainingIds.length) return visible

  const principalFilters: Array<FilterQuery<DocumentShare>> = [
    { principalType: 'user', principalId: userId },
  ]
  if (ctx.auth.roleIds.length > 0) {
    principalFilters.push({
      principalType: 'role',
      principalId: { $in: ctx.auth.roleIds },
    } as FilterQuery<DocumentShare>)
  }

  const shares = await ctx.em.find(DocumentShare, {
    documentId: { $in: remainingIds },
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    $or: principalFilters,
  } as FilterQuery<DocumentShare>)
  for (const share of shares) visible.add(share.documentId)
  return visible
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const url = new URL(request.url)
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))

    const where: FilterQuery<Document> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(query.folderId ? { folderId: query.folderId } : {}),
    }
    const documents = await ctx.em.find(Document, where, { orderBy: { updatedAt: 'DESC' } })
    const visibleIds = await resolveVisibleDocumentIds(documents, ctx)
    const visibleDocuments = documents.filter((document) => {
      if (visibleIds && !visibleIds.has(document.id)) return false
      return matchesSearch(document, query.search)
    })

    const total = visibleDocuments.length
    const start = (query.page - 1) * query.pageSize
    const items = visibleDocuments
      .slice(start, start + query.pageSize)
      .map(serializeDocument)

    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
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
    const userId = resolveActorUserId(ctx.auth)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
    })

    if (input.folderId) {
      const folder = await loadScopedFolder(ctx, input.folderId)
      if (folder.deletedAt) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }
    }

    const document = ctx.em.create(Document, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      title: input.title,
      folderId: input.folderId ?? null,
      ownerUserId: userId,
      createdByUserId: userId,
      isActive: true,
    })
    const content = ctx.em.create(DocumentContent, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId: document.id,
      contentHtml: '',
      contentText: '',
    })
    ctx.em.persist([document, content])
    await ctx.em.flush()

    await resolveSearchIndexer(ctx.container).indexRecordById({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: document.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    await emitDocumentsEvent('documents.document.created', {
      id: document.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
    })

    return NextResponse.json(
      { id: document.id, updatedAt: document.updatedAt.toISOString() },
      { status: 201 },
    )
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
      ],
    },
  },
}

export default { GET, POST }
