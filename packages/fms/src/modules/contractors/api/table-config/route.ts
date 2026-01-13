import { NextRequest } from 'next/server'
import { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { Contractor } from '../../data/entities'
import { generateTableConfig, type DisplayHints } from './table-config-generator'

const CONTRACTOR_DISPLAY_HINTS: DisplayHints = {
  hiddenFields: ['addresses', 'contacts', 'roles', 'paymentTerms', 'creditLimit', 'parentId'],

  readOnlyFields: ['createdAt', 'updatedAt'],

  customRenderers: {
    name: 'ContractorNameRenderer',
    isActive: 'StatusBadgeRenderer',
  },

  dropdownSources: {},
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const metadata = em.getMetadata().get(Contractor.name)

    const columns = generateTableConfig(metadata, CONTRACTOR_DISPLAY_HINTS)

    return Response.json({
      columns,
      meta: {
        entity: 'contractor',
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
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
}
