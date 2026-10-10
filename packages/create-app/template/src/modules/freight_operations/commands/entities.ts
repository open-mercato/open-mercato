import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  FreightContract,
  FreightContractRoute,
  FreightOrder,
  FreightTrip,
  FreightTripAbstract,
} from '../data/entities'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'freight_operations',
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

export const FREIGHT_ORDER_ENTITY_ID = 'freight_operations:freight_order' as const
export const FREIGHT_CONTRACT_ENTITY_ID = 'freight_operations:freight_contract' as const
export const FREIGHT_CONTRACT_ROUTE_ENTITY_ID = 'freight_operations:freight_contract_route' as const
export const FREIGHT_TRIP_ENTITY_ID = 'freight_operations:freight_trip' as const
export const FREIGHT_ABSTRACT_ENTITY_ID = 'freight_operations:freight_trip_abstract' as const
export const FREIGHT_PAYMENT_ENTITY_ID = 'freight_operations:freight_payment' as const

export const freightOrderEvents = makeEvents<FreightOrder>('order')
export const freightOrderIndexer = makeIndexer<FreightOrder>(FREIGHT_ORDER_ENTITY_ID)

export const freightContractEvents = makeEvents<FreightContract>('contract')
export const freightContractIndexer = makeIndexer<FreightContract>(FREIGHT_CONTRACT_ENTITY_ID)

export const freightContractRouteEvents = makeEvents<FreightContractRoute>('contract_route')
export const freightContractRouteIndexer = makeIndexer<FreightContractRoute>(FREIGHT_CONTRACT_ROUTE_ENTITY_ID)

export const freightTripEvents = makeEvents<FreightTrip>('trip')
export const freightTripIndexer = makeIndexer<FreightTrip>(FREIGHT_TRIP_ENTITY_ID)

export const freightAbstractEvents = makeEvents<FreightTripAbstract>('trip_abstract')
export const freightAbstractIndexer = makeIndexer<FreightTripAbstract>(FREIGHT_ABSTRACT_ENTITY_ID)
