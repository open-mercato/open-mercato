import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createVehicleSchema } from '../../../data/validators'
import { TRANSPORT_VEHICLE_ENTITY_ID } from '../../../commands/transport'
import { importBodySchema, importResponseSchema, runTransportImport } from '../../../lib/importRoute'

export const metadata = {
  path: '/transport_operations/vehicles/import',
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
}

export async function POST(req: Request): Promise<Response> {
  return runTransportImport(req, {
    resourceKind: TRANSPORT_VEHICLE_ENTITY_ID,
    resourceId: 'import:vehicles',
    commandId: 'transport_operations.vehicles.create',
    schema: createVehicleSchema,
    failureKey: 'transport_operations.errors.import_row_failed',
    failureFallback: 'The vehicle could not be imported.',
    logEvent: 'transport_operations.vehicle_import.failed',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Import vehicles from a spreadsheet',
  methods: {
    POST: {
      summary: 'Validate (dry-run) or commit a batch of vehicles',
      requestBody: { contentType: 'application/json', schema: importBodySchema },
      responses: [{
        status: 200,
        description: 'Per-row validation or creation report',
        schema: importResponseSchema,
      }],
    },
  },
}
