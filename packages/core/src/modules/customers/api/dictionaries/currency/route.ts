"use server"

import { NextResponse } from 'next/server'
import { resolveDictionariesRouteContext } from '@open-mercato/core/modules/dictionaries/api/context'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
}

export async function GET(req: Request) {
  try {
    const context = await resolveDictionariesRouteContext(req)
    const { em, tenantId, organizationId, readableOrganizationIds, translate } = context

    const dictionaries = await em.find(
      Dictionary,
      {
        tenantId,
        key: { $in: ['currency', 'currencies'] },
        organizationId: { $in: readableOrganizationIds },
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
