import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-050: `DELETE /api/sales/invoices` checks the expected version again
 * under the invoice row lock.
 *
 * The route's optimistic-lock guard reads the invoice before the command
 * transaction. The test holds the row lock, lets the DELETE pass that guard and
 * wait on the lock, then commits an edit that advances `updated_at`. The DELETE
 * must answer 409 instead of deleting the edited invoice.
 */

const INVOICES = '/api/sales/invoices'

/**
 * Polls, from the connection that holds the lock, until `expected` other backends
 * wait on it, so the test proves the request really contended instead of trusting
 * a fixed sleep. The connection holds only the test invoice's row lock.
 */
async function waitForLockWaiters(client: IntegrationDbClient, expected: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await client.query<{ waiting: string }>(
      `select count(*)::text as waiting from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and pg_blocking_pids(pid) && array[pg_backend_pid()]`,
    )
    if (Number(result.rows[0]?.waiting ?? 0) >= expected) return
    if (Date.now() > deadline) throw new Error(`expected ${expected} lock waiter(s) within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function createInvoice(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'POST', INVOICES, { token, data: { currencyCode: 'EUR' } })
  expect(response.status(), `POST ${INVOICES} should be 201, got ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ invoiceId?: string; id?: string }>(response)
  const invoiceId = body?.invoiceId ?? body?.id ?? null
  expect(typeof invoiceId).toBe('string')
  return invoiceId as string
}

async function readVersion(request: APIRequestContext, token: string, invoiceId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${INVOICES}?id=${encodeURIComponent(invoiceId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = body?.items?.find((entry) => entry.id === invoiceId)
  const raw = item?.updatedAt ?? item?.updated_at
  expect(typeof raw, 'the invoice list should return updatedAt').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

async function readStoredVersion(invoiceId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ updated_at: Date }>(
      'select updated_at from sales_invoices where id = $1',
      [invoiceId],
    )
    return new Date(result.rows[0].updated_at).toISOString()
  })
}

async function readDeletedAt(invoiceId: string): Promise<Date | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from sales_invoices where id = $1',
      [invoiceId],
    )
    return result.rows[0]?.deleted_at ?? null
  })
}

function deleteInvoice(request: APIRequestContext, token: string, invoiceId: string, expectedVersion?: string) {
  return apiRequest(request, 'DELETE', INVOICES, {
    token,
    retryTransport: false,
    headers: expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : undefined,
    data: { id: invoiceId },
  })
}

async function purgeInvoice(request: APIRequestContext, token: string, invoiceId: string | null): Promise<void> {
  if (!invoiceId) return
  if ((await readDeletedAt(invoiceId)) === null) await deleteInvoice(request, token, invoiceId).catch(() => undefined)
  await withClient(async (client) => {
    await client.query('delete from sales_invoice_lines where invoice_id = $1', [invoiceId])
    await client.query('delete from sales_invoices where id = $1', [invoiceId])
  })
}

test.describe('TC-LOCK-OSS-050: sales.invoice delete checks the version under the row lock', () => {
  test('a DELETE whose invoice is edited while it waits for the row lock answers 409 and deletes nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      invoiceId = await createInvoice(request, token)
      const expectedVersion = await readVersion(request, token, invoiceId)

      const stale = await withClient(async (client) => {
        await client.query('begin')
        await client.query('select id from sales_invoices where id = $1 for update', [invoiceId])
        const pending = deleteInvoice(request, token, invoiceId as string, expectedVersion)
        pending.catch(() => undefined)
        await waitForLockWaiters(client, 1)
        await client.query(
          `update sales_invoices set updated_at = updated_at + interval '1 second' where id = $1`,
          [invoiceId],
        )
        await client.query('commit')
        return pending
      })

      expect(stale.status(), 'the DELETE validated against the older version must be refused').toBe(409)
      const conflict = await readJsonSafe<{ code?: string; currentUpdatedAt?: string }>(stale)
      expect(conflict?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
      expect(await readDeletedAt(invoiceId), 'the edited invoice must stay live').toBeNull()

      const currentVersion = conflict?.currentUpdatedAt ?? ''
      expect(currentVersion, 'the conflict reports the version committed while the DELETE waited').toBe(
        await readStoredVersion(invoiceId),
      )
      expect(currentVersion).not.toBe(expectedVersion)
      const fresh = await deleteInvoice(request, token, invoiceId, currentVersion)
      expect(fresh.status(), 'a DELETE with the current version succeeds').toBe(200)
      expect(await readDeletedAt(invoiceId)).not.toBeNull()

      const again = await deleteInvoice(request, token, invoiceId)
      expect(again.status(), 'deleting an already deleted invoice answers 404').toBe(404)
    } finally {
      await purgeInvoice(request, token, invoiceId)
    }
  })
})
