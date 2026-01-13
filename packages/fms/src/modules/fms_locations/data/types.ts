/**
 * Location type discriminator
 */
export type LocationType = 'port' | 'terminal'

/**
 * Unified location interface
 */
export interface IFmsLocation {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  type: LocationType
  locode?: string | null
  portId?: string | null
  lat?: number | null
  lng?: number | null
  city?: string | null
  country?: string | null
  createdAt: Date
  createdBy?: string | null
  updatedAt: Date
  updatedBy?: string | null
  deletedAt?: Date | null
}
