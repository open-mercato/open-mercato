import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DocumentVersion } from '../../../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../../../lib/constants'
import { emitDocumentsEvent } from '../../../../../events'
import { assertTier } from '../../../../../lib/permissions'
import { loadDocumentContent, persistDocumentContent } from '../../../../../lib/contentService'
import {
  handleDocumentsRouteError,
  resolveActorUserId,
  resolveDocumentsContext,
  resolveSearchIndexer,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeContent,
  validateMutationGuard,
} from '../../../../_shared'

type RouteContext = {
  params: Promise<{ id: string; versionId: string }> | { id: string; versionId: string }
}

const restoreResponseSchema = z.object({
  contentHtml: z.string(),
  contentText: z.string(),
  updatedAt: z.string().nullable(),
  restoredVersionId: z.string().uuid(),
  preRestoreVersionId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

async function resolveParams(context: RouteContext): Promise<{ documentId: string; versionId: string }> {
  const params = await context.params
  return { documentId: params.id, versionId: params.versionId }
}

async function loadScopedVersion(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
  versionId: string,
): Promise<DocumentVersion> {
  const version = await ctx.em.findOne(DocumentVersion, {
    id: versionId,
    documentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  if (!version) throw new CrudHttpError(404, { error: 'Version not found' })
  return version
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { documentId, versionId } = await resolveParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, documentId, ctx.auth, 'editor')
    const targetVersion = await loadScopedVersion(ctx, documentId, versionId)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: versionId,
      operation: 'custom',
      mutationPayload: { action: 'restore', documentId, versionId },
    })

    const currentContent = await loadDocumentContent(ctx.em, documentId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    const userId = resolveActorUserId(ctx.auth)
    const preRestoreVersion = ctx.em.create(DocumentVersion, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      label: null,
      yjsSnapshot: currentContent?.yjsState ? Buffer.from(currentContent.yjsState) : Buffer.alloc(0),
      contentHtml: currentContent?.contentHtml ?? '',
      createdByUserId: userId,
    })
    ctx.em.persist(preRestoreVersion)

    await persistDocumentContent(
      ctx.em,
      documentId,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      {
        yjsState: Buffer.from(targetVersion.yjsSnapshot),
        contentHtml: targetVersion.contentHtml ?? '',
        contentText: '',
      },
      { searchIndexer: resolveSearchIndexer(ctx.container) },
    )
    const restoredContent = await loadDocumentContent(ctx.em, documentId, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    await emitDocumentsEvent('documents.version.restored', {
      id: documentId,
      documentId,
      versionId: targetVersion.id,
      preRestoreVersionId: preRestoreVersion.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: versionId,
      operation: 'custom',
    })

    return NextResponse.json({
      ...serializeContent(restoredContent),
      restoredVersionId: targetVersion.id,
      preRestoreVersionId: preRestoreVersion.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.restore')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Restore document version',
  pathParams: z.object({
    id: z.string().uuid(),
    versionId: z.string().uuid(),
  }),
  methods: {
    POST: {
      summary: 'Restore document content from a version snapshot',
      responses: [{ status: 200, description: 'Restored document content', schema: restoreResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Version not found', schema: routeErrorSchema },
      ],
    },
  },
}

export default { POST }
