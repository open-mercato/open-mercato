import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { sealAddressCustomValues } from '@open-mercato/core/modules/entities/lib/addressCustomFields'
import { E } from '#generated/entities.ids.generated'
import type { CustomerAddress } from '../data/entities'

export async function sealCustomerAddressCustomValues(
  container: CommandRuntimeContext['container'],
  scope: Pick<CustomerAddress, 'tenantId' | 'organizationId'>,
  values: CustomerAddress['customValues'],
  em?: EntityManager,
): Promise<CustomerAddress['customValues']> {
  if (values == null || typeof values === 'string') return values
  return sealAddressCustomValues(container, {
    entityId: E.customers.customer_address,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    column: 'customValues',
    values,
    em,
  })
}
