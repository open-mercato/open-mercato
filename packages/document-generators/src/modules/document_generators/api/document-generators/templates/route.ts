import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { NextResponse } from 'next/server'
import { templateRegistry } from '../../../lib/template-registry'
import { listTemplatesSchema } from '../../../data/validators'

export const metadata = {
  path: '/document-generators/templates',
  GET: { requireAuth: true, requireFeatures: ['document_generators.view'] },
}

/**
 * Returns all available document templates, optionally filtered by template metadata.
 *
 * @returns JSON array of TemplateMeta
 */
export async function GET(request: Request) {
  const { t } = await resolveTranslations()
  const searchParams = new URL(request.url).searchParams
  const resourceKind = searchParams.get('resource_kind') ?? undefined
  const documentType = searchParams.get('document_type') ?? undefined
  const format = searchParams.get('format') ?? undefined
  const tags = searchParams.getAll('tags')

  const queryResult = listTemplatesSchema.safeParse({
    resource_kind: resourceKind,
    document_type: documentType,
    format,
    tags,
  })

  if (!queryResult.success) {
    return NextResponse.json({
      error: 'invalid_query',
      message: t('document_generators.errors.invalid_query', 'The template filters are invalid.'),
    }, { status: 400 })
  }

  const filter = {
    resourceKind: queryResult.data.resource_kind,
    documentType: queryResult.data.document_type,
    format: queryResult.data.format,
    tags: queryResult.data.tags,
  }

  return NextResponse.json(templateRegistry.listTemplates(filter, t))
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      summary: 'List available document templates',
      responses: [
        { status: 200, description: 'TemplateMeta[]' },
        { status: 400, description: 'Invalid template metadata filter' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
