import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildInventoryImportTemplateCsv } from '../../../../lib/inventoryImportCsv'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.import'] },
}

export async function GET() {
  const csv = buildInventoryImportTemplateCsv()
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="wms-inventory-import-template.csv"',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Download inventory import CSV template',
  methods: {
    GET: {
      summary: 'Download inventory import CSV template',
      description:
        'Returns a CSV template for WMS inventory receipt imports. The quantity column is added to existing on-hand stock, not a target balance.',
      responses: [{ status: 200, description: 'CSV template file' }],
    },
  },
}
