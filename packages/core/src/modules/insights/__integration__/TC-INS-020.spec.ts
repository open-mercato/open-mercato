import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { uniqueSuffix } from './helpers/explainApi'
import {
  ORDER_LINES_PATH,
  PRICES_PATH,
  PRICE_KINDS_PATH,
  createPriceKindFixture,
  createProductPriceFixture,
  explainOrderLineField,
  findLinePriceHint,
  updateOrderLinePrice,
} from './helpers/priceAccessApi'

export const integrationMeta = {
  description: 'Insights "Why?" sales line unit price explained against its catalog price row',
  dependsOnModules: ['insights', 'audit_logs', 'sales', 'catalog'],
}

/**
 * TC-INS-020: Sales line unit price explained against the linked catalog price
 * Covers:
 *   - GET /api/insights/explain?resourceKind=sales.order&field=lines.unitPriceNet&itemId=<line>
 *     (the `sales.line_price` provider and the `catalog.price` reference resolver)
 *
 * A line created from catalog price P (recorded as `metadata.priceId`) at P's amount is
 * reported as `matched_price_row`, compared with P's amount as of the line write time
 * read from P's own history — and only `inferred`, because the catalog's selection of
 * the price is not recorded. After the line unit price is changed manually the same
 * field is reported as `differs` from P's amount at that time.
 */
test.describe('TC-INS-020: explain a sales line unit price against its catalog price row', () => {
  test('reports matched_price_row for a catalog price and differs after a manual change', async ({ request }) => {
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null
    let priceId: string | null = null
    let orderId: string | null = null
    let lineId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      productId = await createProductFixture(request, token, { title: `QA INS-020 ${suffix}`, sku: `QA-INS-020-${suffix}` })
      priceKindId = await createPriceKindFixture(request, token, { code: `qa_ins_020_${suffix}`, title: `QA INS-020 ${suffix}` })
      priceId = await createProductPriceFixture(request, token, { productId, priceKindId, unitPriceNet: 19.99 })
      orderId = await createSalesOrderFixture(request, token, 'USD')
      lineId = await createOrderLineFixture(request, token, orderId, {
        productId,
        priceId,
        priceMode: 'net',
        name: `QA INS-020 line ${suffix}`,
        quantity: 1,
        unitPriceNet: 19.99,
        unitPriceGross: 19.99,
        taxRate: 0,
      })

      const matched = await explainOrderLineField(request, token, { orderId, lineId, field: 'lines.unitPriceNet' })
      expect(matched.itemId).toBe(lineId)
      expect(findLinePriceHint(matched)).toMatchObject({
        key: 'sales.insights.linePrice.matchedPriceRowNet',
        confidence: 'inferred',
        params: {
          outcome: 'matched_price_row',
          basis: 'net',
          lineAmount: '19.99',
          priceAmount: '19.99',
          currencyCode: 'USD',
          amountSource: 'history',
          priceChangedSince: false,
        },
        reference: { kind: 'catalog.price', id: priceId, href: `/backend/catalog/products/${productId}` },
      })

      await updateOrderLinePrice(request, token, { orderId, lineId, unitPriceNet: 17.5, unitPriceGross: 17.5 })

      const differs = await explainOrderLineField(request, token, { orderId, lineId, field: 'lines.unitPriceNet' })
      const differsHint = findLinePriceHint(differs)
      expect(differsHint).toMatchObject({
        key: 'sales.insights.linePrice.differsNet',
        confidence: 'inferred',
        params: {
          outcome: 'differs',
          basis: 'net',
          lineAmount: '17.50',
          priceAmount: '19.99',
          currencyCode: 'USD',
          amountSource: 'history',
        },
        reference: { kind: 'catalog.price', id: priceId },
      })
      expect(differsHint.params.at, 'the comparison is anchored at the manual change').toBe(differs.chain[0]?.at)

      const gross = await explainOrderLineField(request, token, { orderId, lineId, field: 'lines.unitPriceGross' })
      expect(findLinePriceHint(gross).params, 'the line price was entered net, so net amounts are compared').toMatchObject({
        outcome: 'differs',
        basis: 'net',
      })
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDER_LINES_PATH, lineId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteGeneralEntityIfExists(request, token, PRICES_PATH, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, priceKindId)
    }
  })
})
