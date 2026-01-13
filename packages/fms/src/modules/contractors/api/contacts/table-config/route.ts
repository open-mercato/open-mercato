import { NextRequest } from 'next/server'
import { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { ContractorContact } from '../../../data/entities'
import { generateTableConfig, type DisplayHints } from '../../table-config/table-config-generator'

const CONTACT_DISPLAY_HINTS: DisplayHints = {
  hiddenFields: ['contractor', 'notes'],

  readOnlyFields: ['createdAt', 'updatedAt'],

  customRenderers: {
    isPrimary: 'CheckboxRenderer',
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
    const metadata = em.getMetadata().get(ContractorContact.name)

    const columns = generateTableConfig(metadata, CONTACT_DISPLAY_HINTS)

    return Response.json({
      columns,
      meta: {
        entity: 'contractor_contact',
        totalColumns: columns.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to generate contact table config:', error)
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
