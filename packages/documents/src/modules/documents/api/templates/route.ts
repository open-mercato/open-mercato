import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { DocumentTemplate } from '../../data/entities'
import {
  documentTemplateContextSlotSchema,
  documentTemplateCreateSchema,
  documentTemplateUpdateSchema,
} from '../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../lib/constants'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../lib/requestBody'
import type {
  TemplateCommandResult,
  TemplateCreateCommandInput,
  TemplateDeleteCommandInput,
  TemplateUpdateCommandInput,
} from '../../commands/templates'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../_commands'
import {
  handleDocumentsRouteError,
  hasDocumentsFeature,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../_shared'

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  includeBody: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).refine((query) => (query.page === undefined) === (query.pageSize === undefined), {
  message: 'page and pageSize must be provided together',
})

const DEFAULT_TEMPLATE_PAGE = 1
const DEFAULT_TEMPLATE_PAGE_SIZE = 50
const TEMPLATE_SUMMARY_FIELDS = [
  'id',
  'name',
  'description',
  'contextSlots',
  'isActive',
  'updatedAt',
  'createdAt',
] as const

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
  items: z.array(templateItemSchema.omit({ bodyHtml: true }).extend({ bodyHtml: z.string().optional() })),
  total: z.number(),
  capabilities: z.object({ canManageTemplates: z.boolean() }),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
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

function serializeTemplate(template: DocumentTemplate, includeBody = true): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    ...(includeBody ? { bodyHtml: template.bodyHtml } : {}),
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
  const template = await findOneWithDecryption(
    ctx.em,
    DocumentTemplate,
    {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!template) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
  return template
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const url = new URL(request.url)
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const page = query.page ?? DEFAULT_TEMPLATE_PAGE
    const pageSize = query.pageSize ?? DEFAULT_TEMPLATE_PAGE_SIZE
    // Template bodies are manageable-only. A view-only caller never receives
    // bodyHtml, even when it asks for it; instantiation/slot flows request
    // includeBody=false and are unaffected.
    const canManageTemplates = hasDocumentsFeature(ctx.auth, 'documents.templates.manage')
    const includeBody = (query.includeBody ?? true) && canManageTemplates
    const where: FilterQuery<DocumentTemplate> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(query.search ? {
        $or: [
          { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { description: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ],
      } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    }
    const [templates, total] = await Promise.all([
      findWithDecryption(
        ctx.em,
        DocumentTemplate,
        where,
        {
          orderBy: { name: 'ASC', id: 'ASC' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
          ...(includeBody ? {} : { fields: TEMPLATE_SUMMARY_FIELDS }),
        },
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      ),
      ctx.em.count(DocumentTemplate, where),
    ])
    return NextResponse.json({
      items: templates.map((template) => serializeTemplate(template, includeBody)),
      total,
      capabilities: {
        canManageTemplates,
      },
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.list')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = documentTemplateCreateSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.template,
    ))
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: 'new',
      operation: 'create',
      mutationPayload: input,
    })

    const commandInput: TemplateCreateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      templateId: randomUUID(),
      actorUserId: resolveActorUserId(ctx.auth),
      template: input,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<TemplateCreateCommandInput, TemplateCommandResult>(
      'documents.template.create',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: 'new',
      operation: 'create',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ id: execution.result.id, updatedAt: execution.result.updatedAt }, { status: 201 }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.create')
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = documentTemplateUpdateSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.template,
    ))
    const template = await loadScopedTemplate(ctx, input.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
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

    const commandInput: TemplateUpdateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: template.updatedAt.toISOString(),
      template: input,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<TemplateUpdateCommandInput, TemplateCommandResult>(
      'documents.template.update',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'update',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ id: execution.result.id, updatedAt: execution.result.updatedAt }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.update')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await resolveDocumentsContext(request, ['documents.templates.manage'])
    const input = templateDeleteSchema.parse(await readBody(request))
    const template = await loadScopedTemplate(ctx, input.id)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
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

    const commandInput: TemplateDeleteCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      templateId: template.id,
      actorUserId: resolveActorUserId(ctx.auth),
      expectedUpdatedAt: template.updatedAt.toISOString(),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<TemplateDeleteCommandInput, TemplateCommandResult>(
      'documents.template.delete',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: template.id,
      operation: 'delete',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ ok: true, id: execution.result.id, updatedAt: execution.result.updatedAt }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.delete')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
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
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update document template',
      requestBody: { contentType: 'application/json', schema: documentTemplateUpdateSchema },
      responses: [{ status: 200, description: 'Template updated', schema: mutationResponseSchema }],
      errors: [
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete document template',
      requestBody: { contentType: 'application/json', schema: templateDeleteSchema },
      responses: [{ status: 200, description: 'Template deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST, PUT, DELETE }
