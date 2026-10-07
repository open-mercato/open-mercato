import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { generateSchema } from '../../../data/validators'
import { templateRegistry } from '../../../lib/template-registry'
import { TemplateAccessPolicy, type TemplateFeatureAuthorizer } from '../../../lib/template-access-policy'
import { DocumentRenderer } from '../../../services/document-renderer'
import { GenerationHistoryService } from '../../../services/generation-history-service'
import { resolveStoredDocumentAttachmentService, storeGeneratedDocument } from '../../../lib/stored-documents'
import { documentResponse } from '../../_shared/document-response'
import { errorResponse, mapDocumentError, parseJsonBody, requireOrganization, toTemplateTranslate } from '../../_shared/http'
import { resolveDocumentRequestContext } from '../../_shared/request-context'

const GENERATE_FEATURE = 'document_generators.documents.generate'
const GENERATED_DOCUMENT_RESOURCE_KIND = 'document_generators.generated_document'

const logger = createLogger('document_generators')

export const metadata = {
  path: '/document-generators/generate',
  POST: { requireAuth: true, requireFeatures: [GENERATE_FEATURE] },
}

const errorSchema = z.object({ error: z.string(), message: z.string() })
const forbiddenSchema = errorSchema.extend({ requiredFeatures: z.array(z.string()) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'Generate a document',
  methods: {
    POST: {
      operationId: 'documentGeneratorsGenerate',
      summary: 'Render a document and record it in the generation history.',
      description: 'Renders the template for the given source data, records a best-effort history row and returns the document bytes as an attachment. The resource identity comes from the loaded template, never from the client.',
      requestBody: { contentType: 'application/json', schema: generateSchema },
      responses: [
        {
          status: 200,
          description: 'The generated document (application/pdf or text/markdown) as an attachment.',
          mediaType: 'application/octet-stream',
          schema: z.string().describe('Binary document content'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid JSON, invalid request, unknown template or invalid source reference.', schema: errorSchema },
        { status: 401, description: 'Unauthenticated caller.', schema: errorSchema },
        { status: 403, description: 'The caller lacks the features required by the template, or has no user or API key id to record as the generator.', schema: forbiddenSchema },
        { status: 404, description: 'Document source not found.', schema: errorSchema },
        { status: 409, description: 'An organization must be selected.', schema: errorSchema },
        { status: 422, description: 'Generation blocked by a mutation guard (a guard may supply another status and body).', schema: z.record(z.string(), z.unknown()) },
        { status: 500, description: 'Rendering failed.', schema: errorSchema },
      ],
    },
  },
}

function reportHistoryFailure(error: unknown): void {
  logger.error('Failed to record the generated document history', { err: error as Error })
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'document_generators', code: 'document_generators.history_persist_failed' })
  } catch (telemetryError) {
    logger.error('Failed to report a history error to telemetry', { err: telemetryError as Error })
  }
}

function reportStorageFailure(error: unknown): void {
  logger.error('Failed to store the generated document; recording history without a stored file', { err: error as Error })
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'document_generators', code: 'document_generators.document_storage_failed' })
  } catch (telemetryError) {
    logger.error('Failed to report a storage error to telemetry', { err: telemetryError as Error })
  }
}

async function recordGeneratedDocument(input: {
  history: GenerationHistoryService
  prepared: Awaited<ReturnType<GenerationHistoryService['prepare']>>
  resolve: (name: string) => unknown
  buffer: Uint8Array
  fileName: string
  mimeType: string
}): Promise<string> {
  const attachmentService = resolveStoredDocumentAttachmentService(<T,>(name: string) => input.resolve(name) as T)
  if (attachmentService) {
    try {
      const stored = await storeGeneratedDocument({
        attachmentService,
        prepared: input.prepared,
        buffer: input.buffer,
        fileName: input.fileName,
        mimeType: input.mimeType,
      })
      return stored.historyId
    } catch (error) {
      reportStorageFailure(error)
    }
  }
  return (await input.history.persist(input.prepared)).id
}

const actorIdSchema = z.string().uuid()

function resolveGeneratedBy(auth: NonNullable<AuthContext>): string | null {
  const candidate = auth.userId ?? (auth.isApiKey ? auth.keyId : auth.sub)
  return actorIdSchema.safeParse(candidate).success ? (candidate as string) : null
}

