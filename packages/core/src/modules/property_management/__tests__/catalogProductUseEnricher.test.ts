/** @jest-environment node */
import { FakeEm, encryptionFindMock } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => encryptionFindMock())

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { ProductUse } from '../data/entities'
import { catalogProductUseEnricher } from '../data/enrichers'

const TENANT = 'tenant-1'
const PARENT_ORG = 'org-parent'
const CHILD_ORG = 'org-child'

function contextOf(em: FakeEm): EnricherContext {
  return { tenantId: TENANT, organizationId: PARENT_ORG, userId: 'user-1', em, container: {} }
}

describe('catalog product use enricher', () => {
  it('reads each product use in the product\'s own organization', async () => {
    const em = new FakeEm()
    em.seed(CatalogProduct, { id: 'product-parent', tenantId: TENANT, organizationId: PARENT_ORG, deletedAt: null } as never)
    em.seed(CatalogProduct, { id: 'product-child', tenantId: TENANT, organizationId: CHILD_ORG, deletedAt: null } as never)
    em.seed(CatalogProduct, { id: 'product-plain', tenantId: TENANT, organizationId: CHILD_ORG, deletedAt: null } as never)
    em.seed(ProductUse, { id: 'use-parent', tenantId: TENANT, organizationId: PARENT_ORG, catalogProductId: 'product-parent', use: 'leasable', billingUnit: 'month' } as never)
    em.seed(ProductUse, { id: 'use-child', tenantId: TENANT, organizationId: CHILD_ORG, catalogProductId: 'product-child', use: 'bookable', billingUnit: 'hour' } as never)
    em.seed(ProductUse, { id: 'use-stray', tenantId: TENANT, organizationId: PARENT_ORG, catalogProductId: 'product-plain', use: 'bookable', billingUnit: 'day' } as never)
    const records = [{ id: 'product-parent' }, { id: 'product-child' }, { id: 'product-plain' }]
    const enriched = await catalogProductUseEnricher.enrichMany!(records, contextOf(em))
    expect(enriched.map((record) => record._property_management)).toEqual([
      { use: 'leasable', billingUnit: 'month' },
      { use: 'bookable', billingUnit: 'hour' },
      { use: null, billingUnit: null },
    ])
  })

  it('leaves products of another tenant without a use', async () => {
    const em = new FakeEm()
    em.seed(CatalogProduct, { id: 'product-foreign', tenantId: 'tenant-2', organizationId: 'org-foreign', deletedAt: null } as never)
    em.seed(ProductUse, { id: 'use-foreign', tenantId: 'tenant-2', organizationId: 'org-foreign', catalogProductId: 'product-foreign', use: 'bookable', billingUnit: 'hour' } as never)
    const [record] = await catalogProductUseEnricher.enrichMany!([{ id: 'product-foreign' }], contextOf(em))
    expect(record._property_management).toEqual({ use: null, billingUnit: null })
  })
})
