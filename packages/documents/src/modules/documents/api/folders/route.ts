import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { documentFolderCreateSchema, documentFolderUpdateSchema } from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import {
  getVisibleFolders,
  type FolderVisibility,
  type VisibleFolderRow,
} from '../../lib/visibility'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeFolder,
  validateMutationGuard,
} from '../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../_commands'
import type {
  FolderCreateCommandInput,
  FolderDeleteCommandInput,
  FolderUpdateCommandInput,
} from '../../commands/folders'

const folderDeleteSchema = z.object({
  id: z.string().uuid(),
})

type FolderNode = Record<string, unknown> & {
  id: string
  parentFolderId: string | null
  canEdit: boolean
  visibility: FolderVisibility
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
    canEdit: z.boolean(),
    visibility: z.enum(['owned', 'contains-visible', 'ancestor']),
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

function buildFolderTree(visibleFolders: VisibleFolderRow[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  const roots: FolderNode[] = []
  for (const { folder, canEdit, visibility } of visibleFolders) {
    nodes.set(folder.id, {
      ...serializeFolder(folder),
      id: folder.id,
      parentFolderId: folder.parentFolderId ?? null,
      canEdit,
      visibility,
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

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const visibleFolders = await getVisibleFolders({
      em: ctx.em,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
      roleIds: ctx.auth.roleIds,
      managerOverride: hasDocumentsFeature(ctx.auth, 'documents.manage'),
      canEditAction: hasDocumentsFeature(ctx.auth, 'documents.edit'),
    })
    return NextResponse.json({
      items: buildFolderTree(visibleFolders),
      total: visibleFolders.length,
    })
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
    const commandInput: FolderCreateCommandInput = {
      ...input,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      folderId: randomUUID(),
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      FolderCreateCommandInput,
      { id: string; updatedAt: string }
    >('documents.folder.create', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: 'new',
      operation: 'create',
    })

    const response = NextResponse.json({ id: result.id, updatedAt: result.updatedAt }, { status: 201 })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.create')
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const input = documentFolderUpdateSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: input.id,
      operation: 'update',
      mutationPayload: input,
    })
    const commandInput: FolderUpdateCommandInput = {
      ...input,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      FolderUpdateCommandInput,
      { id: string; updatedAt: string }
    >('documents.folder.update', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: input.id,
      operation: 'update',
    })

    const response = NextResponse.json({ id: result.id, updatedAt: result.updatedAt })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.folders.update')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    const input = folderDeleteSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: input.id,
      operation: 'delete',
    })
    const commandInput: FolderDeleteCommandInput = {
      id: input.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      FolderDeleteCommandInput,
      { id: string; updatedAt: string }
    >('documents.folder.delete', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: input.id,
      operation: 'delete',
    })

    const response = NextResponse.json({ ok: true, id: result.id, updatedAt: result.updatedAt })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFolder,
      resourceId: result.id,
    })
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
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document folder',
      requestBody: { contentType: 'application/json', schema: documentFolderUpdateSchema },
      responses: [{ status: 200, description: 'Folder updated', schema: mutationResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid folder hierarchy', schema: routeErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete document folder',
      requestBody: { contentType: 'application/json', schema: folderDeleteSchema },
      responses: [{ status: 200, description: 'Folder deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, POST, PUT, DELETE }
