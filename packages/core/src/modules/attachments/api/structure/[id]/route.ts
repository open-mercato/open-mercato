import { NextResponse } from 'next/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { documentStructureQuerySchema, documentStructureRequestSchema } from '../../../data/validators'
import {
  REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID,
  type RequestDocumentStructureCommandInput,
  type RequestDocumentStructureCommandResult,
} from '../../../commands/documentStructure'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  type AttachmentDocumentStructureService,
} from '../../../lib/documentStructure/service'
import {
  documentStructureNotFoundResponse,
  resolveDocumentStructureRouteScope,
  resolveUserFeatures,
  validationErrorResponse,
  type DocumentStructureRouteContext,
} from '../../../lib/documentStructure/routeContext'
import {
  attachmentErrorSchema,
  attachmentsTag,
  documentStructurePathParamsSchema,
  documentStructureRequestResponseSchema,
  documentStructureResponseSchema,
} from '../../openapi'

const logger = createLogger('attachments').child({ component: 'document-structure-route' })

const DOCUMENT_STRUCTURE_RESOURCE_KIND = 'attachments.attachment'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const raw = await req.text()
  if (raw.trim().length === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

export async function GET(req: Request, ctx: DocumentStructureRouteContext) {
  const resolved = await resolveDocumentStructureRouteScope(req, ctx)
  if (resolved instanceof Response) return resolved
  const query = documentStructureQuerySchema.safeParse(buildQueryParams(new URL(req.url).searchParams))
  if (!query.success) return validationErrorResponse(query.error)
  try {
    const { container } = resolved
    const service = container.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
    const structure = await service.getStructure({
      attachmentId: resolved.attachmentId,
      scope: resolved.scope,
      maxDepth: query.data.maxDepth,
      includeOutline: query.data.includeOutline,
    })
    if (!structure) return documentStructureNotFoundResponse()
    return NextResponse.json(structure)
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    logger.error('Failed to load document structure', { err: error, attachmentId: resolved.attachmentId })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: DocumentStructureRouteContext) {
  const resolved = await resolveDocumentStructureRouteScope(req, ctx)
  if (resolved instanceof Response) return resolved
  const body = await readJsonBody(req)
  if (!body.ok) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = documentStructureRequestSchema.safeParse(body.value)
  if (!parsed.success) return validationErrorResponse(parsed.error)

  try {
    const { container } = resolved
    const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
    const legacyGuard = bridgeLegacyGuard(container)
    if (legacyGuard) guards.push(legacyGuard)
    const guardInput = {
      tenantId: resolved.tenantId,
      organizationId: resolved.organizationId,
      userId: resolved.auth.sub ?? '',
      resourceKind: DOCUMENT_STRUCTURE_RESOURCE_KIND,
      resourceId: resolved.attachmentId,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const guardResult = await runMutationGuards(
      guards,
      { ...guardInput, mutationPayload: parsed.data },
      { userFeatures: resolveUserFeatures(resolved.auth) },
    )
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, {
        status: guardResult.errorStatus ?? 422,
      })
    }
    let request = parsed.data
    if (guardResult.modifiedPayload) {
      const merged = documentStructureRequestSchema.safeParse({ ...parsed.data, ...guardResult.modifiedPayload })
      if (!merged.success) return validationErrorResponse(merged.error)
      request = merged.data
    }

    const commandContext: CommandRuntimeContext = {
      container,
      auth: resolved.auth,
      organizationScope: null,
      selectedOrganizationId: resolved.organizationId,
      organizationIds: [resolved.organizationId],
      request: req,
    }
    const commandBus = container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<RequestDocumentStructureCommandInput, RequestDocumentStructureCommandResult>(
      REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID,
      {
        input: {
          attachmentId: resolved.attachmentId,
          tenantId: resolved.tenantId,
          organizationId: resolved.organizationId,
          ...(request.force !== undefined ? { force: request.force } : {}),
          ...(request.ocr ? { ocr: request.ocr } : {}),
        },
        ctx: commandContext,
      },
    )

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (callbackError) {
        logger.warn('Mutation guard afterSuccess callback failed', {
          err: callbackError,
          guardId: callback.guard.id,
          attachmentId: resolved.attachmentId,
        })
      }
    }

    return NextResponse.json(
      { attachmentId: result.attachmentId, extractionId: result.extractionId, status: result.status },
      { status: result.enqueued ? 202 : 200 },
    )
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('Failed to request document structure extraction', {
      err: error,
      attachmentId: resolved.attachmentId,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Attachment document structure',
  description: 'Reads the extracted outline of an attachment and requests (re-)extraction of its document structure.',
  pathParams: documentStructurePathParamsSchema,
  methods: {
    GET: {
      summary: 'Get document structure',
      description:
        'Returns the live extraction status and outline for an attachment. `extraction` is null when the attachment has never been extracted; callers poll or request extraction. Attachments outside the caller scope return 404.',
      query: documentStructureQuerySchema,
      responses: [{ status: 200, description: 'Extraction status and outline', schema: documentStructureResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters or missing organization scope', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
      ],
    },
    POST: {
      summary: 'Request document structure extraction',
      description:
        'Queues a structure extraction for the attachment. Returns 202 when a job was queued, or 200 with the current extraction when it is already current and `force` is false.',
      requestBody: { contentType: 'application/json', schema: documentStructureRequestSchema },
      responses: [
        { status: 202, description: 'Extraction queued', schema: documentStructureRequestResponseSchema },
        { status: 200, description: 'Extraction already current', schema: documentStructureRequestResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 404, description: 'Attachment not found', schema: attachmentErrorSchema },
        { status: 413, description: 'File exceeds OM_ATTACHMENT_STRUCTURE_MAX_BYTES', schema: attachmentErrorSchema },
        { status: 422, description: 'Unsupported file type or blocked by a mutation guard', schema: attachmentErrorSchema },
      ],
    },
  },
}
