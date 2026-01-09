/**
 * Location type discriminator for STI
 */
export type LocationType = 'port' | 'terminal'

/**
 * Quadrant type for geographic position
 */
export type Quadrant = 'NE' | 'NW' | 'SE' | 'SW'

/**
 * Base location interface (shared fields for STI)
 */
export interface IFmsLocation {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  quadrant: Quadrant
  createdAt: Date
  createdBy?: string | null
  updatedAt: Date
  updatedBy?: string | null
  deletedAt?: Date | null
}

/**
 * Port entity interface
 */
export interface IFmsPort extends IFmsLocation {
  locationType: 'port'
}

/**
 * Terminal entity interface
 */
export interface IFmsTerminal extends IFmsLocation {
  locationType: 'terminal'
  portId: string
}
