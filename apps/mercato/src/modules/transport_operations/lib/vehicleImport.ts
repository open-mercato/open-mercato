import { VEHICLE_STATUS_VALUES } from './transportEnums'
import {
  buildImportTemplateCsv,
  parseImportRows,
  type ImportColumnSpec,
  type ImportParseResult,
} from './importRows'

/**
 * Header aliases for the bulk vehicle importer. The plate number is the only
 * human identity a fleet sheet reliably carries, so it is required together
 * with the make, model and year; the remaining columns map to the vehicle form.
 */
export const VEHICLE_IMPORT_COLUMNS: Record<string, ImportColumnSpec> = {
  plateNumber: { aliases: ['plateNumber', 'plate_number', 'plate', 'plate_no', 'registration'] },
  vin: { aliases: ['vin', 'chassis', 'chassis_number'] },
  sequenceNumber: { aliases: ['sequenceNumber', 'sequence_number', 'sequence', 'fleet_number'] },
  make: { aliases: ['make', 'manufacturer', 'brand'] },
  model: { aliases: ['model'] },
  year: { aliases: ['year', 'model_year'], kind: 'number' },
  capacity: { aliases: ['capacity', 'seats', 'seats_count'], kind: 'number' },
  color: { aliases: ['color', 'colour'] },
  vehicleType: { aliases: ['vehicleType', 'vehicle_type', 'type'] },
  currentOdometer: { aliases: ['currentOdometer', 'current_odometer', 'odometer', 'km'], kind: 'number' },
  status: { aliases: ['status'], kind: 'enum', enumValues: VEHICLE_STATUS_VALUES },
  telematicsDeviceId: { aliases: ['telematicsDeviceId', 'telematics_device_id', 'device_id'] },
  notes: { aliases: ['notes', 'note', 'remarks'] },
}

const REQUIRED_FIELDS = ['plateNumber', 'make', 'model', 'year'] as const

export function parseVehicleImportRows(objects: Array<Record<string, string>>): ImportParseResult {
  return parseImportRows(objects, { columns: VEHICLE_IMPORT_COLUMNS, required: REQUIRED_FIELDS })
}

export const VEHICLE_IMPORT_TEMPLATE_HEADERS = [
  'plateNumber',
  'vin',
  'sequenceNumber',
  'make',
  'model',
  'year',
  'capacity',
  'color',
  'vehicleType',
  'currentOdometer',
  'status',
  'telematicsDeviceId',
  'notes',
]

export function buildVehicleImportTemplateCsv(): string {
  return buildImportTemplateCsv(VEHICLE_IMPORT_TEMPLATE_HEADERS, [
    'ABC-1234',
    'JTMBFREV00J000000',
    'FLT-001',
    'Toyota',
    'Hiace',
    '2024',
    '14',
    'White',
    'Van',
    '52000',
    'active',
    'TEL-0001',
    '',
  ])
}
