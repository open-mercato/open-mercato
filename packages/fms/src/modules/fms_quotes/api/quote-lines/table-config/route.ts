import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'

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
      data: 'lineNumber',
      title: '#',
      width: 50,
      type: 'numeric',
      readOnly: true,
    },
    {
      data: 'chargeCode',
      title: 'Charge',
      width: 70,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'productName',
      title: 'Product',
      width: 200,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'providerName',
      title: 'Provider',
      width: 130,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'containerSize',
      title: 'Type',
      width: 70,
      type: 'text',
      readOnly: true,
    },
    {
      data: 'quantity',
      title: 'Qty',
      width: 70,
      type: 'numeric',
    },
    {
      data: 'unitCost',
      title: 'Cost',
      width: 90,
      type: 'numeric',
      readOnly: true,
    },
    {
      data: 'marginPercent',
      title: 'Margin%',
      width: 80,
      type: 'numeric',
    },
    {
      data: 'unitSales',
      title: 'Sales',
      width: 90,
      type: 'numeric',
    },
    {
      data: 'currencyCode',
      title: 'Ccy',
      width: 50,
      type: 'text',
      readOnly: true,
    },
  ]

  return NextResponse.json({
    columns,
    meta: {
      entity: 'fms_quote_line',
      totalColumns: columns.length,
      generatedAt: new Date().toISOString(),
    },
  })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_quotes.quotes.view'] },
}
