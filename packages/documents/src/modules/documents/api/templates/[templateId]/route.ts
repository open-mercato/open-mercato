import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentTemplate } from '../../../data/entities'
import { documentTemplateContextSlotSchema } from '../../../data/validators'
import {
  handleDocumentsRouteError,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ templateId: string }> | { templateId: string }
}

const templateIdSchema = z.string().uuid()

const templateDetailResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  bodyHtml: z.string(),
  contextSlots: z.array(documentTemplateContextSlotSchema).nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
  createdAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const templateId = templateIdSchema.parse((await context.params).templateId)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const template = await findOneWithDecryption(
      ctx.em,
      DocumentTemplate,
      {
        id: templateId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (!template) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })

    return NextResponse.json({
      id: template.id,
      name: template.name,
      description: template.description ?? null,
      bodyHtml: template.bodyHtml,
      contextSlots: template.contextSlots ?? null,
      isActive: template.isActive,
      updatedAt: template.updatedAt.toISOString(),
      createdAt: template.createdAt.toISOString(),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.detail')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document template detail',
  pathParams: z.object({ templateId: templateIdSchema }),
  methods: {
    GET: {
      summary: 'Get a document template including its body',
      responses: [{ status: 200, description: 'Template detail', schema: templateDetailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid template id', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Template not found', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET }
