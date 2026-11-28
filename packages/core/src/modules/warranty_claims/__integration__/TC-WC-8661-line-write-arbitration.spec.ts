import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { cleanupDraftClaimWithLines, createClaimFixture, listClaimLines, OPTIMISTIC_LOCK_HEADER, readClaim, readClaimLine, readClaimMaybe, uniqueLabel } from './helpers'

async function blockedLineWrites(observer: IntegrationDbClient, ownerPid: number) {
  const result = await observer.query<{ count: number }>(
    `with recursive blocked(pid) as (
       select activity.pid from pg_stat_activity activity
        where activity.datname = current_database() and activity.wait_event_type = 'Lock'
          and exists (select 1 from pg_locks parent_lock where parent_lock.pid = activity.pid
            and parent_lock.relation = 'warranty_claims'::regclass and parent_lock.mode = 'RowShareLock' and parent_lock.granted)
          and $1 = any(pg_blocking_pids(activity.pid))
       union
       select activity.pid from pg_stat_activity activity
         join blocked predecessor on predecessor.pid = any(pg_blocking_pids(activity.pid))
        where activity.datname = current_database() and activity.wait_event_type = 'Lock'
          and exists (select 1 from pg_locks parent_lock where parent_lock.pid = activity.pid
            and parent_lock.relation = 'warranty_claims'::regclass and parent_lock.mode = 'RowShareLock' and parent_lock.granted)
     ) select count(*)::integer as count from blocked`,
    [ownerPid],
  )
  return result.rows[0]?.count ?? 0
}

test.describe('TC-WC-8661: claim line write arbitration in the native PostgreSQL job', () => {
  for (const secondOperation of ['update', 'delete'] as const) {
    test(`HTTP update/${secondOperation} with the same version commits once, rejects the loser, and accepts its refreshed retry`, async ({ request }, testInfo) => {
      const token = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenScope(token)
      let claimId: string | null = null
      try {
        const claim = await createClaimFixture(request, token, {
          claimType: 'warranty', customerName: uniqueLabel('tc-wc-8661'), currencyCode: 'USD',
          vendorRef: 'Unrelated vendor reference',
          lines: [{ productName: 'Original product', inspectionNotes: 'Unrelated inspection', qtyClaimed: 1, creditAmount: 9 }],
        }, (createdId) => { claimId = createdId })
        claimId = expectId(claim.id, 'claim fixture should have an id')
        const [line] = await listClaimLines(request, token, claimId)
        const lineId = expectId(line?.id, 'line fixture should have an id')
        const version = line.updatedAt
        expect(version).toBeTruthy()
        const mutate = (operation: 'update' | 'delete', updatedAt: string, contender: number) => apiRequest(
          request, operation === 'delete' ? 'DELETE' : 'PUT',
          operation === 'delete' ? `/api/warranty_claims/lines?id=${lineId}` : '/api/warranty_claims/lines',
          { token, headers: { [OPTIMISTIC_LOCK_HEADER]: updatedAt }, retryTransport: false,
            ...(operation === 'update' ? { data: { id: lineId, productName: `Contender ${contender}` } } : {}) },
        )
        const pending: Promise<APIResponse>[] = []
        await withClient(async (blocker) => withClient(async (observer) => {
          await blocker.query('begin')
          try {
            const owner = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
            const held = await blocker.query(
              'select id from warranty_claims where id=$1 and tenant_id=$2 and organization_id=$3 and deleted_at is null for update',
              [claimId, tenantId, organizationId],
            )
            expect(held.rowCount).toBe(1)
            pending.push(mutate('update', version!, 0))
            await expect.poll(() => blockedLineWrites(observer, owner.rows[0].pid)).toBe(1)
            pending.push(mutate(secondOperation, version!, 1))
            await expect.poll(() => blockedLineWrites(observer, owner.rows[0].pid)).toBe(2)
          } finally {
            await blocker.query('rollback')
            await Promise.allSettled(pending)
          }
        }))
        const responses = await Promise.all(pending)
        expect(responses.map((response) => response.status())).toEqual([200, 409])
        const refreshed = await readClaimLine(request, token, claimId, lineId)
        expect(await readJsonSafe(responses[1])).toMatchObject({
          code: 'optimistic_lock_conflict', expectedUpdatedAt: version, currentUpdatedAt: refreshed.updatedAt,
        })
        expect(refreshed.updatedAt).toBeTruthy()
        expect(refreshed.updatedAt).not.toBe(version)
        expect(refreshed).toMatchObject({ productName: 'Contender 0', inspectionNotes: line.inspectionNotes,
          qtyClaimed: line.qtyClaimed, creditAmount: line.creditAmount, assessmentPayload: line.assessmentPayload })
        const afterConflict = await readClaim(request, token, claimId)
        expect(afterConflict.vendorRef).toBe(claim.vendorRef)
        expect(afterConflict.totalClaimedAmount).toBe(claim.totalClaimedAmount)
        expect(afterConflict.totalApprovedAmount).toBe(claim.totalApprovedAmount)
        const retry = await mutate(secondOperation, refreshed.updatedAt!, 1)
        expect(retry.status(), await retry.text()).toBe(200)
        const remaining = await listClaimLines(request, token, claimId)
        expect(remaining).toHaveLength(secondOperation === 'delete' ? 0 : 1)
        if (secondOperation === 'update') expect(remaining[0]).toMatchObject({ productName: 'Contender 1', creditAmount: line.creditAmount })
        const afterRetry = await readClaim(request, token, claimId)
        expect(afterRetry.vendorRef).toBe(claim.vendorRef)
        expect(Number(afterRetry.totalClaimedAmount)).toBe(secondOperation === 'delete' ? 0 : 9)
        await testInfo.attach('HTTP-line-arbitration', {
          body: JSON.stringify({ secondOperation, blockedContenders: 2, statuses: [200, 409], retry: retry.status() }),
          contentType: 'application/json',
        })
      } finally {
        await cleanupDraftClaimWithLines(request, token, claimId)
        if (claimId) {
          expect(await listClaimLines(request, token, claimId)).toEqual([])
          expect(await readClaimMaybe(request, token, claimId)).toBeNull()
        }
      }
    })
  }
})
