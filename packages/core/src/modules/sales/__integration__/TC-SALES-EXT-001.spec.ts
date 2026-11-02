import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createShipmentFixture } from '@open-mercato/core/helpers/integration/salesFixtures'
import { expectOperation, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { Migration20260910120000_sales_external_amounts_mode as ExternalAmountsMigration } from '../migrations/Migration20260910120000_sales_external_amounts_mode'

/**
 * TC-SALES-EXT-001: `external` amounts mode on sales orders
 *
 * Spec: .ai/specs/2026-09-07-sales-external-amounts-mode.md
 *
 * An order mirrored from an external book of record supplies its own line
 * amounts and its own header, and the header legitimately disagrees with the sum
 * of its lines (the source rounds VAT per rate group). This walks the whole
 * round trip over HTTP:
 *   - create with a header that disagrees with the lines, and read it back;
 *   - write one line and assert every sibling is byte-identical;
 *   - refuse a line write that does not restate the header;
 *   - refuse an adjustment;
 *   - switch back to `computed` and watch the header return to the rollup.
 * A second case walks a return create / delete / undo-delete cycle, a rejected
 * write and a repeated write, asserting the source-owned header never moves.
 * A third applies the migration up / down / up in a scratch schema.
 *
 * Self-contained: every case creates its own fixtures and removes them in `finally`.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

type Request = import('@playwright/test').APIRequestContext

function jsonHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// 3 × 4.33 is 12.99, but the source filed 12.98 on the line and a header that is
// one minor unit off the sum of its own lines. Neither is derivable from core.
const LINE_ONE = {
  currencyCode: 'USD',
  quantity: 3,
  name: 'Mirrored line A',
  unitPriceNet: 4.33,
  unitPriceGross: 5.33,
  taxRate: 23,
  taxAmount: 2.99,
  totalNetAmount: 12.98,
  totalGrossAmount: 15.97,
}

const LINE_TWO = {
  ...LINE_ONE,
  name: 'Mirrored line B',
  totalNetAmount: 12.97,
  totalGrossAmount: 15.95,
  taxAmount: 2.98,
}

const SUPPLIED_TOTALS = {
  subtotalNetAmount: 25.93,
  subtotalGrossAmount: 31.9,
  discountTotalAmount: 0.05,
  taxTotalAmount: 5.97,
  grandTotalNetAmount: 25.93,
  grandTotalGrossAmount: 31.9,
}

async function readOrder(request: Request, token: string, orderId: string): Promise<Record<string, unknown>> {
  const response = await request.fetch(resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`), {
    method: 'GET',
    headers: jsonHeaders(token),
  })
  expect(response.status(), 'GET /api/sales/orders?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested order').toBeTruthy()
  return item as Record<string, unknown>
}

async function readLines(request: Request, token: string, orderId: string): Promise<Array<Record<string, unknown>>> {
  const response = await request.fetch(
    resolveUrl(`/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&pageSize=100`),
    { method: 'GET', headers: jsonHeaders(token) },
  )
  expect(response.status(), 'GET /api/sales/order-lines should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  return body.items ?? []
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

const HEADER_FIELDS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'shippingNetAmount',
  'shippingGrossAmount',
  'surchargeTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
] as const

function headerAmounts(order: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(HEADER_FIELDS.map((field) => [field, num(order[field])]))
}

function lineAmounts(lines: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return lines
    .map((line) => ({
      id: line.id,
      totalNetAmount: num(line.total_net_amount ?? line.totalNetAmount),
      totalGrossAmount: num(line.total_gross_amount ?? line.totalGrossAmount),
      taxAmount: num(line.tax_amount ?? line.taxAmount),
      discountAmount: num(line.discount_amount ?? line.discountAmount),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function returnedQuantity(lines: Array<Record<string, unknown>>, lineId: string): number {
  const line = lines.find((item) => item.id === lineId)
  return num(line?.returned_quantity ?? line?.returnedQuantity)
}

async function readReturnAdjustments(
  request: Request,
  token: string,
  orderId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await request.fetch(
    resolveUrl(`/api/sales/order-adjustments?orderId=${encodeURIComponent(orderId)}&page=1&pageSize=50`),
    { method: 'GET', headers: jsonHeaders(token) },
  )
  expect(response.status(), 'GET /api/sales/order-adjustments should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  return (body.items ?? []).filter((item) => item.kind === 'return')
}

async function readReturns(request: Request, token: string, orderId: string): Promise<Array<Record<string, unknown>>> {
  const response = await request.fetch(
    resolveUrl(`/api/sales/returns?orderId=${encodeURIComponent(orderId)}`),
    { method: 'GET', headers: jsonHeaders(token) },
  )
  expect(response.status(), 'GET /api/sales/returns should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  return body.items ?? []
}

async function expectGone(request: Request, token: string, path: string, label: string): Promise<void> {
  const response = await request.fetch(resolveUrl(path), { method: 'GET', headers: jsonHeaders(token) })
  expect(response.status(), `GET ${path} should return 200`).toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  expect(body.items ?? [], `${label} should be removed by teardown`).toHaveLength(0)
}

async function createExternalOrder(request: Request, token: string): Promise<string> {
  const created = await request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'POST',
    headers: jsonHeaders(token),
    data: {
      currencyCode: 'USD',
      totalsMode: 'external',
      ...SUPPLIED_TOTALS,
      lines: [LINE_ONE, LINE_TWO],
    },
  })
  expect(
    created.ok(),
    `create should succeed: ${created.status()} ${(await created.text()).slice(0, 500)}`,
  ).toBeTruthy()
  const orderId = ((await created.json()) as { id?: string }).id ?? null
  expect(orderId, 'create response should carry the order id').toBeTruthy()
  return orderId as string
}

test.describe('TC-SALES-EXT-001: external amounts mode', () => {
  test('a mirrored order keeps its own header and line amounts across writes', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null

    try {
      const created = await request.fetch(resolveUrl('/api/sales/orders'), {
        method: 'POST',
        headers: jsonHeaders(token),
        data: {
          currencyCode: 'USD',
          totalsMode: 'external',
          ...SUPPLIED_TOTALS,
          lines: [LINE_ONE, LINE_TWO],
        },
      })
      expect(
        created.ok(),
        `create should succeed: ${created.status()} ${(await created.text()).slice(0, 500)}`,
      ).toBeTruthy()
      orderId = ((await created.json()) as { id?: string }).id ?? null
      expect(orderId, 'create response should carry the order id').toBeTruthy()

      const order = await readOrder(request, token, orderId as string)
      expect(order.totalsMode).toBe('external')
      // The header the source filed, not the 25.95 sum of the lines core stored.
      expect(num(order.grandTotalGrossAmount)).toBeCloseTo(31.9, 2)
      expect(num(order.subtotalNetAmount)).toBeCloseTo(25.93, 2)

      const lines = await readLines(request, token, orderId as string)
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(line.amounts_mode ?? line.amountsMode).toBe('external')

      const lineB = lines.find((line) => String(line.name).endsWith('line B'))
      expect(lineB, 'line B should be readable').toBeTruthy()
      expect(num(lineB?.total_net_amount ?? lineB?.totalNetAmount)).toBeCloseTo(12.97, 2)

      // A line write that does not restate the header is refused, because core
      // will not rebuild the header and must not leave it stale either.
      const refused = await request.fetch(resolveUrl('/api/sales/order-lines'), {
        method: 'PUT',
        headers: jsonHeaders(token),
        data: {
          id: lines[0].id,
          orderId,
          ...LINE_ONE,
          totalNetAmount: 11,
          totalGrossAmount: 13.53,
          taxAmount: 2.53,
        },
      })
      expect(refused.status(), 'a line write without orderTotals should be a 4xx').toBe(400)

      const accepted = await request.fetch(resolveUrl('/api/sales/order-lines'), {
        method: 'PUT',
        headers: jsonHeaders(token),
        data: {
          id: lines[0].id,
          orderId,
          ...LINE_ONE,
          totalNetAmount: 11,
          totalGrossAmount: 13.53,
          taxAmount: 2.53,
          orderTotals: SUPPLIED_TOTALS,
        },
      })
      expect(
        accepted.ok(),
        `a line write restating the header should succeed: ${accepted.status()} ${(await accepted.text()).slice(0, 500)}`,
      ).toBeTruthy()

      const afterLineWrite = await readLines(request, token, orderId as string)
      const siblingAfter = afterLineWrite.find((line) => String(line.name).endsWith('line B'))
      // The property the mode exists for: a sibling that is not derivable from
      // unit price × quantity survives a write to another line untouched.
      expect(num(siblingAfter?.total_net_amount ?? siblingAfter?.totalNetAmount)).toBeCloseTo(12.97, 2)

      const headerAfter = await readOrder(request, token, orderId as string)
      expect(num(headerAfter.grandTotalGrossAmount)).toBeCloseTo(31.9, 2)

      const adjustment = await request.fetch(resolveUrl('/api/sales/order-adjustments'), {
        method: 'POST',
        headers: jsonHeaders(token),
        data: { orderId, kind: 'discount', label: 'Should be refused', amountNet: 1, amountGross: 1 },
      })
      expect(adjustment.status(), 'an adjustment on an external order should be refused').toBe(409)

      const switched = await request.fetch(resolveUrl('/api/sales/orders'), {
        method: 'PUT',
        headers: jsonHeaders(token),
        data: { id: orderId, totalsMode: 'computed' },
      })
      expect(
        switched.ok(),
        `switching back should succeed: ${switched.status()} ${(await switched.text()).slice(0, 500)}`,
      ).toBeTruthy()

      const computed = await readOrder(request, token, orderId as string)
      expect(computed.totalsMode).toBe('computed')
      // Back on the derivation path, the header is the rollup again — and the
      // source's per-rate-group rounding is gone, as § 8 of the spec warns.
      expect(num(computed.grandTotalGrossAmount)).not.toBeCloseTo(31.9, 2)
    } finally {
      if (orderId) {
        await request.fetch(resolveUrl('/api/sales/orders'), {
          method: 'DELETE',
          headers: jsonHeaders(token),
          data: { id: orderId },
        })
      }
    }
  })

  test('returns, rejected writes and repeated writes never move the source-owned header', async ({ request }) => {
    const token = await getAuthToken(request)
    let orderId: string | null = null
    let shipmentId: string | null = null
    let returnId: string | null = null

    try {
      orderId = await createExternalOrder(request, token)
      const header = headerAmounts(await readOrder(request, token, orderId))
      const lines = await readLines(request, token, orderId)
      expect(lines).toHaveLength(2)
      const baselineLines = lineAmounts(lines)
      const lineA = lines.find((line) => String(line.name).endsWith('line A'))
      expect(lineA, 'line A should be readable').toBeTruthy()
      const lineAId = String(lineA?.id)

      // A priceMode routes the line through the tax service, which would default
      // an absent unit price to zero; the absence must still be refused.
      for (const priceMode of [undefined, 'net', 'gross'] as const) {
        const missingPrice = await request.fetch(resolveUrl('/api/sales/order-lines'), {
          method: 'POST',
          headers: jsonHeaders(token),
          data: {
            orderId,
            kind: 'service',
            name: 'Source line without a unit price',
            currencyCode: 'USD',
            quantity: 1,
            ...(priceMode ? { priceMode } : {}),
            totalNetAmount: 10,
            taxAmount: 2,
            totalGrossAmount: 12,
            orderTotals: SUPPLIED_TOTALS,
          },
        })
        expect(
          missingPrice.status(),
          `a new external line without unitPriceNet (priceMode ${priceMode ?? 'none'}) should be refused`,
        ).toBe(400)
        expect(await missingPrice.text()).toContain('unitPriceNet')
      }

      const withoutHeader = await request.fetch(resolveUrl('/api/sales/order-lines'), {
        method: 'PUT',
        headers: jsonHeaders(token),
        data: { id: lineAId, orderId, ...LINE_ONE, totalNetAmount: 11, totalGrossAmount: 13.53, taxAmount: 2.53 },
      })
      expect(withoutHeader.status(), 'a line write without orderTotals should be refused').toBe(400)

      expect(headerAmounts(await readOrder(request, token, orderId)), 'a refused write must not move the header').toEqual(header)
      const afterRefusals = await readLines(request, token, orderId)
      expect(afterRefusals, 'a refused write must not persist a line').toHaveLength(2)
      expect(lineAmounts(afterRefusals), 'a refused write must not touch any line').toEqual(baselineLines)

      const restated = { id: lineAId, orderId, ...LINE_ONE, name: 'Mirrored line A restated', orderTotals: SUPPLIED_TOTALS }
      for (const attempt of [1, 2]) {
        const repeated = await request.fetch(resolveUrl('/api/sales/order-lines'), {
          method: 'PUT',
          headers: jsonHeaders(token),
          data: restated,
        })
        expect(repeated.ok(), `restated line write #${attempt} should succeed: ${repeated.status()}`).toBeTruthy()
      }
      const afterRepeat = await readLines(request, token, orderId)
      expect(afterRepeat, 'a repeated line write must not duplicate the line').toHaveLength(2)
      expect(lineAmounts(afterRepeat), 'a repeated line write must leave the amounts as the source stated them').toEqual(baselineLines)
      expect(headerAmounts(await readOrder(request, token, orderId))).toEqual(header)

      shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId: lineAId, quantity: 3 }])

      const createdReturn = await request.fetch(resolveUrl('/api/sales/returns'), {
        method: 'POST',
        headers: jsonHeaders(token),
        data: { orderId, reason: `TC-SALES-EXT-001 ${Date.now()}`, lines: [{ orderLineId: lineAId, quantity: 1 }] },
      })
      expect(
        createdReturn.status(),
        `POST /api/sales/returns should be 201: ${(await createdReturn.text()).slice(0, 500)}`,
      ).toBe(201)
      const returnBody = (await createdReturn.json()) as { id?: string; returnId?: string }
      returnId = String(returnBody.id ?? returnBody.returnId)

      expect(headerAmounts(await readOrder(request, token, orderId)), 'a return must not move an external header').toEqual(header)
      expect(returnedQuantity(await readLines(request, token, orderId), lineAId)).toBe(1)
      expect(await readReturnAdjustments(request, token, orderId), 'the return is still recorded as an adjustment').toHaveLength(1)
      expect((await readReturns(request, token, orderId)).map((row) => row.id)).toContain(returnId)

      const deletedReturn = await request.fetch(resolveUrl('/api/sales/returns'), {
        method: 'DELETE',
        headers: jsonHeaders(token),
        data: { id: returnId, orderId },
      })
      expect(deletedReturn.status(), 'DELETE /api/sales/returns should be 200').toBe(200)
      const deleteOperation = expectOperation(deletedReturn, 'external order return delete')

      expect(headerAmounts(await readOrder(request, token, orderId)), 'a return delete must not move an external header').toEqual(header)
      expect(returnedQuantity(await readLines(request, token, orderId), lineAId)).toBe(0)
      expect(await readReturnAdjustments(request, token, orderId)).toHaveLength(0)
      expect((await readReturns(request, token, orderId)).map((row) => row.id)).not.toContain(returnId)

      await undoOk(request, token, deleteOperation.undoToken, 'external order return delete')

      expect(headerAmounts(await readOrder(request, token, orderId)), 'restoring a return must not move an external header').toEqual(header)
      const afterRestore = await readLines(request, token, orderId)
      expect(returnedQuantity(afterRestore, lineAId)).toBe(1)
      expect(lineAmounts(afterRestore), 'restoring a return must leave the source line amounts').toEqual(baselineLines)
      expect(await readReturnAdjustments(request, token, orderId)).toHaveLength(1)
      expect((await readReturns(request, token, orderId)).map((row) => row.id)).toContain(returnId)
    } finally {
      // The restored return references the order and its lines without a delete
      // cascade, so it has to go before the order (which takes its shipments).
      if (orderId && returnId) {
        const returnCleanup = await request.fetch(resolveUrl('/api/sales/returns'), {
          method: 'DELETE',
          headers: jsonHeaders(token),
          data: { id: returnId, orderId },
        })
        expect([200, 404], `return cleanup should succeed: ${returnCleanup.status()}`).toContain(returnCleanup.status())
      }
      if (orderId) {
        const orderCleanup = await request.fetch(resolveUrl('/api/sales/orders'), {
          method: 'DELETE',
          headers: jsonHeaders(token),
          data: { id: orderId },
        })
        expect(orderCleanup.status(), `order cleanup should succeed: ${(await orderCleanup.text()).slice(0, 500)}`).toBe(200)
        await expectGone(request, token, `/api/sales/orders?id=${encodeURIComponent(orderId)}`, 'the order')
        await expectGone(request, token, `/api/sales/returns?orderId=${encodeURIComponent(orderId)}`, 'the return')
        if (shipmentId) {
          await expectGone(request, token, `/api/sales/shipments?orderId=${encodeURIComponent(orderId)}`, 'the shipment')
        }
      }
    }
  })

  test('the migration defaults existing rows to computed and round-trips without touching amounts', async () => {
    await withClient(async (client) => {
      const schema = `sales_ext_amounts_${randomUUID().replace(/-/g, '')}`
      const previousPath = await client.query<{ search_path: string }>('show search_path')
      const migration = new ExternalAmountsMigration(
        {} as ConstructorParameters<typeof ExternalAmountsMigration>[0],
        {} as ConstructorParameters<typeof ExternalAmountsMigration>[1],
      )
      const executeMigration = async (direction: 'up' | 'down') => {
        migration.reset()
        await migration[direction]()
        for (const sql of migration.getQueries()) await client.query(String(sql))
      }
      const readColumns = async (table: string) =>
        (
          await client.query<{ column_name: string }>(
            'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
            [schema, table],
          )
        ).rows.map((row) => row.column_name)
      const readOrders = () =>
        client.query<Record<string, string>>(
          'select id, grand_total_gross_amount, tax_total_amount from sales_orders order by id',
        )
      const readOrderLines = () =>
        client.query<Record<string, string>>(
          'select id, total_net_amount, total_gross_amount, tax_amount from sales_order_lines order by id',
        )
      const orderId = randomUUID()
      const lineId = randomUUID()

      try {
        await client.query(`create schema "${schema}"`)
        await client.query("select set_config('search_path', $1, false)", [schema])
        await client.query(
          `create table sales_orders (id uuid primary key, grand_total_gross_amount numeric(18,4) not null default 0, tax_total_amount numeric(18,4) not null default 0)`,
        )
        await client.query(
          `create table sales_order_lines (id uuid primary key, order_id uuid not null references sales_orders(id), total_net_amount numeric(18,4) not null default 0, total_gross_amount numeric(18,4) not null default 0, tax_amount numeric(18,4) not null default 0)`,
        )
        await client.query('insert into sales_orders values ($1, 31.9, 5.97)', [orderId])
        await client.query('insert into sales_order_lines values ($1, $2, 12.98, 15.97, 2.99)', [lineId, orderId])
        const ordersBefore = (await readOrders()).rows
        const linesBefore = (await readOrderLines()).rows

        await executeMigration('up')
        const modes = await client.query<{ totals_mode: string; amounts_mode: string }>(
          'select o.totals_mode, l.amounts_mode from sales_orders o join sales_order_lines l on l.order_id = o.id',
        )
        expect(modes.rows, 'existing rows take the computed default').toEqual([{ totals_mode: 'computed', amounts_mode: 'computed' }])
        expect((await readOrders()).rows).toEqual(ordersBefore)
        expect((await readOrderLines()).rows).toEqual(linesBefore)

        await client.query(`update sales_orders set totals_mode = 'external'`)
        await client.query(`update sales_order_lines set amounts_mode = 'external'`)

        await executeMigration('down')
        expect(await readColumns('sales_orders')).not.toContain('totals_mode')
        expect(await readColumns('sales_order_lines')).not.toContain('amounts_mode')
        expect((await readOrders()).rows, 'down keeps every monetary value').toEqual(ordersBefore)
        expect((await readOrderLines()).rows, 'down keeps every line amount').toEqual(linesBefore)

        await executeMigration('up')
        await executeMigration('up')
        expect(await readColumns('sales_orders')).toContain('totals_mode')
        expect(await readColumns('sales_order_lines')).toContain('amounts_mode')
        const reapplied = await client.query<{ totals_mode: string }>('select totals_mode from sales_orders')
        expect(reapplied.rows).toEqual([{ totals_mode: 'computed' }])
        expect((await readOrders()).rows).toEqual(ordersBefore)
      } finally {
        await client.query("select set_config('search_path', $1, false)", [previousPath.rows[0].search_path])
        await client.query(`drop schema if exists "${schema}" cascade`)
      }
    })
  })
})
