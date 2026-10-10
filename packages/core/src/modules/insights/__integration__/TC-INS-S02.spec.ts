import { expect, test } from '@playwright/test'
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  SIMULATIONS_PATH,
  cellOf,
  cleanupSimulationFixture,
  createSimulationFixture,
  createSimulationOrganization,
  createSimulationUser,
  groupOf,
  requestSimulation,
  simulationCall,
  waitForSimulation,
  type SimulationGroup,
} from './helpers/simulationApi'
import {
  CATALOG_PRICES_PATH,
  CATALOG_PRICE_KINDS_PATH,
  PRICE_BACKTEST_KIND,
  PRICE_SIMULATOR_FEATURES,
  SALES_ORDERS_PATH,
  SALES_QUOTES_PATH,
  createCatalogLine,
  createDocument,
  createEurPriceRow,
  createNetPriceKind,
  createPriceProduct,
  overrideOrderLinePrice,
  purgePriceFixtureRows,
  readPriceRow,
  updatePriceRowNet,
} from './helpers/priceSimulationApi'

export const integrationMeta = {
  description: 'Change simulator price-row backtest end to end (orders vs quotes, per-currency revenue, override exclusion, apply and decision)',
  dependsOnModules: ['insights', 'catalog', 'sales', 'audit_logs', 'progress'],
}

type Measure = { key: string; cell: string; value: string; currencyCode: string | null }

function measuresOf(group: SimulationGroup): Record<string, Measure> {
  const measures = (group as SimulationGroup & { measures?: Measure[] }).measures ?? []
  return Object.fromEntries(measures.map((measure) => [measure.key, measure]))
}

/**
 * TC-INS-S02: price-row amount backtest end to end.
 * Covers POST/GET /api/insights/simulations for `catalog.price_backtest`, the catalog price PUT
 * apply path with the optimistic lock and POST /api/insights/simulations/{id}/decision.
 *
 * In a fresh organization (k = 5) a EUR price row (net 10) prices, the way the browser line dialog
 * does (`priceId` + `priceMode` on the line):
 *   - a EUR order: 5 lines at 10 (quantity 2) priced from the row, 4 lines entered at 9, and one
 *     line priced at 10 then changed by hand to 9 after the row changed — 5 manual overrides;
 *   - a USD order: 5 lines referencing the EUR row (currency mismatch → cannot tell);
 *   - after the row moves to 11, a EUR quote: 5 lines at 11 (quantity 3) priced from the row.
 * Simulating net 12 reports orders and quotes separately, per currency: orders EUR 100.00 →
 * 120.00 (overrides excluded), quotes EUR 165.00 → 180.00, the USD lines only as "cannot tell".
 * Applying with a stale `updatedAt` answers 409; the applied amount verifies.
 */
