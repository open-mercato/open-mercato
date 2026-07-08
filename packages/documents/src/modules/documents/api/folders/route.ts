import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { DocumentFolder } from '../../data/entities'
import { documentFolderCreateSchema, documentFolderUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import {
  assertFolderWritable,
  handleDocumentsRouteError,
  loadScopedFolder,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeFolder,
  validateMutationGuard,
} from '../_shared'

const folderDeleteSchema = z.object({
  id: z.string().uuid(),
})

type FolderNode = Record<string, unknown> & {
  id: string
  parentFolderId: string | null
  children: FolderNode[]
}

const folderNodeSchema: z.ZodType<FolderNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    parentFolderId: z.string().uuid().nullable(),
    ownerUserId: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
    children: z.array(folderNodeSchema),
  }),
)

const folderListResponseSchema = z.object({
  items: z.array(folderNodeSchema),
  total: z.number(),
})

const mutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

const deleteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

function buildFolderTree(folders: DocumentFolder[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  for (const folder of folders) {
    nodes.set(folder.id, {
      ...serializeFolder(folder),
      id: folder.id,
      parentFolderId: folder.parentFolderId ?? null,
      children: [],
    })
  }
  for (const node of nodes.values()) {
    if (node.parentFolderId && nodes.has(node.parentFolderId)) {
      nodes.get(node.parentFolderId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

async function assertParentFolder(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  parentFolderId: string | null | undefined,
  currentFolderId?: string,
): Promise<void> {
  if (!parentFolderId) return
  if (currentFolderId && parentFolderId === currentFolderId) {
    throw new CrudHttpError(400, { error: 'Folder cannot be its own parent' })
  }
  const parent = await loadScopedFolder(ctx, parentFolderId)
  await assertFolderWritable(ctx, parent)
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const folders = await ctx.em.find(
      DocumentFolder,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { name: 'ASC' } },
    )
    return NextResponse.json({ items: buildFolderTree(folders), total: folders.length })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.list')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const input = documentFolderCreateSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
    })
    await assertParentFolder(ctx, input.parentFolderId ?? null)

    const folder = ctx.em.create(DocumentFolder, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      name: input.name,
      parentFolderId: input.parentFolderId ?? null,
      ownerUserId: resolveActorUserId(ctx.auth),
    })
    ctx.em.persist(folder)
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: 'new',
      operation: 'create',
    })

    return NextResponse.json({ id: folder.id, updatedAt: folder.updatedAt.toISOString() }, { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.create')
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const input = documentFolderUpdateSchema.parse(await readBody(request))
    const folder = await loadScopedFolder(ctx, input.id)
    await assertFolderWritable(ctx, folder)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      current: folder.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      operation: 'update',
      mutationPayload: input,
    })
    await assertParentFolder(ctx, input.parentFolderId ?? null, folder.id)

    if (input.name !== undefined) folder.name = input.name
    if (Object.prototype.hasOwnProperty.call(input, 'parentFolderId')) {
      folder.parentFolderId = input.parentFolderId ?? null
    }
    folder.updatedAt = new Date()
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      operation: 'update',
    })

    return NextResponse.json({ id: folder.id, updatedAt: folder.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.update')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const input = folderDeleteSchema.parse(await readBody(request))
    const folder = await loadScopedFolder(ctx, input.id)
    await assertFolderWritable(ctx, folder)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      current: folder.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      operation: 'delete',
    })

    const now = new Date()
    folder.deletedAt = now
    folder.updatedAt = now
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: folder.id,
      operation: 'delete',
    })

    return NextResponse.json({ ok: true, id: folder.id, updatedAt: folder.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document folders',
  methods: {
    GET: {
      summary: 'List document folders',
      responses: [{ status: 200, description: 'Folder tree', schema: folderListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document folder',
      requestBody: { contentType: 'application/json', schema: documentFolderCreateSchema },
      responses: [{ status: 201, description: 'Folder created', schema: mutationResponseSchema }],
      errors: [{ status: 400, description: 'Validation failed', schema: routeErrorSchema }],
    },
    PUT: {
      summary: 'Update document folder',
      requestBody: { contentType: 'application/json', schema: documentFolderUpdateSchema },
      responses: [{ status: 200, description: 'Folder updated', schema: mutationResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
    DELETE: {
      summary: 'Delete document folder',
      requestBody: { contentType: 'application/json', schema: folderDeleteSchema },
      responses: [{ status: 200, description: 'Folder deleted', schema: deleteResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
  },
}

export default { GET, POST, PUT, DELETE }
