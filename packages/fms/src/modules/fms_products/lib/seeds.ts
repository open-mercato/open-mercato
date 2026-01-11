import type { ChargeCodeFieldSchema, ChargeUnit } from '../data/types.js'

/**
 * System charge code definition
 */
export interface SystemChargeCode {
  code: string
  name: string
  description: string
  chargeUnit: ChargeUnit
  fieldSchema: ChargeCodeFieldSchema
  sortOrder: number
  isSystem: true
}

/**
 * Default system charge codes seeded on module initialization
 * 
 * These cover common freight shipping charges:
 * - GFRT: Freight Container (per container)
 * - GBAF: Bunker Adjustment Factor per container (per container)
 * - GBAF_PIECE: Bunker Adjustment Factor per piece (per piece)
 * - GBOL: Bill of Lading documentation (one time)
 * - GTHC: Terminal Handling Charge (per container)
 * - GCUS: Customs Clearance (one time)
 */
export const SYSTEM_CHARGE_CODES: SystemChargeCode[] = [
  {
    code: 'GFRT',
    name: 'Freight Container',
    description: 'Ocean freight for containerized cargo',
    chargeUnit: 'per_container',
    fieldSchema: {
      loop: {
        type: 'string',
        required: true,
        label: 'Service Loop',
        description: 'Shipping line service name (e.g., MSC SWAN)',
      },
      source: {
        type: 'string',
        required: true,
        label: 'Origin Port',
        description: 'Source port code (e.g., SHA)',
      },
      destination: {
        type: 'string',
        required: true,
        label: 'Destination Port',
        description: 'Destination port code (e.g., GDN)',
      },
      transitTime: {
        type: 'integer',
        required: false,
        label: 'Transit Time',
        unit: 'days',
        description: 'Expected transit time in days',
      },
    },
    sortOrder: 1,
    isSystem: true,
  },
  {
    code: 'GBAF',
    name: 'Bunker Adjustment Factor (Container)',
    description: 'Fuel surcharge per container',
    chargeUnit: 'per_container',
    fieldSchema: {},
    sortOrder: 2,
    isSystem: true,
  },
  {
    code: 'GBAF_PIECE',
    name: 'Bunker Adjustment Factor (Piece)',
    description: 'Fuel surcharge per piece/unit',
    chargeUnit: 'per_piece',
    fieldSchema: {},
    sortOrder: 3,
    isSystem: true,
  },
  {
    code: 'GBOL',
    name: 'B/L (Bill of Lading)',
    description: 'Bill of Lading documentation fee',
    chargeUnit: 'one_time',
    fieldSchema: {},
    sortOrder: 4,
    isSystem: true,
  },
  {
    code: 'GTHC',
    name: 'Terminal Handling Charge',
    description: 'Terminal handling and container handling charges',
    chargeUnit: 'per_container',
    fieldSchema: {
      location: {
        type: 'string',
        required: true,
        label: 'Location',
        description: 'Port/terminal code (e.g., SHA, GDN)',
      },
      chargeType: {
        type: 'string',
        required: false,
        label: 'Charge Type',
        description: 'Origin or destination handling',
        options: [
          { value: 'origin', label: 'Origin THC' },
          { value: 'destination', label: 'Destination THC' },
        ],
      },
    },
    sortOrder: 5,
    isSystem: true,
  },
  {
    code: 'GCUS',
    name: 'Customs Clearance',
    description: 'Customs clearance and documentation services',
    chargeUnit: 'one_time',
    fieldSchema: {
      location: {
        type: 'string',
        required: true,
        label: 'Location',
        description: 'Port/city code where clearance is performed',
      },
      serviceType: {
        type: 'string',
        required: false,
        label: 'Service Type',
        options: [
          { value: 'import', label: 'Import Clearance' },
          { value: 'export', label: 'Export Clearance' },
          { value: 'transit', label: 'Transit Documentation' },
        ],
      },
    },
    sortOrder: 6,
    isSystem: true,
  },
]
