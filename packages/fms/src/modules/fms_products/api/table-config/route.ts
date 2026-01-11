import { NextRequest } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'

export interface TableColumnConfig {
  data: string
  title: string
  width: number
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox'
  dateFormat?: string
  readOnly?: boolean
  source?: string[]
  renderer?: string
}

const CHARGE_UNIT_VALUES = ['per_container', 'per_piece', 'one_time']

const CHARGE_CODE_COLUMNS: TableColumnConfig[] = [
  {
    data: 'code',
    title: 'Code',
    width: 150,
    renderer: 'CodeRenderer',
  },
  {
    data: 'description',
    title: 'Description',
    width: 300,
  },
  {
    data: 'chargeUnit',
    title: 'Charge Unit',
    width: 150,
    type: 'dropdown',
    source: CHARGE_UNIT_VALUES,
    renderer: 'ChargeUnitRenderer',
  },
  {
    data: 'isActive',
    title: 'Active',
    width: 80,
    type: 'checkbox',
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
      columns: CHARGE_CODE_COLUMNS,
      meta: {
        entity: 'fms_charge_code',
        totalColumns: CHARGE_CODE_COLUMNS.length,
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
  GET: { requireAuth: true, requireFeatures: ['fms_products.charge_codes.view'] },
}