test.describe('TC-INS-S02: price-row amount backtest', () => {
  test('separates orders and quotes per currency, excludes overrides and verifies the applied amount', async ({ request }) => {
    test.slow()
    const fixture = createSimulationFixture()
    let organizationId: string | null = null
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null
    let priceId: string | null = null
    const orders: string[] = []
    const quotes: string[] = []
    try {
      organizationId = await createSimulationOrganization(request, fixture, 'INS-S02')
      const user = await createSimulationUser(request, fixture, { label: 'INS-S02 pricing', organizationId, features: PRICE_SIMULATOR_FEATURES })
      token = user.token
      productId = await createPriceProduct(request, token, 'INS-S02')
      priceKindId = await createNetPriceKind(request, token, 'ins_s02')
      priceId = await createEurPriceRow(request, token, { productId, priceKindId, unitPriceNet: 10 })
      const row = { priceId, productId, priceKindId, currencyCode: 'EUR' }

      const orderEur = await createDocument(request, token, 'order', 'EUR')
      orders.push(orderEur)
      const eurLine = { documentId: orderEur, productId, priceId, currencyCode: 'EUR', quantity: 2 }
      for (let index = 0; index < 5; index += 1) await createCatalogLine(request, token, 'order', { ...eurLine, unitPrice: 10 })
      for (let index = 0; index < 4; index += 1) await createCatalogLine(request, token, 'order', { ...eurLine, unitPrice: 9 })
      const editedLine = await createCatalogLine(request, token, 'order', { ...eurLine, unitPrice: 10 })

      const orderUsd = await createDocument(request, token, 'order', 'USD')
      orders.push(orderUsd)
      for (let index = 0; index < 5; index += 1) {
        await createCatalogLine(request, token, 'order', { documentId: orderUsd, productId, priceId, currencyCode: 'USD', quantity: 1, unitPrice: 10 })
      }

      const moved = await updatePriceRowNet(request, token, { ...row, unitPriceNet: 11, updatedAt: (await readPriceRow(request, token, priceId)).updatedAt })
      expect(moved.status, `move the row to 11: ${moved.text}`).toBe(200)
      await overrideOrderLinePrice(request, token, { documentId: orderEur, lineId: editedLine, currencyCode: 'EUR', quantity: 2, unitPrice: 9 })

      const quoteEur = await createDocument(request, token, 'quote', 'EUR')
      quotes.push(quoteEur)
      for (let index = 0; index < 5; index += 1) {
        await createCatalogLine(request, token, 'quote', { documentId: quoteEur, productId, priceId, currencyCode: 'EUR', quantity: 3, unitPrice: 11 })
      }

      const invalid = await requestSimulation(request, token, { kind: PRICE_BACKTEST_KIND, artifactId: priceId, proposal: { priceId, currencyCode: 'EUR', unitPriceNet: '12.00', minQuantity: 5 }, window: { days: 30 } })
      expect(invalid.status, 'a proposal changing more than the amounts is refused').toBe(422)
      expect(invalid.body?.code).toBe('invalid_proposal')
      const otherCurrency = await requestSimulation(request, token, { kind: PRICE_BACKTEST_KIND, artifactId: priceId, proposal: { priceId, currencyCode: 'USD', unitPriceNet: '12.00' }, window: { days: 30 } })
      expect(otherCurrency.status, 'a currency change is not an amount change').toBe(422)
      const missingRow = await requestSimulation(request, token, { kind: PRICE_BACKTEST_KIND, artifactId: null, proposal: { priceId: '00000000-0000-4000-8000-000000000000', currencyCode: 'EUR', unitPriceNet: '12.00' }, window: { days: 30 } })
      expect(missingRow.status, 'a new row cannot be backtested').toBe(422)
      expect(missingRow.body?.code).toBe('artifact_not_found')

      const proposal = { priceId, currencyCode: 'EUR', unitPriceNet: '12.00' }
      const started = await requestSimulation(request, token, { kind: PRICE_BACKTEST_KIND, artifactId: priceId, proposal, window: { days: 30 } })
      expect(started.status, `POST ${SIMULATIONS_PATH}: ${started.text}`).toBe(202)
      const runId = started.body?.runId as string
      const run = await waitForSimulation(request, token, runId)
      expect(run.status, JSON.stringify(run)).toBe('completed')
      expect(run.fidelity).toBe('reconstructed')
      expect(run.result?.k).toBe(5)
      expect(run.result?.groups.map((group) => group.key)).toEqual(['orders:EUR:net', 'orders:USD:net', 'quotes:EUR:net'])

      const ordersEur = groupOf(run, 'orders:EUR:net')
      expect(ordersEur.total).toBe(10)
      expect(cellOf(ordersEur, 'priced_from_row').count).toBe(5)
      expect(cellOf(ordersEur, 'manual_override').count).toBe(5)
      expect(cellOf(ordersEur, 'cannot_tell').count).toBe(0)
      expect(cellOf(ordersEur, 'priced_from_row').samples.map((sample) => sample.id)).toEqual([orderEur])
      expect(measuresOf(ordersEur)).toEqual({
        current_revenue: { key: 'current_revenue', cell: 'priced_from_row', value: '100.00', currencyCode: 'EUR' },
        simulated_revenue: { key: 'simulated_revenue', cell: 'priced_from_row', value: '120.00', currencyCode: 'EUR' },
        revenue_delta: { key: 'revenue_delta', cell: 'priced_from_row', value: '20.00', currencyCode: 'EUR' },
      })

      const ordersUsd = groupOf(run, 'orders:USD:net')
      expect(ordersUsd.total).toBe(5)
      expect(cellOf(ordersUsd, 'cannot_tell').count).toBe(5)
      expect(cellOf(ordersUsd, 'priced_from_row').count).toBe(0)
      expect(ordersUsd.warnings).toContain('catalog.simulation.warnings.currencyDiffers')
      expect(measuresOf(ordersUsd).current_revenue).toEqual(expect.objectContaining({ value: '0.00', currencyCode: 'USD' }))

      const quotesEur = groupOf(run, 'quotes:EUR:net')
      expect(cellOf(quotesEur, 'priced_from_row').count).toBe(5)
      expect(cellOf(quotesEur, 'priced_from_row').samples.map((sample) => sample.id)).toEqual([quoteEur])
      expect(measuresOf(quotesEur).current_revenue.value).toBe('165.00')
      expect(measuresOf(quotesEur).simulated_revenue.value).toBe('180.00')
      expect(measuresOf(quotesEur).revenue_delta.value).toBe('15.00')

      expect(run.coverage).toEqual(expect.objectContaining({
        price_history_entries: 2,
        orders_lines_scanned: 15,
        orders_lines_currency_mismatch: 5,
        quotes_lines_scanned: 5,
      }))
      expect(run.caveats).toEqual(expect.arrayContaining([
        'catalog.simulation.caveats.priceIdBrowserOnly',
        'catalog.simulation.caveats.perCurrency',
        'catalog.simulation.caveats.basisNotProposed',
      ]))
      expect(run.applyHref).toBe(`/backend/catalog/prices/${priceId}/edit?simulationRunId=${runId}`)

      const stale = await updatePriceRowNet(request, token, { ...row, unitPriceNet: 12, updatedAt: '2020-01-01T00:00:00.000Z' })
      expect(stale.status, `apply with a stale updatedAt: ${stale.text}`).toBe(409)
      const applied = await updatePriceRowNet(request, token, { ...row, unitPriceNet: 12, updatedAt: (await readPriceRow(request, token, priceId)).updatedAt })
      expect(applied.status, `apply the simulated amount: ${applied.text}`).toBe(200)
      const decision = await simulationCall<{ decision?: { decision: string; verified: boolean | null } }>(request, token, 'POST', `${SIMULATIONS_PATH}/${runId}/decision`, { data: { decision: 'applied' } })
      expect(decision.status, `record the applied decision: ${decision.text}`).toBe(201)
      expect(decision.body?.decision).toEqual(expect.objectContaining({ decision: 'applied', verified: true }))
    } finally {
      for (const quoteId of quotes) await deleteSalesEntityIfExists(request, token, SALES_QUOTES_PATH, quoteId)
      for (const orderId of orders) await deleteSalesEntityIfExists(request, token, SALES_ORDERS_PATH, orderId)
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRICES_PATH, priceId)
      await deleteCatalogProductIfExists(request, token, productId)
      await deleteGeneralEntityIfExists(request, token, CATALOG_PRICE_KINDS_PATH, priceKindId)
      if (organizationId) await purgePriceFixtureRows(organizationId)
      await cleanupSimulationFixture(request, fixture)
    }
  })
})
