import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentVersion } from '../../../../data/entities'
import { resolveUserLabels } from '../../../../lib/userLabels'
import { materializeDocumentVersionPreview } from '../../../../lib/versionContent'
import { sanitizeDocumentVersionLabel } from '../../../../lib/versionLabels'
import {
  handleDocumentsRouteError,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../../_shared'

type RouteContext = {
  params: Promise<{ id: string; versionId: string }> | { id: string; versionId: string }
}

const versionDetailResponseSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  creatorLabel: z.string(),
  createdAt: z.string(),
  contentHtml: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id: documentId, versionId } = await context.params
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const projection = await resolveDocumentCapabilityProjection(ctx, documentId)
    if (!projection.capabilities.canView) throw new CrudHttpError(403, { error: 'Forbidden' })

    const version = await findOneWithDecryption(
      ctx.em,
      DocumentVersion,
      {
        id: versionId,
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (!version) throw new CrudHttpError(404, { error: 'documents.versions.notFound' })

    const labels = await resolveUserLabels(
      ctx.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      [version.createdByUserId],
    )
    const { translate } = await resolveTranslations()
    const creatorLabel = labels.get(version.createdByUserId)?.label
      ?? translate('documents.collaboration.genericCollaborator', 'Collaborator')

    return NextResponse.json({
      id: version.id,
      label: sanitizeDocumentVersionLabel(version.label),
      creatorLabel,
      createdAt: version.createdAt.toISOString(),
      contentHtml: materializeDocumentVersionPreview({
        documentId,
        yjsSnapshot: version.yjsSnapshot,
        contentHtml: version.contentHtml,
        entityRefFallbackLabel: translate('documents.links.restrictedRecord', 'Restricted record'),
      }),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.versions.detail')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Preview document version',
  pathParams: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Read a sanitized historical document preview',
      responses: [{ status: 200, description: 'Historical document preview', schema: versionDetailResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Version not found', schema: routeErrorSchema },
        { status: 422, description: 'Version snapshot is invalid', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET }
