import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { EcommerceStore } from '../data/entities'
import { fieldError, type EcommerceWriteScope, type Translate } from './crudSupport'

type DomainMappingReader = {
  findById(id: string, scope?: { tenantId?: string }): Promise<{ tenantId: string; organizationId: string } | null>
}

export async function assertStoreInScope(
  em: EntityManager,
  storeId: string,
  scope: EcommerceWriteScope,
  translate: Translate,
): Promise<void> {
  const store = await findOneWithDecryption(
    em,
    EcommerceStore,
    { id: storeId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (store) return
  throw fieldError(400, {
    storeId: translate('ecommerce.errors.storeNotFound', 'The selected store does not exist in this organization.'),
  })
}

export async function assertDomainMappingInScope(
  container: CrudCtx['container'],
  domainMappingId: string,
  scope: EcommerceWriteScope,
  translate: Translate,
): Promise<void> {
  const service = container.resolve<DomainMappingReader>('domainMappingService')
  const mapping = await service.findById(domainMappingId, { tenantId: scope.tenantId })
  if (mapping && mapping.tenantId === scope.tenantId && mapping.organizationId === scope.organizationId) return
  throw fieldError(400, {
    domainMappingId: translate(
      'ecommerce.errors.domainMappingNotFound',
      'The selected domain does not belong to this organization.',
    ),
  })
}

export async function assertSalesChannelInScope(
  em: EntityManager,
  salesChannelId: string,
  scope: EcommerceWriteScope,
  translate: Translate,
): Promise<void> {
  const channel = await findOneWithDecryption(
    em,
    SalesChannel,
    { id: salesChannelId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    scope,
  )
  if (channel) return
  throw fieldError(400, {
    salesChannelId: translate(
      'ecommerce.errors.salesChannelNotFound',
      'The selected sales channel does not exist in this organization.',
    ),
  })
}

export async function assertPriceKindInScope(
  em: EntityManager,
  priceKindId: string,
  scope: EcommerceWriteScope,
  translate: Translate,
): Promise<void> {
  const priceKind = await findOneWithDecryption(
    em,
    CatalogPriceKind,
    {
      id: priceKindId,
      tenantId: scope.tenantId,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: scope.organizationId }],
    },
    undefined,
    scope,
  )
  if (priceKind) return
  throw fieldError(400, {
    priceKindId: translate('ecommerce.errors.priceKindNotFound', 'The selected price kind does not exist in this organization.'),
  })
}
