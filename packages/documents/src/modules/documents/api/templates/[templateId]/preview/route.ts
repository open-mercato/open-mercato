import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DocumentTemplate } from '../../../../data/entities'
import { documentTemplatePreviewSchema } from '../../../../data/validators'
import { prepareTemplateRender } from '../../../../lib/templateInstantiation'
import { DOCUMENTS_JSON_BODY_LIMITS } from '../../../../lib/requestBody'
import {
  handleDocumentsRouteError,
  readBody,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../../_shared'

type RouteContext = {
  params: Promise<{ templateId: string }> | { templateId: string }
}

const previewResponseSchema = z.object({
  contentHtml: z.string(),
  unresolvedTokens: z.array(z.string()),
  templateUpdatedAt: z.string(),
  previewDigest: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.create'] },
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const templateId = (await context.params).templateId
    const ctx = await resolveDocumentsContext(request, ['documents.create'])
    const input = documentTemplatePreviewSchema.parse(await readBody(
      request,
      DOCUMENTS_JSON_BODY_LIMITS.templateRender,
    ))
    const template = await findOneWithDecryption(
      ctx.em,
      DocumentTemplate,
      {
        id: templateId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
      undefined,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    if (!template) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
    const prepared = await prepareTemplateRender({
      request,
      template,
      title: input.title,
      locale: input.locale,
      effectiveDate: input.effectiveDate,
      templateUpdatedAt: input.templateUpdatedAt,
      slots: input.slots,
      userFeatures: ctx.auth.features,
    })
    return NextResponse.json({
      contentHtml: prepared.render.html,
      unresolvedTokens: prepared.render.unresolvedTokens,
      templateUpdatedAt: template.updatedAt.toISOString(),
      previewDigest: prepared.previewDigest,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.templates.preview')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Preview a contextual document template',
  pathParams: z.object({ templateId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Render a template preview without writing data',
      requestBody: { contentType: 'application/json', schema: documentTemplatePreviewSchema },
      responses: [{ status: 200, description: 'Rendered template preview', schema: previewResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Template not found', schema: routeErrorSchema },
        { status: 409, description: 'Template revision changed', schema: routeErrorSchema },
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
        { status: 503, description: 'Target lookup unavailable', schema: routeErrorSchema },
      ],
    },
  },
}

export default { POST }
