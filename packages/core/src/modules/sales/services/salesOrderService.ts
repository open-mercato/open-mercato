import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '../data/entities'

export type SalesOrderLookupScope = {
  organizationId: string
  tenantId: string
}

export interface SalesOrderService {
  findByExternalReference(
    externalReference: string,
    scope: SalesOrderLookupScope,
  ): Promise<SalesOrder | null>
}

export class DefaultSalesOrderService implements SalesOrderService {
  constructor(private readonly em: EntityManager) {}

  async findByExternalReference(
    externalReference: string,
    scope: SalesOrderLookupScope,
  ): Promise<SalesOrder | null> {
    if (!externalReference) return null
    return findOneWithDecryption(
      this.em,
      SalesOrder,
      {
        externalReference,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  }
}
