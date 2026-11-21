import { expect, type APIResponse } from '@playwright/test'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { test, type RecoveryAction, type RecoveryFixture } from './helpers/actionConflictFixtures'
import { readClaim, readClaimLine, requestJson } from './helpers'

async function blockedContenders(observer: IntegrationDbClient, ownerPid: number): Promise<number> {
  const result = await observer.query<{ count: string }>(
    `with recursive waiting(pid) as (
       select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
       union
       select activity.pid from pg_stat_activity activity
       join waiting on waiting.pid = any(pg_blocking_pids(activity.pid))
     ) select count(*)::text as count from waiting`,
    [ownerPid],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function actionPayload(action: RecoveryAction, fixture: RecoveryFixture, contender: number, updatedAt: string) {
  if (action === 'label') {
    return {
      claimId: fixture.claim.id,
      manual: true,
      labelUrl: `https://labels.example.test/${fixture.claim.id}/${contender}`,
      trackingNumber: `contender-${contender}`,
      carrier: 'Owned regression carrier',
      updatedAt,
    }
  }
  return action === 'release'
    ? { lineId: fixture.line.id, action: 'release', updatedAt }
    : { lineId: fixture.line.id, conditionGrade: 'B', inspectionNotes: `Contender ${contender}`, updatedAt }
}

for (const action of ['grading', 'release', 'label'] as const) {
  test.describe(`TC-WC-8725: atomic ${action} writes`, () => {
    test.use({ recoveryAction: action })

    test('two requests starting from the same version produce one write and one conflict, then allow a refreshed retry', async ({ request, recovery }, testInfo) => {
      const { tenantId, organizationId } = getTokenContext(recovery.writerToken)
      expect(tenantId).toBeTruthy()
      expect(organizationId).toBeTruthy()
      const scope = [recovery.claim.id, tenantId, organizationId]
      const version = action === 'label' ? recovery.claim.updatedAt : recovery.line.updatedAt
      const route = `/api/warranty_claims/${action === 'label' ? 'return-label' : 'receiving'}`
      const eventAction = action === 'label' ? 'return_label_created' : action === 'release' ? 'line_quarantine_released' : 'line_received'
      const eventCount = async (client: IntegrationDbClient) => {
        const result = await client.query<{ count: string }>(
          `select count(*)::text as count from warranty_claim_events
           where claim_id = $1 and tenant_id = $2 and organization_id = $3 and payload->>'action' = $4`,
          [...scope, eventAction],
        )
        return Number(result.rows[0]?.count ?? 0)
      }

      await withClient(async (lock) => withClient(async (observer) => {
        const storedLabel = async () => (await observer.query<{ label: string; tracking: string }>(
          `select return_label_url as label, return_tracking_number as tracking from warranty_claims
           where id = $1 and tenant_id = $2 and organization_id = $3 and deleted_at is null`, scope,
        )).rows[0]
        const beforeEvents = await eventCount(observer)
        const beforeClaim = await readClaim(request, recovery.writerToken, recovery.claim.id)
        const beforeLine = await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)
        const owner = await lock.query<{ pid: number }>('select pg_backend_pid() as pid')
        await lock.query('begin')
        await lock.query("set local statement_timeout = '5s'")
        let responses: Promise<PromiseSettledResult<APIResponse>[]> | undefined
        let barrierError: unknown
        try {
          const held = await lock.query(
            'select id from warranty_claims where id = $1 and tenant_id = $2 and organization_id = $3 and deleted_at is null for update',
            scope,
          )
          expect(held.rowCount).toBe(1)
          responses = Promise.allSettled([0, 1].map((contender) => requestJson(
            request, 'POST', route, recovery.writerToken,
            actionPayload(action, recovery, contender, version), version,
          )))
          await expect.poll(() => blockedContenders(observer, owner.rows[0].pid)).toBe(2)
        } catch (error) {
          barrierError = error
        } finally {
          await lock.query('rollback')
        }

        const outcomes = responses ? await responses : []
        if (barrierError) throw barrierError
        expect(outcomes).toHaveLength(2)
        const results = outcomes.map((outcome) => {
          if (outcome.status === 'rejected') throw outcome.reason
          return outcome.value
        })
        const statuses = results.map((response) => response.status())
        expect([...statuses].sort()).toEqual([200, 409])
        const winner = statuses.indexOf(200)
        const loser = statuses.indexOf(409)
        expect(await readJsonSafe(results[loser])).toMatchObject({ code: 'optimistic_lock_conflict' })
        expect(await eventCount(observer)).toBe(beforeEvents + 1)

        const claim = await readClaim(request, recovery.writerToken, recovery.claim.id)
        const line = await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)
        expect(claim.vendorRef).toBe(beforeClaim.vendorRef)
        expect(claim.totalClaimedAmount).toBe(beforeClaim.totalClaimedAmount)
        expect(line.creditAmount).toBe(beforeLine.creditAmount)
        expect(line.productName).toBe(beforeLine.productName)
        expect(line.qtyClaimed).toBe(beforeLine.qtyClaimed)
        if (action === 'grading') {
          expect(line.inspectionNotes).toBe(`Contender ${winner}`)
          expect(line.conditionGrade).toBe('B')
        } else if (action === 'release') {
          expect(line.quarantineStatus).toBe('released')
          expect(line.conditionGrade).toBe(beforeLine.conditionGrade)
        } else {
          expect(await storedLabel()).toEqual({
            label: `https://labels.example.test/${recovery.claim.id}/${winner}`,
            tracking: `contender-${winner}`,
          })
        }

        const refreshedVersion = action === 'label' ? claim.updatedAt : line.updatedAt
        expect(refreshedVersion).toBeTruthy()
        expect(refreshedVersion).not.toBe(version)
        const retry = await requestJson(request, 'POST', route, recovery.writerToken,
          actionPayload(action, recovery, loser, refreshedVersion!), refreshedVersion!)
        expect(retry.status(), await retry.text()).toBe(200)
        expect(await eventCount(observer)).toBe(beforeEvents + 2)
        const retriedClaim = await readClaim(request, recovery.writerToken, recovery.claim.id)
        const retriedLine = await readClaimLine(request, recovery.writerToken, recovery.claim.id, recovery.line.id)
        expect(retriedClaim.vendorRef).toBe(beforeClaim.vendorRef)
        expect(retriedLine.creditAmount).toBe(beforeLine.creditAmount)
        if (action === 'grading') expect(retriedLine.inspectionNotes).toBe(`Contender ${loser}`)
        if (action === 'label') expect((await storedLabel()).tracking).toBe(`contender-${loser}`)
        await testInfo.attach('same-version-arbitration', {
          body: JSON.stringify({ action, blockedContenders: 2, statuses, retry: retry.status(), eventDelta: 2 }),
          contentType: 'application/json',
        })
      }))
    })
  })
}
