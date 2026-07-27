import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { inventoryImportApplySchema } from '../../../../data/validators'
import { executeWmsInventoryImportRoute } from '../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['wms.import'] },
}

export async function POST(request: Request) {
  return executeWmsInventoryImportRoute({
    request,
    routePath: 'wms/inventory/import/apply',
    mode: 'apply',
  })
}

const successSchema = z.object({
  ok: z.boolean(),
  importBatchId: z.string().uuid(),
  summary: z.object({
    applied: z.number(),
    skipped: z.number(),
    failed: z.number(),
  }),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Apply inventory CSV import',
  methods: {
    POST: {
      summary: 'Apply inventory CSV import',
      description:
        'Applies validated inventory import rows via wms.inventory.adjust commands (idempotent skip when delta is zero).',
      requestBody: { contentType: 'application/json', schema: inventoryImportApplySchema },
      responses: [{ status: 200, description: 'Import applied', schema: successSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 409, description: 'Partial apply failure', schema: errorSchema },
      ],
    },
  },
}
