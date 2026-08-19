import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentAttachment, DocumentEntityLink } from '../../../data/entities'
import { documentTitleSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { assertTier } from '../../../lib/permissions'
import {
  getDocumentEntityLinkEntityId,
  getDocumentEntityLinkType,
} from '../../../lib/entityLinks'
import { verifyEntityRegistryTargetAccess } from '../../../lib/entityRegistry.server'
import {
  DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS,
  DOCUMENTS_DUPLICATE_MAX_LINKS,
  type DuplicateDocumentCommandInput,
  type DuplicateDocumentCommandResult,
  type DuplicateVerifiedLink,
} from '../../../commands/duplicate'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  type DocumentsRouteContext,
  withDocumentsContextErrors,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const duplicateBodySchema = z.object({
  title: documentTitleSchema.optional(),
})

// The guard sees the same shape the command consumes, so a registry guard can
// rewrite the title and have that rewrite survive re-validation.
const duplicateGuardPayloadSchema = duplicateBodySchema.extend({
  action: z.literal('duplicate'),
  sourceDocumentId: z.string().uuid(),
})

const duplicateResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
  copiedAttachments: z.number().int().nonnegative(),
  copiedLinks: z.number().int().nonnegative(),
  droppedLinks: z.number().int().nonnegative(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.create', 'documents.edit'] },
}

async function collectVerifiedSourceLinks(
  request: Request,
  ctx: DocumentsRouteContext,
  sourceDocumentId: string,
): Promise<{ verifiedLinks: DuplicateVerifiedLink[]; droppedLinks: number; activeLinkCount: number }> {
  const links = await findWithDecryption(
    ctx.em,
    DocumentEntityLink,
    {
      documentId: sourceDocumentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'ASC', id: 'ASC' } },
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (links.length > DOCUMENTS_DUPLICATE_MAX_LINKS) {
    throw new CrudHttpError(422, { error: 'documents.errors.duplicateSourceTooLarge' })
  }
  const verificationOutcomes: Array<DuplicateVerifiedLink | null> = new Array(links.length).fill(null)
  const concurrency = Math.min(4, links.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < links.length) {
      const index = nextIndex
      nextIndex += 1
      const link = links[index]!
      const entityType = getDocumentEntityLinkType(link)
      const entityId = getDocumentEntityLinkEntityId(link)
      if (entityType === 'document' && entityId === sourceDocumentId) {
        continue
      }
      try {
        const verified = await verifyEntityRegistryTargetAccess(request, { entityType, entityId })
        verificationOutcomes[index] = {
          entityType,
          entityId,
          labelSnapshot: verified.label,
          hrefSnapshot: verified.href,
          source: link.source,
        }
      } catch {
        verificationOutcomes[index] = null
      }
    }
  }))
  const verifiedLinks = verificationOutcomes.filter((outcome): outcome is DuplicateVerifiedLink => outcome !== null)
  return { verifiedLinks, droppedLinks: links.length - verifiedLinks.length, activeLinkCount: links.length }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id: sourceDocumentId } = await context.params
    const ctx = await resolveDocumentsContext(request, ['documents.create', 'documents.edit'])
    // `resolveDocumentsContext` only proves ONE of the listed features. This
    // route declares both, so re-assert the conjunction the same way the
    // sibling `instantiate` route does.
    if (
      !hasDocumentsFeature(ctx.auth, 'documents.create')
      || !hasDocumentsFeature(ctx.auth, 'documents.edit')
    ) {
      throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    }
    // Reject machine principals before the link-verification fanout; the
    // command re-asserts this fail-closed (spec decision 10).
    if (ctx.auth.isApiKey === true || ctx.auth.sub.startsWith('api_key:')) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    await assertTier(ctx.em, sourceDocumentId, ctx.auth, 'viewer')

    const attachmentCount = await ctx.em.count(DocumentAttachment, {
      documentId: sourceDocumentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })
    if (attachmentCount > DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS) {
      throw new CrudHttpError(422, { error: 'documents.errors.duplicateSourceTooLarge' })
    }

    const body = duplicateBodySchema.parse(await readBody(request))
    const guardPayload = duplicateGuardPayloadSchema.parse({
      ...body,
      action: 'duplicate',
      sourceDocumentId,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: guardPayload,
      mutationPayloadSchema: duplicateGuardPayloadSchema,
    })

    const newDocumentId = randomUUID()
    const { verifiedLinks, droppedLinks } = await collectVerifiedSourceLinks(
      request,
      ctx,
      sourceDocumentId,
    )
    const { translate } = await resolveTranslations()
    const input: DuplicateDocumentCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      sourceDocumentId,
      newDocumentId,
      newContentId: randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
      title: guardPayload.title,
      localizedCopyTitle: translate('documents.duplicate.copyTitle', '{title} (copy)'),
      verifiedLinks,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<
      DuplicateDocumentCommandInput,
      DuplicateDocumentCommandResult
    >('documents.document.duplicate', {
      input,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: execution.result.id,
      operation: 'create',
    })

    const response = NextResponse.json({
      id: execution.result.id,
      updatedAt: execution.result.updatedAt,
      copiedAttachments: execution.result.copiedAttachments,
      copiedLinks: execution.result.copiedLinks,
      droppedLinks: droppedLinks + execution.result.droppedLinks,
    }, { status: 201 })
    return attachDocumentsOperationMetadata(response, execution.logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: execution.result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.duplicate')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Duplicate document',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Create a copy of a visible document owned by the acting user',
      requestBody: { contentType: 'application/json', schema: duplicateBodySchema },
      responses: [{ status: 201, description: 'Copy created', schema: duplicateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
        { status: 422, description: 'Source exceeds the duplicate fanout bounds', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
