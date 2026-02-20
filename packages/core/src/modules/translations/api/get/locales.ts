import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { locales as defaultLocales } from '@open-mercato/shared/lib/i18n/config'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['translations.view'] },
}

async function GET(req: Request) {
  try {
    const context = await resolveTranslationsRouteContext(req)

    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    const locales = await configService.getValue<string[]>('translations', 'supported_locales', {
      defaultValue: [...defaultLocales],
    })

    return NextResponse.json({ locales: Array.isArray(locales) ? locales : [...defaultLocales] })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[translations/locales.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  locales: z.array(z.string()),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'List supported translation locales',
  tags: ['Translations'],
  responses: [
    { status: 200, description: 'Supported locales list', schema: responseSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Translations',
  summary: 'List supported translation locales',
  methods: {
    GET: getDoc,
  },
}

export default GET