async function loadUserFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  try {
    const rbac = container.resolve('rbacService') as {
      getGrantedFeatures?: (id: string, opts: { tenantId: string | null; organizationId: string | null }) => Promise<string[]>
    } | undefined
    if (rbac?.getGrantedFeatures) return await rbac.getGrantedFeatures(userId, scope)
  } catch {
    return []
  }
  return []
}

export async function POST(request: Request): Promise<Response> {
  const { container, auth, translate, locale } = await resolveDocumentRequestContext(request)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await parseJsonBody(request, translate)
    if (!body.ok) return body.response
    const parsed = generateSchema.safeParse(body.body)
    if (!parsed.success) {
      return errorResponse('invalid_request', 400, translate, { issues: parsed.error.issues })
    }
    const organization = await requireOrganization({ auth, container, request, translate })
    if (!organization.ok) return organization.response
    const generatedBy = resolveGeneratedBy(organization.auth)
    if (!generatedBy) return errorResponse('forbidden', 403, translate, { requiredFeatures: [] })
    const template = templateRegistry.getTemplateMetadata(parsed.data.template_id, translate)
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: container.resolve('rbacService') as TemplateFeatureAuthorizer,
      auth: organization.auth,
    })
    await policy.requireAccess({ requiredFeatures: template.requiredFeatures })
    const loaded = await templateRegistry.load(
      { id: parsed.data.template_id, data: parsed.data.data, version: parsed.data.template_version },
      { container, auth: organization.auth, locale, translate: toTemplateTranslate(translate) },
    )
    const rendered = await new DocumentRenderer().render(loaded.render)

    const { tenantId, organizationId } = organization.scope
    const userId = organization.auth.userId ?? organization.auth.sub
    const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
    const legacyGuard = bridgeLegacyGuard(container as Parameters<typeof bridgeLegacyGuard>[0])
    if (legacyGuard) guards.push(legacyGuard)
    const guardResult = await runMutationGuards(
      guards,
      {
        tenantId,
        organizationId,
        userId,
        resourceKind: GENERATED_DOCUMENT_RESOURCE_KIND,
        resourceId: null,
        operation: 'create',
        requestMethod: request.method,
        requestHeaders: request.headers,
        mutationPayload: {
          template_id: loaded.template.id,
          format: rendered.format,
          source_resource_kind: loaded.resource.kind,
          source_resource_id: loaded.resource.id,
        },
      },
      { userFeatures: await loadUserFeatures(container, organization.auth.sub, { tenantId, organizationId }) },
    )
    if (!guardResult.ok) {
      return Response.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const history = new GenerationHistoryService(container.resolve('em') as EntityManager)
    const prepared = await history.prepare({
      tenantId,
      organizationId,
      resourceKind: loaded.resource.kind,
      resourceId: loaded.resource.id,
      resourceLabel: loaded.resource.label,
      templateId: loaded.template.id,
      templateLabel: loaded.template.label,
      templateVersion: loaded.template.version,
      format: rendered.format,
      mimeType: rendered.mimeType,
      generatedBy,
      generatedAt: new Date(),
    })
    let recordedId: string | null = null
    try {
      recordedId = await recordGeneratedDocument({
        history,
        prepared,
        resolve: (name) => container.resolve(name),
        buffer: rendered.buffer,
        fileName: loaded.filename,
        mimeType: rendered.mimeType,
      })
    } catch (error) {
      reportHistoryFailure(error)
    }

    if (recordedId && guardResult.afterSuccessCallbacks.length > 0) {
      for (const { guard, metadata: guardMetadata } of guardResult.afterSuccessCallbacks) {
        try {
          await guard.afterSuccess?.({
            tenantId,
            organizationId,
            userId,
            resourceKind: GENERATED_DOCUMENT_RESOURCE_KIND,
            resourceId: recordedId,
            operation: 'create',
            requestMethod: request.method,
            requestHeaders: request.headers,
            metadata: guardMetadata,
          })
        } catch (error) {
          logger.error('Mutation guard afterSuccess failed', { guardId: guard.id, err: error as Error })
        }
      }
    }
    return documentResponse({ buffer: rendered.buffer, filename: loaded.filename, mimeType: rendered.mimeType })
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
