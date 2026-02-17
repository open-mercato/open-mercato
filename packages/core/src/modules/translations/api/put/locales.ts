import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslationsRouteContext } from '@open-mercato/core/modules/translations/api/context'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { isValidIso639 } from '@open-mercato/shared/lib/i18n/iso639'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const bodySchema = z.object({
  locales: z.array(
    z.string().min(2).max(10).refine(isValidIso639, { message: 'Invalid ISO 639-1 language code' }),
  ).min(1).max(50),
})

export const metadata = {
  PUT: { requireAuth: true },
}

async function PUT(req: Request) {
  try {
    const context = await resolveTranslationsRouteContext(req)
    const body = bodySchema.parse(await req.json())
    const uniqueLocales = [...new Set(body.locales.map((l) => l.toLowerCase().trim()))]

    const existing = await context.knex('module_configs')
      .where({ module_id: 'translations', name: 'supported_locales' })
      .first()

    if (existing) {
      await context.knex('module_configs')
        .where({ id: existing.id })
        .update({ value_json: JSON.stringify(uniqueLocales), updated_at: new Date() })
    } else {
      await context.knex('module_configs').insert({
        id: context.knex.raw('gen_random_uuid()'),
        module_id: 'translations',
        name: 'supported_locales',
        value_json: JSON.stringify(uniqueLocales),
        created_at: new Date(),
        updated_at: new Date(),
      })
    }

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
