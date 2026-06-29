import { expect, test, type APIRequestContext } from '@playwright/test'
import { createSalesOrderFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'

/**
 * TC-SALES-2055-ADDRESS-UNDO: undoing a sales-order address edit restores the
 * prior address.
 *
 * Regression for the bug where editing a document (billing/shipping) address
 * saved correctly but "Undo" reported "undo failed". The address sub-resource
 * is written through the `sales.document-addresses.*` commands, which had no
 * `undo`/`buildLog` handlers — so `commandBus.undo()` threw
 * "Command sales.document-addresses.update is not undoable". The fix captures
 * a before/after snapshot in `prepare`/`captureAfter`, records it in `buildLog`,
 * and restores the prior field values in `undo`.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function listDocumentAddress(
  request: APIRequestContext,
  token: string,
  documentId: string,
  addressId: string,
): Promise<Record<string, unknown> | null> {
  const res = await request.fetch(
    resolveUrl(`/api/sales/document-addresses?page=1&pageSize=50&documentId=${documentId}&documentKind=order`),
    { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  )
  expect(res.status(), 'list document-addresses 200').toBe(200)
  const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
  return (body.items ?? []).find((entry) => entry.id === addressId) ?? null
}

function readLine1(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  const value = row.address_line1 ?? row.addressLine1
  return typeof value === 'string' ? value : null
}

test('TC-SALES-2055-ADDRESS-UNDO: undoing an order address edit restores the prior address', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let orderId: string | null = null
  let addressId: string | null = null
  const stamp = `${Date.now()}-${Math.round(performance.now())}`
  const lineA = `A-${stamp} Old Street`
  const lineB = `B-${stamp} New Avenue`

  try {
    orderId = await createSalesOrderFixture(request, token, 'USD')

    // Address "A"
    const created = await apiRequest(request, 'POST', '/api/sales/document-addresses', {
      token,
      data: {
        documentId: orderId,
        documentKind: 'order',
        purpose: 'billing',
        addressLine1: lineA,
        city: 'Oldtown',
      },
    })
    expect(created.ok(), `create address failed: ${created.status()}`).toBeTruthy()
    addressId = ((await created.json()) as { id?: string }).id ?? null
    expect(typeof addressId, 'address id present').toBe('string')

    expect(readLine1(await listDocumentAddress(request, token, orderId, addressId as string))).toBe(lineA)

    // Update to address "B" — capture the operation undo token from the response header.
    const update = await request.fetch(resolveUrl('/api/sales/document-addresses'), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        id: addressId,
        documentId: orderId,
        documentKind: 'order',
        purpose: 'billing',
        addressLine1: lineB,
        city: 'Newtown',
      },
    })
    expect(update.status(), 'PUT address 200').toBe(200)
    const operation = deserializeOperationMetadata(update.headers()['x-om-operation'])
    expect(operation?.undoToken, 'PUT response must carry an undo token').toBeTruthy()
    expect(operation?.commandId).toBe('sales.document-addresses.update')

    expect(readLine1(await listDocumentAddress(request, token, orderId, addressId as string))).toBe(lineB)

    // Undo the edit — this previously failed with "is not undoable".
    const undo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
      token,
      data: { undoToken: operation?.undoToken },
    })
    expect(undo.status(), `undo failed: ${undo.status()} ${await undo.text()}`).toBe(200)

    expect(
      readLine1(await listDocumentAddress(request, token, orderId, addressId as string)),
      'undo must restore the prior address (line A)',
    ).toBe(lineA)
  } finally {
    if (addressId && orderId) {
      await apiRequest(request, 'DELETE', '/api/sales/document-addresses', {
        token,
        data: { id: addressId, documentId: orderId, documentKind: 'order' },
      }).catch(() => {})
    }
    if (orderId) {
      await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id: orderId } }).catch(() => {})
    }
  }
})
