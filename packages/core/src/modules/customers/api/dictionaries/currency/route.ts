import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

export async function GET(req: Request) {
  try {
    const { resolveDictionariesRouteContext } = await import('@open-mercato/core/modules/dictionaries/api/context')
    const context = await resolveDictionariesRouteContext(req)
    const { em, tenantId, organizationId, readableOrganizationIds, translate } = context

    const dictionaries = await em.find(
      Dictionary,
      {
        tenantId,
        key: { $in: ['currency', 'currencies'] },
        ...(readableOrganizationIds.length
          ? { organizationId: { $in: readableOrganizationIds } }
          : {}),
        deletedAt: null,
        isActive: true,
      },
      { orderBy: { organizationId: 'asc', createdAt: 'asc' } },
    )

    const dictionary =
      dictionaries.find((entry) => entry.organizationId === organizationId) ?? dictionaries[0] ?? null

    if (!dictionary) {
      return NextResponse.json(
        {
          error: translate(
            'customers.deals.form.currency.missing',
            'Currency dictionary is not configured yet.',
          ),
        },
        { status: 404 },
      )
    }

    const entries = await em.find(
      DictionaryEntry,
      {
        dictionary,
        tenantId,
        organizationId: dictionary.organizationId,
      },
      { orderBy: { label: 'asc' } },
    )

    return NextResponse.json({
      id: dictionary.id,
      entries: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
      })),
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers.currencyDictionary.GET] Unexpected error', err)
    return NextResponse.json({ error: 'Failed to load currency dictionary.' }, { status: 500 })
  }
}

const currencyDictionaryResponseSchema = z.object({
  id: z.string().uuid(),
  entries: z.array(
    z.object({
      id: z.string().uuid(),
      value: z.string(),
      label: z.string().nullable().optional(),
    }),
  ),
})

const currencyDictionaryErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Currency dictionary lookup',
  methods: {
    GET: {
      summary: 'Resolve currency dictionary',
      description: 'Returns the active currency dictionary for the current organization scope, falling back to shared entries when required.',
      responses: [
        { status: 200, description: 'Currency dictionary entries', schema: currencyDictionaryResponseSchema },
        { status: 404, description: 'Currency dictionary missing', schema: currencyDictionaryErrorSchema },
        { status: 401, description: 'Unauthorized', schema: currencyDictionaryErrorSchema },
        { status: 500, description: 'Unexpected error', schema: currencyDictionaryErrorSchema },
      ],
    },
  },
}
