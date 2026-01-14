import { NextRequest } from 'next/server'
import { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { FmsQuote } from '../../data/entities'
import { generateTableConfig, type DisplayHints } from './table-config-generator'
import {
  FMS_QUOTE_STATUSES,
  FMS_DIRECTIONS,
  FMS_INCOTERMS,
  FMS_CARGO_TYPES,
} from '../../data/types'

const QUOTE_DISPLAY_HINTS: DisplayHints = {
  hiddenFields: ['offers', 'lines'],

  readOnlyFields: ['createdAt', 'updatedAt'],

  customRenderers: {
    quoteNumber: 'QuoteNumberRenderer',
    status: 'StatusRenderer',
  },

  dropdownSources: {
    status: [...FMS_QUOTE_STATUSES],
    direction: [...FMS_DIRECTIONS],
    incoterm: [...FMS_INCOTERMS],
    cargoType: [...FMS_CARGO_TYPES],
  },

  additionalColumns: [
    {
      data: 'client.name',
      title: 'Client',
      width: 150,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'originPortsDisplay',
      title: 'Origin Ports',
      width: 150,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'destinationPortsDisplay',
      title: 'Dest. Ports',
      width: 150,
      type: 'text',
      readOnly: true,
    },
  ],
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const metadata = em.getMetadata().get(FmsQuote.name)

    const columns = generateTableConfig(metadata, QUOTE_DISPLAY_HINTS)

    return Response.json({
      columns,
      meta: {
        entity: 'fms_quote',
        totalColumns: columns.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to generate table config:', error)
    return Response.json(
      {
        error: 'Failed to generate table configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
}
