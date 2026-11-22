import { DRIVER_STATUS_VALUES } from './transportEnums'
import {
  buildImportTemplateCsv,
  parseImportRows,
  type ImportColumnSpec,
  type ImportParseResult,
} from './importRows'

/**
 * Header aliases for the bulk driver importer. The staff user and employee
 * links are deliberately not imported: they are UUIDs that an operator would
 * have to copy by hand, and an imported driver can be linked from the edit form.
 */
export const DRIVER_IMPORT_COLUMNS: Record<string, ImportColumnSpec> = {
  fullName: { aliases: ['fullName', 'full_name', 'name', 'driver', 'driver_name'] },
  nationalId: { aliases: ['nationalId', 'national_id', 'id_number', 'national_id_number', 'iqama'] },
  licenseNumber: { aliases: ['licenseNumber', 'license_number', 'license', 'licence', 'licence_number'] },
  licenseExpiry: {
    aliases: ['licenseExpiry', 'license_expiry', 'license_expiry_date', 'licence_expiry', 'expiry'],
    kind: 'date',
  },
  phone: { aliases: ['phone', 'mobile', 'phone_number', 'telephone'] },
  status: { aliases: ['status'], kind: 'enum', enumValues: DRIVER_STATUS_VALUES },
}

const REQUIRED_FIELDS = ['fullName', 'nationalId', 'licenseNumber', 'licenseExpiry', 'phone'] as const

export function parseDriverImportRows(objects: Array<Record<string, string>>): ImportParseResult {
  return parseImportRows(objects, { columns: DRIVER_IMPORT_COLUMNS, required: REQUIRED_FIELDS })
}

export const DRIVER_IMPORT_TEMPLATE_HEADERS = [
  'fullName',
  'nationalId',
  'licenseNumber',
  'licenseExpiry',
  'phone',
  'status',
]

export function buildDriverImportTemplateCsv(): string {
  return buildImportTemplateCsv(DRIVER_IMPORT_TEMPLATE_HEADERS, [
    'Ahmed Al-Harbi',
    '1098765432',
    'DL-445566',
    '2027-06-30',
    '+966500000000',
    'available',
  ])
}
