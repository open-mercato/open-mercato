import { randomInt, randomUUID } from 'node:crypto'
import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

type Membership = { id: string; entityId: string; createdAt: string }
type Scope = { tenantId: string; organizationId: string }

async function readMemberships(client: IntegrationDbClient, tagId: string, scope: Scope): Promise<Membership[]> {
  const result = await client.query<{ id: string; entity_id: string; created_at: Date }>(
    `select id, entity_id, created_at from customer_tag_assignments
      where tag_id = $1 and tenant_id = $2 and organization_id = $3 order by entity_id`,
    [tagId, scope.tenantId, scope.organizationId],
  )
  return result.rows.map((row) => ({ id: row.id, entityId: row.entity_id, createdAt: row.created_at.toISOString() }))
}

async function waitForBlockedQuery(
  client: IntegrationDbClient,
  blockerPid: number,
  table: string,
  waitEvent: string | null = null,
): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
        where $1 = any(pg_blocking_pids(pid)) and query like $2
          and ($3::text is null or wait_event = $3)`,
      [blockerPid, `%${table}%`, waitEvent],
    )
    if (result.rows[0]) return result.rows[0].pid
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('[internal] Tag contender did not reach the expected PostgreSQL lock')
}

test.describe('TC-CRM-7855 tag deletion contention and retry', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('snapshots committed memberships under the tag lock and retries the losing assignment without duplicates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tokenScope = getTokenScope(token)
    const scope = {
      tenantId: expectId(tokenScope.tenantId, 'Admin tenant scope is required'),
      organizationId: expectId(tokenScope.organizationId, 'Admin organization scope is required'),
    }
    const stamp = `${Date.now()}_${randomInt(1_000_000)}`
    const functionName = `om_tag_delete_gate_${stamp}`
    const triggerName = `om_tag_delete_gate_trigger_${stamp}`
    const gateKey = randomInt(1, 2_147_483_647)
    const personIds: string[] = []
    let tagId: string | null = null

    try {
      for (const label of ['existing', 'before-lock', 'contender']) {
        personIds.push(await createPersonFixture(request, token, {
          firstName: 'TagRace', lastName: `${label}-${stamp}`, displayName: `TagRace ${label} ${stamp}`,
        }))
      }
      const created = await apiRequest(request, 'POST', '/api/customers/tags', {
        token, data: { slug: `tag-race-${stamp}`, label: `TagRace ${stamp}` },
      })
      expect(created.status()).toBe(201)
      tagId = expectId(expectOperation(created, 'tags.create').resourceId, 'Created tag id is required')
      const targetTagId = tagId
      const assigned = await apiRequest(request, 'POST', '/api/customers/tags/assign', {
        token, data: { tagId, entityId: personIds[0] },
      })
      expect(assigned.status()).toBe(201)

      await withClient(async (client) => {
        await client.query(
          `create function "${functionName}"() returns trigger language plpgsql as $$
           begin
             perform pg_advisory_xact_lock(${gateKey});
             return old;
           end
           $$`,
        )
        await client.query(
          `create trigger "${triggerName}" before delete on customer_tags
             for each row when (old.id = '${targetTagId}'::uuid)
             execute function "${functionName}"()`,
        )
      })

      const race = await withCredentialIsolatedRequest(async (deleteRequest) => (
        withCredentialIsolatedRequest(async (assignRequest) => (
          withClient(async (blocker) => (
            withClient(async (observer) => {
              const blockerPid = Number((await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid)
              const pending: Array<Promise<APIResponse>> = []
              await blocker.query('select pg_advisory_lock($1)', [gateKey])
              try {
                await blocker.query('begin')
                await blocker.query(
                  'select id from customer_tags where id = $1 and tenant_id = $2 and organization_id = $3 for update',
                  [targetTagId, scope.tenantId, scope.organizationId],
                )
                const pendingDelete = apiRequest(deleteRequest, 'DELETE', `/api/customers/tags?id=${targetTagId}`, {
                  token, timeout: 10_000, retryTransport: false,
                })
                pending.push(pendingDelete)
                await waitForBlockedQuery(observer, blockerPid, 'customer_tags')

                await blocker.query(
                  `insert into customer_tag_assignments (id, tag_id, entity_id, tenant_id, organization_id, created_at)
                   values ($1, $2, $3, $4, $5, now())`,
                  [randomUUID(), targetTagId, personIds[1], scope.tenantId, scope.organizationId],
                )
                const expectedMemberships = await readMemberships(blocker, targetTagId, scope)
                expect(expectedMemberships).toHaveLength(2)
                await blocker.query('commit')

                const deletePid = await waitForBlockedQuery(observer, blockerPid, 'customer_tags', 'advisory')
                expect(await readMemberships(observer, targetTagId, scope), 'uncommitted deletion remains invisible').toEqual(expectedMemberships)
                const pendingAssign = apiRequest(assignRequest, 'POST', '/api/customers/tags/assign', {
                  token, data: { tagId: targetTagId, entityId: personIds[2] }, timeout: 10_000, retryTransport: false,
                })
                pending.push(pendingAssign)
                const assignmentPid = await waitForBlockedQuery(observer, deletePid, 'customer_tag_assignments')
                expect(assignmentPid).not.toBe(deletePid)
                await blocker.query('select pg_advisory_unlock($1)', [gateKey])
                const [deleted, competingAssignment] = await Promise.all([pendingDelete, pendingAssign])
                return {
                  deleted: { status: deleted.status(), body: await deleted.text(), operation: expectOperation(deleted, 'tags.delete') },
                  competingAssignment: { status: competingAssignment.status(), body: await competingAssignment.text() },
                  expectedMemberships,
                }
              } finally {
                await blocker.query('rollback')
                await blocker.query('select pg_advisory_unlock($1)', [gateKey])
                await Promise.allSettled(pending)
              }
            })
          ))
        ))
      ))

      expect(race.deleted.status, race.deleted.body).toBe(200)
      expect(race.competingAssignment.status, race.competingAssignment.body).toBe(400)
      const operation = race.deleted.operation
      await withClient(async (client) => {
        expect(await readMemberships(client, targetTagId, scope)).toEqual([])
      })
      const auditQuery = new URLSearchParams({
        resourceKind: 'customers.tag', resourceId: targetTagId, organizationId: scope.organizationId, pageSize: '20',
      })
      const auditResponse = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${auditQuery}`, { token })
      expect(auditResponse.status(), await auditResponse.text()).toBe(200)
      const auditBody = await readJsonSafe<{
        items?: Array<{ id: string; snapshotBefore?: { assignments?: Membership[] } | null }>
      }>(auditResponse)
      const captured = auditBody?.items?.find((entry) => entry.id === operation.logId)?.snapshotBefore?.assignments
      expect(captured, 'decrypted delete snapshot contains both committed memberships').toHaveLength(race.expectedMemberships.length)
      expect(captured?.map(({ id, entityId, createdAt }) => ({ id, entityId, createdAt }))
        .sort((left, right) => left.entityId.localeCompare(right.entityId))).toEqual(race.expectedMemberships)

      const rejectedRetry = await apiRequest(request, 'POST', '/api/customers/tags/assign', {
        token, data: { tagId: targetTagId, entityId: personIds[2] }, retryTransport: false,
      })
      expect(rejectedRetry.status()).toBe(404)
      await undoOk(request, token, operation.undoToken, 'undo tag delete after real contention')
      await withClient(async (client) => {
        expect(await readMemberships(client, targetTagId, scope), 'undo preserves both committed membership ids and timestamps').toEqual(race.expectedMemberships)
      })

      const retryAssignment = () => apiRequest(request, 'POST', '/api/customers/tags/assign', {
        token, data: { tagId: targetTagId, entityId: personIds[2] }, retryTransport: false,
      })
      const retry = await retryAssignment()
      expect(retry.status(), await retry.text()).toBe(201)
      const retriedId = expectOperation(retry, 'tags.assign').resourceId
      const repeatedRetry = await retryAssignment()
      expect(repeatedRetry.status()).toBe(409)
      await withClient(async (client) => {
        const finalMemberships = await readMemberships(client, targetTagId, scope)
        expect(finalMemberships.map((membership) => membership.entityId)).toEqual([...personIds].sort())
        expect(finalMemberships.filter((membership) => membership.entityId !== personIds[2])).toEqual(race.expectedMemberships)
        expect(finalMemberships.find((membership) => membership.entityId === personIds[2])?.id).toBe(retriedId)
      })
    } finally {
      await withClient(async (client) => {
        await client.query(`drop trigger if exists "${triggerName}" on customer_tags`)
        await client.query(`drop function if exists "${functionName}"()`)
      })
      await deleteEntityIfExists(request, token, '/api/customers/tags', tagId)
      for (const personId of personIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
    }
  })
})
