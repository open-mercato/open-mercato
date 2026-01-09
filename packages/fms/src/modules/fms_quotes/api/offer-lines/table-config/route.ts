import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import {
  FMS_CHARGE_CATEGORIES,
  FMS_CHARGE_UNITS,
  FMS_CONTAINER_TYPES,
} from '../../../data/types'

type TableColumnConfig = {
  data: string
  title: string
  width: number
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox'
  dateFormat?: string
  readOnly?: boolean
  source?: string[]
  renderer?: string
}

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const columns: TableColumnConfig[] = [
    {
      data: 'chargeName',
      title: 'Charge Name',
      width: 180,
      type: 'text',
    },
    {
      data: 'chargeCategory',
      title: 'Category',
      width: 120,
      type: 'dropdown',
      source: [...FMS_CHARGE_CATEGORIES],
    },
    {
      data: 'chargeUnit',
      title: 'Unit',
      width: 130,
      type: 'dropdown',
      source: [...FMS_CHARGE_UNITS],
    },
    {
      data: 'containerType',
      title: 'Container',
      width: 100,
      type: 'dropdown',
      source: ['', ...FMS_CONTAINER_TYPES],
    },
    {
      data: 'quantity',
      title: 'Qty',
      width: 70,
      type: 'numeric',
    },
    {
      data: 'currencyCode',
      title: 'Ccy',
      width: 60,
      type: 'text',
    },
    {
      data: 'unitPrice',
      title: 'Unit Price',
      width: 100,
      type: 'numeric',
    },
    {
      data: 'amount',
      title: 'Amount',
      width: 100,
      type: 'numeric',
    },
  ]

  return NextResponse.json({
    columns,
    meta: {
      entity: 'fms_offer_line',
      totalColumns: columns.length,
      generatedAt: new Date().toISOString(),
    },
  })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
}
