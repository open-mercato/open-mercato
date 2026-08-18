import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentShare } from '../../../data/entities'
import { documentShareCreateSchema, documentShareUpdateSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS, DOCUMENTS_MAX_LISTED_SHARES } from '../../../lib/constants'
import { sanitizeDocumentsDisplayLabel } from '../../../lib/displayLabels'
import { resolveUserLabels } from '../../../lib/userLabels'
import { resolveAuthPrincipalService } from '../../../lib/platformServices'
import type {
  ShareCreateCommandInput,
  ShareDeleteCommandInput,
  ShareUpdateCommandInput,
  ShareCommandResult,
} from '../../../commands/shares'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  loadScopedShare,
  readBody,
  resolveActorUserId,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeShare,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const shareDeleteSchema = z.object({
  id: z.string().uuid(),
})

const shareListResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    principalType: z.enum(['user', 'role']),
    principalId: z.string().uuid(),
    permission: z.enum(['viewer', 'commenter', 'editor']),
    createdByUserId: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
    principalLabel: z.string().nullable(),
    principalSecondary: z.string().nullable(),
  })),
  truncated: z.boolean(),
})

const shareMutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

const shareDeleteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.share'] },
  POST: { requireAuth: true, requireFeatures: ['documents.share'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.share'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.share'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

async function assertCanShare(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
): Promise<void> {
  const projection = await resolveDocumentCapabilityProjection(ctx, documentId)
  if (!projection.capabilities.canShare) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function assertCanMutateShares(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
): Promise<void> {
  await assertCanShare(ctx, documentId)
  await assertDocumentNotArchived(ctx, documentId)
}

type PrincipalLabel = { label: string; secondary?: string | null }

function cleanString(value: unknown): string | null {
  return sanitizeDocumentsDisplayLabel(value)
}

async function resolvePrincipalLabels(
  container: Awaited<ReturnType<typeof resolveDocumentsContext>>['container'],
  scope: { tenantId: string; organizationId: string },
  shares: DocumentShare[],
): Promise<Map<string, PrincipalLabel>> {
  const labels = new Map<string, PrincipalLabel>()
  const userIds = [...new Set(shares.filter((s) => s.principalType === 'user').map((s) => s.principalId))]
  const roleIds = [...new Set(shares.filter((s) => s.principalType === 'role').map((s) => s.principalId))]

  if (userIds.length > 0) {
    const userLabels = await resolveUserLabels(container, scope, userIds)
    for (const [userId, label] of userLabels.entries()) {
      labels.set(userId, label)
    }
  }

  if (roleIds.length > 0) {
    const roles = await resolveAuthPrincipalService(container)?.resolveLabels({
      type: 'role', ids: roleIds, scope,
    }) ?? []
    for (const role of roles) {
      const name = cleanString(role.label)
      if (name) labels.set(role.id, { label: name, secondary: null })
    }
  }

  return labels
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share'])
    await assertCanShare(ctx, documentId)
    const loadedShares = await findWithDecryption(
      ctx.em,
      DocumentShare,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'ASC', id: 'ASC' }, limit: DOCUMENTS_MAX_LISTED_SHARES + 1 },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const truncated = loadedShares.length > DOCUMENTS_MAX_LISTED_SHARES
    const shares = loadedShares.slice(0, DOCUMENTS_MAX_LISTED_SHARES)
    const labels = await resolvePrincipalLabels(
      ctx.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      shares,
    )
    const items = shares.map((share) => {
      const resolved = labels.get(share.principalId) ?? null
      return {
        ...serializeShare(share),
        principalLabel: resolved?.label ?? null,
        principalSecondary: resolved?.secondary ?? null,
      }
    })
    return NextResponse.json({ items, truncated })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share'])
    await assertCanMutateShares(ctx, documentId)
    const input = documentShareCreateSchema.parse(await readBody(request))
    const guardResourceId = `${documentId}:${input.principalType}:${input.principalId}`
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: guardResourceId,
      operation: 'create',
      mutationPayload: input,
    })

    const existing = await findOneWithDecryption(
      ctx.em,
      DocumentShare,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        principalType: input.principalType,
        principalId: input.principalId,
      },
      { filters: false, orderBy: { updatedAt: 'DESC' } },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const commandInput: ShareCreateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      shareId: existing?.id ?? randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: existing?.updatedAt.toISOString() ?? null,
      share: input,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<ShareCreateCommandInput, ShareCommandResult>(
      'documents.share.create',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: guardResourceId,
      operation: 'create',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ id: execution.result.id, updatedAt: execution.result.updatedAt }, { status: 201 }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentShare, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.create')
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share'])
    await assertCanMutateShares(ctx, documentId)
    const input = documentShareUpdateSchema.parse(await readBody(request))
    const share = await loadScopedShare(ctx, documentId, input.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      current: share.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'update',
      mutationPayload: input,
    })

    const commandInput: ShareUpdateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: share.updatedAt.toISOString(),
      share: input,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<ShareUpdateCommandInput, ShareCommandResult>(
      'documents.share.update',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'update',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ id: execution.result.id, updatedAt: execution.result.updatedAt }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentShare, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.update')
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share'])
    await assertCanMutateShares(ctx, documentId)
    const input = shareDeleteSchema.parse(await readBody(request))
    const share = await loadScopedShare(ctx, documentId, input.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      current: share.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'delete',
    })

    const commandInput: ShareDeleteCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      shareId: share.id,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: share.updatedAt.toISOString(),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<ShareDeleteCommandInput, ShareCommandResult>(
      'documents.share.delete',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'delete',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ ok: true, id: execution.result.id, updatedAt: execution.result.updatedAt }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentShare, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.delete')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document shares',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List document shares',
      responses: [{ status: 200, description: 'Document shares', schema: shareListResponseSchema }],
      errors: [{ status: 403, description: 'Forbidden', schema: routeErrorSchema }],
    },
    POST: {
      summary: 'Share document',
      requestBody: { contentType: 'application/json', schema: documentShareCreateSchema },
      responses: [{ status: 201, description: 'Document shared', schema: shareMutationResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document share',
      requestBody: { contentType: 'application/json', schema: documentShareUpdateSchema },
      responses: [{ status: 200, description: 'Share updated', schema: shareMutationResponseSchema }],
      errors: [
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Remove document share',
      requestBody: { contentType: 'application/json', schema: shareDeleteSchema },
      responses: [{ status: 200, description: 'Share removed', schema: shareDeleteResponseSchema }],
      errors: [
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST, PUT, DELETE }
