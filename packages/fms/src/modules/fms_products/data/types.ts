/**
 * Charge unit types for billing
 */
export type ChargeUnit = 'per_container' | 'per_piece' | 'one_time'

/**
 * Contract types for pricing
 */
export type ContractType = 'SPOT' | 'NAC' | 'BASKET'

/**
 * Product type discriminators (maps to charge codes)
 */
export type ProductType =
  | 'GFRT' // Freight Container
  | 'GBAF' // BAF (Container)
  | 'GBAF_PIECE' // BAF (Piece)
  | 'GBOL' // Bill of Lading
  | 'GTHC' // Terminal Handling Charge
  | 'GCUS' // Customs Clearance
  | 'CUSTOM' // User-defined charge codes

/**
 * Variant type discriminators
 */
export type VariantType = 'container' | 'simple'

/**
 * Schema definition for charge code type-specific fields
 */
export interface ChargeCodeFieldSchema {
  [fieldName: string]: {
    type: 'string' | 'integer' | 'number' | 'boolean' | 'date'
    required: boolean
    label: string
    description?: string
    unit?: string
    options?: Array<{ value: string; label: string }>
  }
}
