import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { RentalContract, RentalVehicleCheck } from '../data/entities'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'vehicle_rentals',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

export function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

export const RENTAL_CONTRACT_ENTITY_ID = 'vehicle_rentals:rental_contract' as const
export const RENTAL_CHECK_ENTITY_ID = 'vehicle_rentals:rental_vehicle_check' as const

export const rentalContractEvents = makeEvents<RentalContract>('rental_contract')
export const rentalContractIndexer = makeIndexer<RentalContract>(RENTAL_CONTRACT_ENTITY_ID)

export const rentalCheckEvents = makeEvents<RentalVehicleCheck>('rental_vehicle_check')
export const rentalCheckIndexer = makeIndexer<RentalVehicleCheck>(RENTAL_CHECK_ENTITY_ID)
