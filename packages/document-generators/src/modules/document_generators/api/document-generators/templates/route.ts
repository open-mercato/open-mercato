import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { NextResponse } from 'next/server'
import { templateRegistry } from '../../../lib/template-registry'

export const metadata = {
  path: '/document-generators/templates',
  GET: { requireAuth: true, requireFeatures: ['document_generators.view'] },
}

/**
 * Returns all available PDF templates grouped by source (internal and external).
 *
 * @returns JSON with `{ internal: TemplateMeta[], external: TemplateMeta[] }`
 */
export async function GET() {
  const { t } = await resolveTranslations()
  const templates = templateRegistry.listTemplates()
  return NextResponse.json({
    internal: templates.internal.map((template) => localizeTemplateMeta(template, t)),
    external: templates.external.map((template) => localizeTemplateMeta(template, t)),
  })
}

function localizeTemplateMeta(template: TemplateMeta, translate: TranslateFn): TemplateMeta {
  return {
    ...template,
    label: translate(template.label, template.label),
    description: translate(template.description, template.description),
  }
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      summary: 'List available PDF templates grouped by source',
      responses: [
        { status: 200, description: '{ internal: TemplateMeta[], external: TemplateMeta[] }' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
