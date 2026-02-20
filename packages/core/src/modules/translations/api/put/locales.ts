import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { isValidIso639 } from '@open-mercato/shared/lib/i18n/iso639'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const bodySchema = z.object({
  locales: z.array(
    z.string().min(2).max(10).refine(isValidIso639, { message: 'Invalid ISO 639-1 language code' }),
  ).min(1).max(50),
})

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['translations.manage_locales'] },
}

async function PUT(req: Request) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    const body = bodySchema.parse(await req.json())
    const uniqueLocales = [...new Set(body.locales.map((l) => l.toLowerCase().trim()))]

    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    await configService.setValue('translations', 'supported_locales', uniqueLocales)

    return NextResponse.json({ locales: uniqueLocales })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: err.issues }, { status: 400 })
    }
    console.error('[translations/locales.PUT] Unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  locales: z.array(z.string()),
})

const putDoc: OpenApiMethodDoc = {
  summary: 'Update supported translation locales',
  tags: ['Translations'],
  requestBody: {
    schema: bodySchema,
  },
  responses: [
    { status: 200, description: 'Updated locales list', schema: responseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid request body' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Translations',
  summary: 'Update supported translation locales',
  methods: {
    PUT: putDoc,
  },
}

export default PUT
