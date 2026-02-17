import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { locales as defaultLocales } from '@open-mercato/shared/lib/i18n/config'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true },
}

async function GET(req: Request) {
  try {
    const context = await resolveTranslationsRouteContext(req)

    const configRow = await context.knex('module_configs')
      .where({ module_id: 'translations', name: 'supported_locales' })
      .first()

    const locales: string[] =
      Array.isArray(configRow?.value_json) ? configRow.value_json : [...defaultLocales]

    return NextResponse.json({ locales })
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
