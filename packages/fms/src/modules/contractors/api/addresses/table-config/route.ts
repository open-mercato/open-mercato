import { NextRequest } from 'next/server'
import { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { ContractorAddress } from '../../../data/entities'
import { generateTableConfig, type DisplayHints } from '../../table-config/table-config-generator'

const ADDRESS_PURPOSES = ['office', 'warehouse', 'billing', 'shipping', 'other']

const ADDRESS_DISPLAY_HINTS: DisplayHints = {
  hiddenFields: ['contractor'],

  readOnlyFields: ['createdAt', 'updatedAt'],

  customRenderers: {
    isPrimary: 'CheckboxRenderer',
    isActive: 'StatusBadgeRenderer',
  },

  dropdownSources: {
    purpose: ADDRESS_PURPOSES,
  },
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const metadata = em.getMetadata().get(ContractorAddress.name)

    const columns = generateTableConfig(metadata, ADDRESS_DISPLAY_HINTS)

    return Response.json({
      columns,
      meta: {
        entity: 'contractor_address',
        totalColumns: columns.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to generate address table config:', error)
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
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
}
