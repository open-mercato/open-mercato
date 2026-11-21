import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-051: `PUT` and `DELETE /api/sales/credit-memos` check the expected
 * version again under the credit memo row lock.
 *
 * The route's optimistic-lock guard reads the credit memo before the command
 * transaction. The test holds the row lock, lets the request pass that guard and
 * wait on the lock, then commits an edit that advances `updated_at`. The request
 * must answer 409 instead of overwriting or deleting the edited credit memo.
 */

const CREDIT_MEMOS = '/api/sales/credit-memos'

type CreditMemoRow = { reason: string | null; deleted_at: Date | null; updated_at: Date }

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

async function createCreditMemo(request: APIRequestContext, token: string): Promise<string> {
  const response = await apiRequest(request, 'POST', CREDIT_MEMOS, {
    token,
    data: { currencyCode: 'EUR', reason: 'original' },
  })
  expect(response.status(), `POST ${CREDIT_MEMOS} should be 201, got ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ creditMemoId?: string; id?: string }>(response)
  const creditMemoId = body?.creditMemoId ?? body?.id ?? null
  expect(typeof creditMemoId).toBe('string')
  return creditMemoId as string
}

async function readVersion(request: APIRequestContext, token: string, creditMemoId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `${CREDIT_MEMOS}?id=${encodeURIComponent(creditMemoId)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = body?.items?.find((entry) => entry.id === creditMemoId)
  const raw = item?.updatedAt ?? item?.updated_at
  expect(typeof raw, 'the credit memo list should return updatedAt').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

async function readRow(creditMemoId: string): Promise<CreditMemoRow | null> {
  return withClient(async (client) => {
    const result = await client.query<CreditMemoRow>(
      'select reason, deleted_at, updated_at from sales_credit_memos where id = $1',
      [creditMemoId],
    )
    return result.rows[0] ?? null
  })
}

function sendWrite(
  request: APIRequestContext,
  token: string,
  method: 'PUT' | 'DELETE',
  creditMemoId: string,
  expectedVersion?: string,
) {
  return apiRequest(request, method, CREDIT_MEMOS, {
    token,
    retryTransport: false,
    headers: expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : undefined,
    data: method === 'PUT' ? { id: creditMemoId, reason: 'request write' } : { id: creditMemoId },
  })
}

async function purgeCreditMemo(request: APIRequestContext, token: string, creditMemoId: string | null): Promise<void> {
  if (!creditMemoId) return
  if ((await readRow(creditMemoId))?.deleted_at === null) await sendWrite(request, token, 'DELETE', creditMemoId).catch(() => undefined)
  await withClient(async (client) => {
    await client.query('delete from sales_credit_memo_lines where credit_memo_id = $1', [creditMemoId])
    await client.query('delete from sales_credit_memos where id = $1', [creditMemoId])
  })
}

async function raceAgainstConcurrentEdit(
  request: APIRequestContext,
  token: string,
  method: 'PUT' | 'DELETE',
  creditMemoId: string,
  expectedVersion: string,
) {
  return withClient(async (client) => {
    await client.query('begin')
    await client.query('select id from sales_credit_memos where id = $1 for update', [creditMemoId])
    const pending = sendWrite(request, token, method, creditMemoId, expectedVersion)
    pending.catch(() => undefined)
    await waitForLockWaiters(client, 1)
    await client.query(
      `update sales_credit_memos set reason = 'concurrent edit', updated_at = updated_at + interval '1 second' where id = $1`,
      [creditMemoId],
    )
    await client.query('commit')
    return pending
  })
}

test.describe('TC-LOCK-OSS-051: sales.credit_memo update and delete check the version under the row lock', () => {
  for (const method of ['PUT', 'DELETE'] as const) {
    test(`a ${method} whose credit memo is edited while it waits for the row lock answers 409 and writes nothing`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      let creditMemoId: string | null = null
      try {
        creditMemoId = await createCreditMemo(request, token)
        const expectedVersion = await readVersion(request, token, creditMemoId)

        const stale = await raceAgainstConcurrentEdit(request, token, method, creditMemoId, expectedVersion)

        expect(stale.status(), `the ${method} validated against the older version must be refused`).toBe(409)
        const conflict = await readJsonSafe<{ code?: string; currentUpdatedAt?: string }>(stale)
        expect(conflict?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
        const afterConflict = await readRow(creditMemoId)
        expect(afterConflict?.reason, 'the concurrent edit must survive').toBe('concurrent edit')
        expect(afterConflict?.deleted_at, 'the edited credit memo must stay live').toBeNull()

        const currentVersion = conflict?.currentUpdatedAt ?? ''
        expect(currentVersion, 'the conflict reports the version committed while the request waited').toBe(
          new Date(afterConflict?.updated_at ?? 0).toISOString(),
        )
        expect(currentVersion).not.toBe(expectedVersion)

        const retry = await sendWrite(request, token, method, creditMemoId, currentVersion)
        expect(retry.status(), `a ${method} with the current version succeeds`).toBe(200)
        const afterRetry = await readRow(creditMemoId)
        if (method === 'PUT') {
          expect(afterRetry?.reason).toBe('request write')
          expect(afterRetry?.deleted_at).toBeNull()
        } else {
          expect(afterRetry?.deleted_at).not.toBeNull()
          const again = await sendWrite(request, token, 'DELETE', creditMemoId)
          expect(again.status(), 'deleting an already deleted credit memo answers 404').toBe(404)
        }
      } finally {
        await purgeCreditMemo(request, token, creditMemoId)
      }
    })
  }
})
