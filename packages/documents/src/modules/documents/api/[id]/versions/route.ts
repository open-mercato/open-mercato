import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DocumentVersion } from '../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { emitDocumentsEvent } from '../../../events'
import { assertTier } from '../../../lib/permissions'
import { loadDocumentContent } from '../../../lib/contentService'
import { resolveUserLabels } from '../../../lib/userLabels'
import {
  handleDocumentsRouteError,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const versionCreateSchema = z.object({
  label: z.string().trim().max(256).optional().nullable(),
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
    label: version.label ?? null,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    const versions = await ctx.em.find(
      DocumentVersion,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      { orderBy: { createdAt: 'DESC' } },
    )
    const labels = await resolveUserLabels(
      ctx.em,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      versions.map((version) => version.createdByUserId),
    )

    return NextResponse.json({
      items: versions.map((version) => ({
        ...serializeVersion(version),
        createdByLabel: labels.get(version.createdByUserId)?.label ?? null,
      })),
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
    const input = versionCreateSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: input,
    })
    const content = await loadDocumentContent(ctx.em, documentId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    const userId = resolveActorUserId(ctx.auth)
    const version = ctx.em.create(DocumentVersion, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      label: input.label ?? null,
      yjsSnapshot: content?.yjsState ? Buffer.from(content.yjsState) : Buffer.alloc(0),
      contentHtml: content?.contentHtml ?? '',
      createdByUserId: userId,
    })
    ctx.em.persist(version)
    await ctx.em.flush()

    await emitDocumentsEvent('documents.version.created', {
      id: version.id,
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: documentId,
      operation: 'create',
    })

    return NextResponse.json(serializeVersion(version), { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document versions',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List document versions',
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
      ],
    },
  },
}

export default { GET, POST }
