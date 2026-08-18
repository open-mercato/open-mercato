import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentEntityLink } from '../../../data/entities'
import {
  documentEntityLinkCreateSchema,
  documentEntityLinkSourceSchema,
  documentEntityTypeSchema,
} from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  assertDocumentEntityLinkListWithinLimit,
  findDocumentEntityLinks,
  getDocumentEntityLinkEntityId,
  getDocumentEntityLinkType,
  serializeDocumentEntityLink,
  type DocumentEntityLinkCanonicalTarget,
} from '../../../lib/entityLinks'
import { getEntityRegistryEntry } from '../../../lib/entityRegistry'
import { isDocumentEntityRegistryModuleEnabled } from '../../../lib/entityRegistryAvailability.server'
import { verifyEntityRegistryTargetAccess } from '../../../lib/entityRegistry.server'
import { assertTier } from '../../../lib/permissions'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  hasDocumentsFeature,
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
import type { LinkCreateCommandInput } from '../../../commands/links'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const linkItemSchema = z.object({
  id: z.string().uuid(),
  entityType: documentEntityTypeSchema,
  entityId: z.string().uuid().nullable(),
  label: z.string(),
  href: z.string().nullable(),
  canOpen: z.boolean(),
  archivedAt: z.string().nullable().optional(),
  values: z.record(
    z.string().min(1).max(64),
    z.string().max(10000).nullable(),
  ).optional(),
  source: documentEntityLinkSourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

const linksResponseSchema = z.object({ items: z.array(linkItemSchema) })
const LINK_TARGET_VERIFICATION_CONCURRENCY = 4

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  return (await context.params).id
}

async function loadCreatedLink(
  em: EntityManager,
  id: string,
  scope: { tenantId: string; organizationId: string },
): Promise<DocumentEntityLink> {
  const link = await findOneWithDecryption(
    em,
    DocumentEntityLink,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (!link) throw new Error('[internal] created document link was not found')
  return link
}

type LinkTargetVerificationInput = {
  entityType: z.infer<typeof documentEntityTypeSchema>
  entityId: string
}

type VerifiedLinkTarget = DocumentEntityLinkCanonicalTarget & {
  archivedAt?: string | null
}

function getLinkEntityType(link: DocumentEntityLink): z.infer<typeof documentEntityTypeSchema> {
  return link.linkedDocumentId ? 'document' : getDocumentEntityLinkType(link)
}

function getLinkEntityId(link: DocumentEntityLink): string {
  return link.linkedDocumentId ?? getDocumentEntityLinkEntityId(link)
}

function linkTargetVerificationKey(input: LinkTargetVerificationInput): string {
  return JSON.stringify([input.entityType, input.entityId])
}

async function verifyLinkTargets(
  request: Request,
  inputs: LinkTargetVerificationInput[],
): Promise<Map<string, VerifiedLinkTarget | null>> {
  const results = new Map<string, VerifiedLinkTarget | null>()
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(LINK_TARGET_VERIFICATION_CONCURRENCY, inputs.length) },
    async () => {
      while (nextIndex < inputs.length) {
        const index = nextIndex
        nextIndex += 1
        const input = inputs[index]!
        const key = linkTargetVerificationKey(input)
        try {
          const verified = await verifyEntityRegistryTargetAccess(request, input)
          results.set(key, {
            id: verified.id,
            label: verified.label,
            href: verified.href,
            values: verified.values,
            archivedAt: verified.archivedAt,
          })
        } catch {
          results.set(key, null)
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    const { translate } = await resolveTranslations()
    const links = await findDocumentEntityLinks(
      ctx.em,
      documentId,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    // Keep the route safe even when a custom repository/DI override returns a
    // body that did not pass through the default bounded reader.
    assertDocumentEntityLinkListWithinLimit(links)
    const verificationInputByLinkId = new Map<string, LinkTargetVerificationInput>()
    const uniqueVerificationInputs = new Map<string, LinkTargetVerificationInput>()
    for (const link of links) {
      const entityType = getLinkEntityType(link)
      const entry = getEntityRegistryEntry(entityType)
      if (
        !entry
        || !isDocumentEntityRegistryModuleEnabled(entry)
        || !hasDocumentsFeature(ctx.auth, entry.requiredFeature)
      ) {
        continue
      }
      const input = {
        entityType,
        entityId: getLinkEntityId(link),
      }
      verificationInputByLinkId.set(link.id, input)
      uniqueVerificationInputs.set(linkTargetVerificationKey(input), input)
    }
    const verifiedTargets = await verifyLinkTargets(
      request,
      Array.from(uniqueVerificationInputs.values()),
    )
    return NextResponse.json({
      items: links.map((link) => {
        const entityType = getLinkEntityType(link)
        const verificationInput = verificationInputByLinkId.get(link.id)
        const canonicalTarget = verificationInput
          ? verifiedTargets.get(linkTargetVerificationKey(verificationInput)) ?? null
          : null
        const serialized = serializeDocumentEntityLink(link, {
          canOpen: Boolean(canonicalTarget),
          restrictedLabel: translate('documents.links.restrictedRecord', 'Restricted record'),
          canonicalTarget: canonicalTarget ?? undefined,
        })
        if (entityType !== 'document') return serialized
        return {
          ...serialized,
          entityType,
          entityId: canonicalTarget?.id ?? null,
          ...(canonicalTarget ? { archivedAt: canonicalTarget.archivedAt ?? null } : {}),
        }
      }),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.links.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, documentId, ctx.auth, 'editor')
    await assertDocumentNotArchived(ctx, documentId)
    const input = documentEntityLinkCreateSchema.parse(await readBody(request))
    if (input.entityType === 'document' && input.entityId === documentId) {
      throw new CrudHttpError(400, { error: 'documents.links.selfLinkForbidden' })
    }
    const registryEntry = getEntityRegistryEntry(input.entityType)
    if (
      !registryEntry
      || !isDocumentEntityRegistryModuleEnabled(registryEntry)
      || !hasDocumentsFeature(ctx.auth, registryEntry.requiredFeature)
    ) {
      throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    }
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: {
        entityType: input.entityType,
        entityId: input.entityId,
        source: input.source,
      },
    })
    const commandInput: LinkCreateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      linkId: randomUUID(),
      link: input,
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      LinkCreateCommandInput,
      { id: string; created: boolean; updatedAt: string }
    >('documents.link.create', {
      input: commandInput,
      ctx: buildDocumentsCommandRuntimeContext(ctx),
    })
    const link = await loadCreatedLink(ctx.em, result.id, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: 'new',
      operation: 'create',
    })
    const response = NextResponse.json(
      serializeDocumentEntityLink(link, { canOpen: true, restrictedLabel: link.labelSnapshot }),
      { status: result.created ? 201 : 200 },
    )
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentEntityLink,
      resourceId: result.id,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.links.create')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document entity links',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List entity links visible to the document viewer',
      responses: [{ status: 200, description: 'Document entity links', schema: linksResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Request body or document link limit exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Link a document to an entity',
      requestBody: { contentType: 'application/json', schema: documentEntityLinkCreateSchema },
      responses: [{ status: 201, description: 'Link created', schema: linkItemSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Document link limit exceeded', schema: routeErrorSchema },
        { status: 503, description: 'Target lookup unavailable', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST }
