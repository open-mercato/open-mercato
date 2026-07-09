import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { DocumentTemplate } from '../../data/entities'
import {
  documentTemplateContextSlotSchema,
  documentTemplateCreateSchema,
  documentTemplateUpdateSchema,
} from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import {
  handleDocumentsRouteError,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
} from '../_shared'

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
})

const templateDeleteSchema = z.object({
  id: z.string().uuid(),
})

const templateItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  bodyHtml: z.string(),
  contextSlots: z.array(documentTemplateContextSlotSchema).nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
  createdAt: z.string(),
})

const templateListResponseSchema = z.object({
  items: z.array(templateItemSchema),
  total: z.number(),
})

const mutationResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

const deleteResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.templates.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['documents.templates.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['documents.templates.manage'] },
}

function serializeTemplate(template: DocumentTemplate): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    bodyHtml: template.bodyHtml,
    contextSlots: template.contextSlots ?? null,
    isActive: template.isActive,
    updatedAt: template.updatedAt.toISOString(),
    createdAt: template.createdAt.toISOString(),
  }
}

async function loadScopedTemplate(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  id: string,
): Promise<DocumentTemplate> {
  const template = await ctx.em.findOne(DocumentTemplate, {
    id,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!template) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
  return template
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const url = new URL(request.url)
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const where: FilterQuery<DocumentTemplate> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(query.search ? { name: { $ilike: `%${query.search}%` } } : {}),
    }
    const templates = await ctx.em.find(DocumentTemplate, where, { orderBy: { name: 'ASC' } })
    return NextResponse.json({
      items: templates.map(serializeTemplate),
      total: templates.length,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.list')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = documentTemplateCreateSchema.parse(await readBody(request))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
    })

    const template = ctx.em.create(DocumentTemplate, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      name: input.name,
      description: input.description ?? null,
      bodyHtml: input.bodyHtml,
      contextSlots: input.contextSlots ?? null,
      createdByUserId: resolveActorUserId(ctx.auth),
      isActive: input.isActive ?? true,
    })
    ctx.em.persist(template)
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: 'new',
      operation: 'create',
    })

    return NextResponse.json({ id: template.id, updatedAt: template.updatedAt.toISOString() }, { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.create')
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = documentTemplateUpdateSchema.parse(await readBody(request))
    const template = await loadScopedTemplate(ctx, input.id)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      current: template.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'update',
      mutationPayload: input,
    })

    if (input.name !== undefined) template.name = input.name
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      template.description = input.description ?? null
    }
    if (input.bodyHtml !== undefined) template.bodyHtml = input.bodyHtml
    if (Object.prototype.hasOwnProperty.call(input, 'contextSlots')) {
      template.contextSlots = input.contextSlots ?? null
    }
    if (input.isActive !== undefined) template.isActive = input.isActive
    template.updatedAt = new Date()
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'update',
    })

    return NextResponse.json({ id: template.id, updatedAt: template.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.update')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = templateDeleteSchema.parse(await readBody(request))
    const template = await loadScopedTemplate(ctx, input.id)
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      current: template.updatedAt,
      request,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'delete',
    })

    const now = new Date()
    template.deletedAt = now
    template.updatedAt = now
    await ctx.em.flush()
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'delete',
    })

    return NextResponse.json({ ok: true, id: template.id, updatedAt: template.updatedAt.toISOString() })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.delete')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document templates',
  methods: {
    GET: {
      summary: 'List document templates',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Template list', schema: templateListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document template',
      requestBody: { contentType: 'application/json', schema: documentTemplateCreateSchema },
      responses: [{ status: 201, description: 'Template created', schema: mutationResponseSchema }],
      errors: [{ status: 400, description: 'Validation failed', schema: routeErrorSchema }],
    },
    PUT: {
      summary: 'Update document template',
      requestBody: { contentType: 'application/json', schema: documentTemplateUpdateSchema },
      responses: [{ status: 200, description: 'Template updated', schema: mutationResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
    DELETE: {
      summary: 'Delete document template',
      requestBody: { contentType: 'application/json', schema: templateDeleteSchema },
      responses: [{ status: 200, description: 'Template deleted', schema: deleteResponseSchema }],
      errors: [{ status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema }],
    },
  },
}

export default { GET, POST, PUT, DELETE }
