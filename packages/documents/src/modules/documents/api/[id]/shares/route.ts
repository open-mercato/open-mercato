import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Role, User } from '@open-mercato/core/modules/auth/data/entities'
import { DocumentShare } from '../../../data/entities'
import { documentShareCreateSchema, documentShareUpdateSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { emitDocumentsEvent } from '../../../events'
import { assertTier } from '../../../lib/permissions'
import {
  handleDocumentsRouteError,
  loadScopedShare,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  serializeShare,
  validateMutationGuard,
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
  })),
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

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share', 'documents.manage'])
    await assertTier(ctx.em, documentId, ctx.auth, 'owner')
    const shares = await ctx.em.find(
      DocumentShare,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'ASC' } },
    )
    return NextResponse.json({ items: shares.map(serializeShare) })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share', 'documents.manage'])
    await assertTier(ctx.em, documentId, ctx.auth, 'owner')
    const input = documentShareCreateSchema.parse(await readBody(request))
    if (input.principalType === 'role') {
      const role = await ctx.em.findOne(Role, {
        id: input.principalId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      } as FilterQuery<Role>)
      if (!role) throw new CrudHttpError(400, { error: 'Share principal not found in this organization' })
    } else {
      const user = await ctx.em.findOne(User, {
        id: input.principalId,
        tenantId: ctx.tenantId,
        deletedAt: null,
        $or: [{ organizationId: null }, { organizationId: ctx.organizationId }],
      } as FilterQuery<User>)
      if (!user) throw new CrudHttpError(400, { error: 'Share principal not found in this organization' })
    }
    const guardResourceId = `${documentId}:${input.principalType}:${input.principalId}`
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: guardResourceId,
      operation: 'create',
      mutationPayload: input,
    })

    const existing = await ctx.em.findOne(
      DocumentShare,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        principalType: input.principalType,
        principalId: input.principalId,
      },
      { orderBy: { updatedAt: 'DESC' } },
    )
    const now = new Date()
    const share = existing ?? ctx.em.create(DocumentShare, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      principalType: input.principalType,
      principalId: input.principalId,
      permission: input.permission,
      createdByUserId: resolveActorUserId(ctx.auth),
    })
    share.permission = input.permission
    share.deletedAt = null
    share.updatedAt = now
    if (!existing) ctx.em.persist(share)
    await ctx.em.flush()

    await emitDocumentsEvent('documents.document.shared', {
      id: documentId,
      shareId: share.id,
      principalType: share.principalType,
      principalId: share.principalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: guardResourceId,
      operation: 'create',
    })

    return NextResponse.json({ id: share.id, updatedAt: share.updatedAt.toISOString() }, { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.create')
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share', 'documents.manage'])
    await assertTier(ctx.em, documentId, ctx.auth, 'owner')
    const input = documentShareUpdateSchema.parse(await readBody(request))
    const share = await loadScopedShare(ctx, documentId, input.id)
    enforceCommandOptimisticLock({
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

    share.permission = input.permission
    share.updatedAt = new Date()
    await ctx.em.flush()

    await emitDocumentsEvent('documents.document.shared', {
      id: documentId,
      shareId: share.id,
      principalType: share.principalType,
      principalId: share.principalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'update',
    })

    return NextResponse.json({ id: share.id, updatedAt: share.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.update')
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.share', 'documents.manage'])
    await assertTier(ctx.em, documentId, ctx.auth, 'owner')
    const input = shareDeleteSchema.parse(await readBody(request))
    const share = await loadScopedShare(ctx, documentId, input.id)
    enforceCommandOptimisticLock({
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

    const now = new Date()
    share.deletedAt = now
    share.updatedAt = now
    await ctx.em.flush()

    await emitDocumentsEvent('documents.document.unshared', {
      id: documentId,
      shareId: share.id,
      principalType: share.principalType,
      principalId: share.principalId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: resolveActorUserId(ctx.auth),
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: share.id,
      operation: 'delete',
    })

    return NextResponse.json({ ok: true, id: share.id, updatedAt: share.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.shares.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
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
      errors: [{ status: 400, description: 'Validation failed', schema: routeErrorSchema }],
    },
    PUT: {
      summary: 'Update document share',
      requestBody: { contentType: 'application/json', schema: documentShareUpdateSchema },
      responses: [{ status: 200, description: 'Share updated', schema: shareMutationResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
    DELETE: {
      summary: 'Remove document share',
      requestBody: { contentType: 'application/json', schema: shareDeleteSchema },
      responses: [{ status: 200, description: 'Share removed', schema: shareDeleteResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
  },
}

export default { GET, POST, PUT, DELETE }
