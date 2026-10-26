import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { documentSectionsQuerySchema } from '../../../../data/validators'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  type AttachmentDocumentStructureService,
} from '../../../../lib/documentStructure/service'
import {
  documentStructureNotFoundResponse,
  resolveDocumentStructureRouteScope,
  validationErrorResponse,
  type DocumentStructureRouteContext,
} from '../../../../lib/documentStructure/routeContext'
import {
  attachmentErrorSchema,
  attachmentsTag,
  documentSectionsResponseSchema,
  documentStructurePathParamsSchema,
} from '../../../openapi'

const logger = createLogger('attachments').child({ component: 'document-sections-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
}

export async function GET(req: Request, ctx: DocumentStructureRouteContext) {
  const resolved = await resolveDocumentStructureRouteScope(req, ctx)
  if (resolved instanceof Response) return resolved
  const query = documentSectionsQuerySchema.safeParse(buildQueryParams(new URL(req.url).searchParams))
  if (!query.success) return validationErrorResponse(query.error)
  try {
    const { container } = resolved
    const service = container.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
    const sections = await service.listSections({
      attachmentId: resolved.attachmentId,
      scope: resolved.scope,
      parentId: query.data.parentId ?? null,
      anchorKey: query.data.anchorKey ?? null,
      numberLabel: query.data.numberLabel ?? null,
      page: query.data.page ?? null,
      kinds: query.data.kinds ?? null,
      afterOrdinal: query.data.afterOrdinal ?? null,
      limit: query.data.limit,
      includeText: query.data.includeText,
      includeDescendants: query.data.includeDescendants,
      maxCharsPerSection: query.data.maxCharsPerSection,
    })
    if (sections) return NextResponse.json(sections)
    const structure = await service.getStructure({
      attachmentId: resolved.attachmentId,
      scope: resolved.scope,
      includeOutline: false,
    })
    if (!structure) return documentStructureNotFoundResponse()
    return NextResponse.json({ extractionId: structure.extraction?.id ?? null, items: [], nextCursor: null })
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to list document sections', { err: error, attachmentId: resolved.attachmentId })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Attachment document sections',
  description: 'Pages through the sections of the live document structure extraction of an attachment.',
  pathParams: documentStructurePathParamsSchema,
  methods: {
    GET: {
      summary: 'List document sections',
      description:
        'Returns sections in document order with keyset paging (`afterOrdinal` / `nextCursor`). Filters: parent, subtree, anchor key, number label, page and kinds. Section text is untrusted document data. `extractionId` is null and `items` empty when the attachment has not been extracted. Attachments outside the caller scope return 404.',
      query: documentSectionsQuerySchema,
      responses: [{ status: 200, description: 'A page of sections', schema: documentSectionsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters (for example limit above 100) or missing organization scope', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
      ],
    },
  },
}
