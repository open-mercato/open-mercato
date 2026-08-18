import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentVersion } from '../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { DOCUMENTS_VERSION_LIST_PAGE_SIZE } from '../../../lib/historyLimits'
import { assertTier } from '../../../lib/permissions'
import { resolveUserLabels } from '../../../lib/userLabels'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import type { CreateVersionCommandInput } from '../../../commands/versions'
import { documentVersionLabelSchema } from '../../../data/validators'
import { sanitizeDocumentVersionLabel } from '../../../lib/versionLabels'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export const versionCreateSchema = z.object({
  label: documentVersionLabelSchema,
})

export const versionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(DOCUMENTS_VERSION_LIST_PAGE_SIZE)
    .default(DOCUMENTS_VERSION_LIST_PAGE_SIZE),
})

const versionListItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  createdByLabel: z.string().nullable(),
  createdAt: z.string(),
})

const versionListResponseSchema = z.object({
  items: z.array(versionListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

const versionCreateResponseSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

function serializeVersion(version: DocumentVersion): z.infer<typeof versionCreateResponseSchema> {
  return {
    id: version.id,
    label: sanitizeDocumentVersionLabel(version.label),
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    const url = new URL(request.url)
    const query = versionListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const [versions, total] = await findAndCountWithDecryption(
      ctx.em,
      DocumentVersion,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      {
        fields: ['id', 'label', 'createdByUserId', 'createdAt'],
        orderBy: { createdAt: 'DESC', id: 'ASC' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const labels = await resolveUserLabels(
      ctx.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      versions.map((version) => version.createdByUserId),
    )

    return NextResponse.json({
      items: versions.map((version) => ({
        ...serializeVersion(version),
        createdByLabel: labels.get(version.createdByUserId)?.label ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, documentId, ctx.auth, 'editor')
    await assertDocumentNotArchived(ctx, documentId)
    const input = versionCreateSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: input,
    })
    const commandInput: CreateVersionCommandInput = {
      ...input,
      documentId,
      versionId: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      CreateVersionCommandInput,
      z.infer<typeof versionCreateResponseSchema>
    >('documents.version.create', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: documentId,
      operation: 'create',
    })

    const response = NextResponse.json({
      id: result.id,
      label: sanitizeDocumentVersionLabel(result.label),
      createdByUserId: result.createdByUserId,
      createdAt: result.createdAt,
    }, { status: 201 })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.create')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document versions',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List document versions',
      query: versionListQuerySchema,
      responses: [{ status: 200, description: 'Document version metadata', schema: versionListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document version snapshot',
      requestBody: { contentType: 'application/json', schema: versionCreateSchema },
      responses: [{ status: 201, description: 'Version snapshot created', schema: versionCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Request body, document content, or version history exceeds its safe storage bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST }
