import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoByToken } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  listClaims,
  readClaim,
  uniqueLabel,
} from './helpers'

const duplicateLineNumberCode = 'warranty_claims.errors.duplicateLineNo'

async function expectDuplicateLineNumber(response: APIResponse): Promise<void> {
  const body = await readJsonSafe<{ code?: string; error?: string }>(response)
  expect(response.status(), `duplicate line number response: ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code).toBe(duplicateLineNumberCode)
  expect(body?.error).toEqual(expect.any(String))
  expect(body?.error?.trim()).toBeTruthy()
  expect(body?.error).not.toBe(duplicateLineNumberCode)
}

async function readClaimState(request: APIRequestContext, token: string, claimId: string) {
  const claim = await readClaim(request, token, claimId)
  const lines = await listClaimLines(request, token, claimId)
  return {
    lines: lines.sort((left, right) => (left.id ?? '').localeCompare(right.id ?? '')),
    totals: {
      claimed: claim.totalClaimedAmount,
      approved: claim.totalApprovedAmount,
      recovered: claim.totalRecoveredAmount,
    },
  }
}

test.describe('TC-WC-040: live claim line number uniqueness', () => {
  test('rejects delete undo while its number is occupied and retries the same token after renumbering', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: uniqueLabel('tc-wc-040-delete-undo'),
        currencyCode: 'USD',
        lines: [
          { lineNo: 1, productName: 'Retained part', qtyClaimed: 1, creditAmount: 10 },
          { lineNo: 2, productName: 'Deleted part', qtyClaimed: 1, creditAmount: 20 },
        ],
      })
      claimId = expectId(claim.id, 'claim fixture should have an id')
      const initialLines = await listClaimLines(request, token, claimId)
      const deletedLineId = expectId(initialLines.find((line) => line.lineNo === 2)?.id, 'line 2 should exist')
      const deleted = await apiRequest(request, 'DELETE', `/api/warranty_claims/lines?id=${deletedLineId}`, { token })
      expect(deleted.status()).toBe(200)
      const deleteOperation = expectOperation(deleted, 'delete warranty claim line')

      const appended = await apiRequest(request, 'POST', '/api/warranty_claims/lines', {
        token,
        data: { claimId, productName: 'Replacement part', qtyClaimed: 1, creditAmount: 30 },
      })
      expect(appended.status()).toBe(201)
      const appendedBody = await readJsonSafe<{ id?: string }>(appended)
      const appendedId = expectId(appendedBody?.id, 'appended line should have an id')
      const beforeUndo = await readClaimState(request, token, claimId)
      expect(beforeUndo.lines.map((line) => line.lineNo).sort()).toEqual([1, 2])
      expect(beforeUndo.lines.find((line) => line.id === appendedId)?.lineNo).toBe(2)
      expect(Number(beforeUndo.totals.claimed)).toBe(40)

      await expectDuplicateLineNumber(await undoByToken(request, token, deleteOperation.undoToken))
      expect(await readClaimState(request, token, claimId)).toEqual(beforeUndo)

      const renumbered = await apiRequest(request, 'PUT', '/api/warranty_claims/lines', {
        token,
        data: { id: appendedId, lineNo: 3 },
      })
      expect(renumbered.status()).toBe(200)
      const retriedUndo = await undoByToken(request, token, deleteOperation.undoToken)
      expect(retriedUndo.status()).toBe(200)
      expect(await readJsonSafe<{ ok?: boolean }>(retriedUndo)).toMatchObject({ ok: true })

      const restored = await readClaimState(request, token, claimId)
      expect(restored.lines.map((line) => line.lineNo).sort()).toEqual([1, 2, 3])
      expect(restored.lines.find((line) => line.id === deletedLineId)).toMatchObject({ lineNo: 2, productName: 'Deleted part' })
      expect(Number(restored.totals.claimed)).toBe(60)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })

  test('rejects explicit duplicate creates and updates without changing lines or rollups', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: uniqueLabel('tc-wc-040-explicit'),
        currencyCode: 'USD',
        lines: [
          { lineNo: 1, productName: 'First part', qtyClaimed: 1, creditAmount: 10 },
          { lineNo: 2, productName: 'Second part', qtyClaimed: 1, creditAmount: 20 },
        ],
      })
      claimId = expectId(claim.id, 'claim fixture should have an id')
      const initialState = await readClaimState(request, token, claimId)
      const firstLineId = expectId(initialState.lines.find((line) => line.lineNo === 1)?.id, 'line 1 should exist')

      const duplicateCreate = await apiRequest(request, 'POST', '/api/warranty_claims/lines', {
        token,
        data: { claimId, lineNo: 2, productName: 'Rejected part', qtyClaimed: 1, creditAmount: 900 },
      })
      await expectDuplicateLineNumber(duplicateCreate)
      expect(await readClaimState(request, token, claimId)).toEqual(initialState)

      const duplicateUpdate = await apiRequest(request, 'PUT', '/api/warranty_claims/lines', {
        token,
        data: { id: firstLineId, lineNo: 2, creditAmount: 800 },
      })
      await expectDuplicateLineNumber(duplicateUpdate)
      expect(await readClaimState(request, token, claimId)).toEqual(initialState)

      const sameNumberUpdate = await apiRequest(request, 'PUT', '/api/warranty_claims/lines', {
        token,
        data: { id: firstLineId, lineNo: 1, productName: 'Updated first part' },
      })
      expect(sameNumberUpdate.status()).toBe(200)
      const updatedState = await readClaimState(request, token, claimId)
      expect(updatedState.lines.find((line) => line.id === firstLineId)?.productName).toBe('Updated first part')
      expect(updatedState.totals).toEqual(initialState.totals)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })

  for (const scenario of [
    { name: 'explicit duplicates', lines: [{ lineNo: 1 }, { lineNo: 1 }] },
    { name: 'explicit number followed by a colliding default', lines: [{ lineNo: 2 }, {}] },
    { name: 'default number followed by a colliding explicit number', lines: [{}, { lineNo: 1 }] },
  ]) {
    test(`rejects initial claim batches with ${scenario.name} atomically`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const customerName = uniqueLabel('tc-wc-040-batch')
      const query = `search=${encodeURIComponent(customerName)}&pageSize=100`
      let createdClaimId: string | null = null

      try {
        const created = await apiRequest(request, 'POST', '/api/warranty_claims', {
          token,
          data: {
            claimType: 'warranty',
            customerName,
            currencyCode: 'USD',
            lines: scenario.lines.map((line, index) => ({
              ...line,
              productName: `Batch part ${index + 1}`,
              qtyClaimed: 1,
              creditAmount: 10,
            })),
          },
        })
        const body = await readJsonSafe<{ id?: string }>(created)
        createdClaimId = typeof body?.id === 'string' ? body.id : null
        await expectDuplicateLineNumber(created)
        expect(await listClaims(request, token, query)).toEqual([])
      } finally {
        await cleanupDraftClaimWithLines(request, token, createdClaimId)
        const remainingClaims = await listClaims(request, token, query)
        for (const claim of remainingClaims) {
          await cleanupDraftClaimWithLines(request, token, claim.id)
        }
      }
    })
  }

  test('serializes concurrent explicit creates and accepts the rejected payload with a free number', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: uniqueLabel('tc-wc-040-concurrent'),
        currencyCode: 'USD',
      })
      claimId = expectId(claim.id, 'claim fixture should have an id')
      const payloads = [
        { claimId, lineNo: 7, productName: 'Concurrent first part', qtyClaimed: 1, creditAmount: 10 },
        { claimId, lineNo: 7, productName: 'Concurrent second part', qtyClaimed: 1, creditAmount: 20 },
      ]
      const responses = await Promise.all(payloads.map((data) => apiRequest(request, 'POST', '/api/warranty_claims/lines', {
        token,
        data,
        retryTransport: false,
      })))
      expect(responses.map((response) => response.status()).sort()).toEqual([201, 409])
      const rejectedIndex = responses.findIndex((response) => response.status() === 409)
      await expectDuplicateLineNumber(responses[rejectedIndex]!)
      const afterRace = await readClaimState(request, token, claimId)
      expect(afterRace.lines).toHaveLength(1)
      expect(afterRace.lines[0]?.lineNo).toBe(7)
      expect(Number(afterRace.totals.claimed)).toBe(payloads[1 - rejectedIndex]!.creditAmount)

      const retried = await apiRequest(request, 'POST', '/api/warranty_claims/lines', {
        token,
        data: { ...payloads[rejectedIndex], lineNo: 8 },
      })
      expect(retried.status()).toBe(201)
      const afterRetry = await readClaimState(request, token, claimId)
      expect(afterRetry.lines.map((line) => line.lineNo).sort()).toEqual([7, 8])
      expect(Number(afterRetry.totals.claimed)).toBe(30)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })

  test('orders ordinary line edits and renumbering through the parent lock without deadlocking', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: uniqueLabel('tc-wc-040-lock-order'),
        currencyCode: 'USD',
        lines: [{ lineNo: 1, productName: 'Original part', qtyClaimed: 1, creditAmount: 10 }],
      })
      claimId = expectId(claim.id, 'claim fixture should have an id')
      const initialLines = await listClaimLines(request, token, claimId)
      const lineId = expectId(initialLines[0]?.id, 'claim line fixture should have an id')

      await withClient(async (blocker) => withClient(async (observer) => {
        const pendingUpdates: Promise<APIResponse>[] = []
        let released = false
        await blocker.query('begin')
        try {
          const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid
          expect(blockerPid).toEqual(expect.any(Number))
          const lockedLine = await blocker.query(
            `select id from warranty_claim_lines
              where id = $1 and claim_id = $2 and tenant_id = $3 and organization_id = $4
              for update`,
            [lineId, claimId, tenantId, organizationId],
          )
          expect(lockedLine.rowCount).toBe(1)

          pendingUpdates.push(apiRequest(request, 'PUT', '/api/warranty_claims/lines', {
            token,
            data: { id: lineId, productName: 'Updated part' },
            retryTransport: false,
          }))
          await expect.poll(async () => {
            const waiting = await observer.query<{ waiting: boolean }>(
              `select exists (
                 select 1 from pg_stat_activity activity
                  where activity.datname = current_database()
                    and activity.wait_event_type = 'Lock'
                    and activity.query ilike '%update%warranty_claim_lines%'
                    and $1 = any(pg_blocking_pids(activity.pid))
               ) as waiting`,
              [blockerPid],
            )
            return waiting.rows[0]?.waiting ?? false
          }).toBe(true)

          pendingUpdates.push(apiRequest(request, 'PUT', '/api/warranty_claims/lines', {
            token,
            data: { id: lineId, lineNo: 2 },
            retryTransport: false,
          }))
          await expect.poll(async () => {
            const waiters = await observer.query<{ count: number }>(
              `with recursive blocked(pid) as (
                 select activity.pid from pg_stat_activity activity
                  where activity.datname = current_database()
                    and $1 = any(pg_blocking_pids(activity.pid))
                 union
                 select activity.pid from pg_stat_activity activity
                   join blocked predecessor on predecessor.pid = any(pg_blocking_pids(activity.pid))
                  where activity.datname = current_database()
               )
               select count(*)::integer as count from blocked`,
              [blockerPid],
            )
            return waiters.rows[0]?.count ?? 0
          }).toBeGreaterThanOrEqual(2)

          await blocker.query('commit')
          released = true
          const responses = await Promise.all(pendingUpdates)
          for (const response of responses) {
            expect(response.status(), await response.text()).toBe(200)
          }
        } finally {
          if (!released) await blocker.query('rollback')
          await Promise.allSettled(pendingUpdates)
        }
      }))

      const finalState = await readClaimState(request, token, claimId)
      expect(finalState.lines).toHaveLength(1)
      expect(finalState.lines[0]).toMatchObject({ id: lineId, productName: 'Updated part', lineNo: 2 })
      expect(Number(finalState.totals.claimed)).toBe(10)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })
})
