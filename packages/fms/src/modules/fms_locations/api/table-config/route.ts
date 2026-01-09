import { NextRequest } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { TableColumnConfig } from './table-config-generator'

const QUADRANT_VALUES = ['NE', 'NW', 'SE', 'SW']
const TYPE_VALUES = ['port', 'terminal']

const LOCATION_COLUMNS: TableColumnConfig[] = [
  {
    data: 'type',
    title: 'Type',
    width: 100,
    type: 'dropdown',
    source: TYPE_VALUES,
    readOnly: true,
    renderer: 'TypeRenderer',
  },
  {
    data: 'code',
    title: 'Code',
    width: 150,
    renderer: 'CodeRenderer',
  },
  {
    data: 'name',
    title: 'Name',
    width: 200,
  },
  {
    data: 'locode',
    title: 'UN/LOCODE',
    width: 120,
  },
  {
    data: 'quadrant',
    title: 'Quadrant',
    width: 100,
    type: 'dropdown',
    source: QUADRANT_VALUES,
    renderer: 'QuadrantRenderer',
  },
  {
    data: 'createdAt',
    title: 'Created At',
    width: 120,
    type: 'date',
    dateFormat: 'dd/MM/yyyy',
    readOnly: true,
  },
  {
    data: 'updatedAt',
    title: 'Updated At',
    width: 120,
    type: 'date',
    dateFormat: 'dd/MM/yyyy',
    readOnly: true,
  },
]

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return Response.json({
      columns: LOCATION_COLUMNS,
      meta: {
        entity: 'fms_location',
        totalColumns: LOCATION_COLUMNS.length,
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
  GET: { requireAuth: true, requireFeatures: ['fms_locations.ports.view'] },
}
