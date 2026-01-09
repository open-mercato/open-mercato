// Quote Status
export const FMS_QUOTE_STATUSES = [
  'draft',
  'ready',
  'offered',
  'won',
  'lost',
  'expired',
  'archived',
] as const
export type FmsQuoteStatus = (typeof FMS_QUOTE_STATUSES)[number]

// Offer Status
export const FMS_OFFER_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'superseded',
] as const
export type FmsOfferStatus = (typeof FMS_OFFER_STATUSES)[number]

// Direction
export const FMS_DIRECTIONS = ['import', 'export', 'both'] as const
export type FmsDirection = (typeof FMS_DIRECTIONS)[number]

// Incoterm (Incoterms 2020)
export const FMS_INCOTERMS = [
  'exw',
  'fca',
  'fob',
  'cfr',
  'cif',
  'cpt',
  'cip',
  'dap',
  'dpu',
  'ddp',
] as const
export type FmsIncoterm = (typeof FMS_INCOTERMS)[number]

// Contract Type
export const FMS_CONTRACT_TYPES = ['spot', 'nac', 'basket'] as const
export type FmsContractType = (typeof FMS_CONTRACT_TYPES)[number]

// Charge Category
export const FMS_CHARGE_CATEGORIES = [
  'transport',
  'terminal',
  'surcharge',
  'inland',
  'customs',
  'charges',
  'other',
] as const
export type FmsChargeCategory = (typeof FMS_CHARGE_CATEGORIES)[number]

// Charge Unit
export const FMS_CHARGE_UNITS = [
  'per_container',
  'per_shipment',
  'per_kg',
  'per_cbm',
  'per_bl',
  'per_day',
] as const
export type FmsChargeUnit = (typeof FMS_CHARGE_UNITS)[number]

// Container Types (Full range + LCL)
export const FMS_CONTAINER_TYPES = [
  '20GP',
  '40GP',
  '40HC',
  '45HC',
  '20RF',
  '40RF',
  '40RH',
  'LCL',
] as const
export type FmsContainerType = (typeof FMS_CONTAINER_TYPES)[number]

// Cargo Type
export const FMS_CARGO_TYPES = ['fcl', 'lcl'] as const
export type FmsCargoType = (typeof FMS_CARGO_TYPES)[number]
