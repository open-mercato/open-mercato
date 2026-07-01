import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryImportValidateSchema } from '../../../../data/validators'
import { executeWmsInventoryImportRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.import'] },
}

export async function POST(request: Request) {
  return executeWmsInventoryImportRoute({
    request,
    routePath: 'wms/inventory/import/validate',
    mode: 'validate',
  })
}

const rowResultSchema = z.object({
  rowNumber: z.number(),
  status: z.enum(['valid', 'error', 'warning', 'skip']),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
})

const successSchema = z.object({
  ok: z.boolean(),
  importBatchId: z.string().uuid(),
  summary: z.object({
    totalRows: z.number(),
    validRows: z.number(),
    errorRows: z.number(),
    warningRows: z.number(),
    skipRows: z.number(),
  }),
  rows: z.array(rowResultSchema),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Validate inventory CSV import',
  methods: {
    POST: {
      summary: 'Validate inventory CSV import',
      description:
        'Dry-run validation for inventory opening-balance CSV rows. Accepts JSON rows, JSON csv text, or multipart file upload.',
      requestBody: { contentType: 'application/json', schema: inventoryImportValidateSchema },
      responses: [{ status: 200, description: 'Validation report', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
