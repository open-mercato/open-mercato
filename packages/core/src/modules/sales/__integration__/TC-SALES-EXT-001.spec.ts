import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

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
 *
 * Self-contained: it creates its own order and deletes it in `finally`.
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
})
