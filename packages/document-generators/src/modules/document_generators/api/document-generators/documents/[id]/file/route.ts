import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { UnknownTemplateError } from '../../../../../lib/template-errors'
import { templateRegistry } from '../../../../../lib/template-registry'
import { TemplateAccessPolicy, type TemplateFeatureAuthorizer } from '../../../../../lib/template-access-policy'
import {
  resolveStoredDocumentAttachmentService,
  storedDocumentAssignment,
  storedDocumentOwner,
  STORED_DOCUMENT_PARTITION,
} from '../../../../../lib/stored-documents'
import { GenerationHistoryService } from '../../../../../services/generation-history-service'
import { errorResponse, mapDocumentError, requireOrganization } from '../../../../_shared/http'
import { resolveDocumentRequestContext } from '../../../../_shared/request-context'

const VIEW_FEATURE = 'document_generators.documents.view'

export const metadata = {
  path: '/document-generators/documents/[id]/file',
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const paramsSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string(), message: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'Download a stored generated document',
  methods: {
    GET: {
      operationId: 'documentGeneratorsDownloadStoredDocument',
      summary: 'Download the stored file of a generated document.',
      description: 'Returns the privately stored bytes of a history entry. The caller needs the features the producing template requires; files from another tenant or organization are never returned.',
      pathParams: paramsSchema,
      responses: [
        {
          status: 200,
          description: 'The stored document as an attachment.',
          mediaType: 'application/octet-stream',
          schema: z.string().describe('Binary document content'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid history entry id.', schema: errorSchema },
        { status: 401, description: 'Unauthenticated caller.', schema: errorSchema },
        { status: 403, description: 'The caller lacks the features required by the template.', schema: errorSchema },
        { status: 404, description: 'No stored file for this history entry.', schema: errorSchema },
        { status: 409, description: 'An organization must be selected.', schema: errorSchema },
      ],
    },
  },
}

function isMissingStoredFile(error: unknown): boolean {
  return error instanceof UnknownTemplateError || (isCrudHttpError(error) && (error.status === 404 || error.status === 403))
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
): Promise<Response> {
  const { container, auth, translate } = await resolveDocumentRequestContext(request)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) return errorResponse('invalid_request', 400, translate)
    const organization = await requireOrganization({ auth, container, request, translate })
    if (!organization.ok) return organization.response

    const history = new GenerationHistoryService(container.resolve('em') as EntityManager)
    const record = await history.findOne(organization.scope, parsed.data.id)
    if (!record?.attachmentId) return errorResponse('not_found', 404, translate)

    const attachmentService = resolveStoredDocumentAttachmentService(<T,>(name: string) => container.resolve(name) as T)
    if (!attachmentService) return errorResponse('not_found', 404, translate)

    let requiredFeatures: string[] | undefined
    try {
      requiredFeatures = templateRegistry.getTemplateMetadata(record.templateId, translate).requiredFeatures
    } catch (error) {
      if (isMissingStoredFile(error)) return errorResponse('not_found', 404, translate)
      throw error
    }
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: container.resolve('rbacService') as TemplateFeatureAuthorizer,
      auth: organization.auth,
    })
    await policy.requireAccess({ requiredFeatures })

    let file: Awaited<ReturnType<typeof attachmentService.readScoped>>
    try {
      file = await attachmentService.readScoped({
        attachmentId: record.attachmentId,
        auth: organization.auth,
        expectedOwner: storedDocumentOwner(record.resourceId),
        expectedAssignment: storedDocumentAssignment(record.resourceId),
        expectedPartitionCode: STORED_DOCUMENT_PARTITION,
        requirePrivatePartition: true,
        forceDownload: true,
      })
    } catch (error) {
      if (isMissingStoredFile(error)) return errorResponse('not_found', 404, translate)
      throw error
    }

    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': file.contentDisposition,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
