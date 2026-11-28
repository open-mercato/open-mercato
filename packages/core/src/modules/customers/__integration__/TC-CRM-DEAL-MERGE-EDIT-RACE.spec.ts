import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createDealFixture, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['customers', 'auth'] }

const MERGE_PATH = '/api/customers/deals/merge'
const INTERACTIONS_PATH = '/api/customers/interactions'
const PAUSE_TABLE = 'customer_dictionary_entries'
const WAIT_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 100

type MergeRecordPreview = { id: string; updatedAt: string; fields: Record<string, unknown>; customFields: Record<string, unknown> }
type MergePreview = { left: MergeRecordPreview; right: MergeRecordPreview }
type ItemPage = { items?: Array<Record<string, unknown>> }
type InteractionState = { updatedAt: string; dealId: unknown; title: unknown }
type OwnedFixture = { resource: string; id: string | null; path: string }

async function deleteOwnedFixtures(
  request: APIRequestContext,
  token: string | null,
  fixtures: OwnedFixture[],
): Promise<string[]> {
  const failures: string[] = []
  if (!token) return failures
  for (const fixture of fixtures) {
    if (!fixture.id) continue
    try {
      const response = await apiRequest(request, 'DELETE', `${fixture.path}?id=${encodeURIComponent(fixture.id)}`, { token })
      if (response.status() !== 200 && response.status() !== 404) {
        failures.push(`${fixture.resource} ${fixture.id}: HTTP ${response.status()}`)
      }
    } catch (error) {
      failures.push(`${fixture.resource} ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return failures
}

async function readInteraction(
  request: APIRequestContext,
  token: string,
  companyId: string,
  interactionId: string,
): Promise<InteractionState> {
  const response = await apiRequest(request, 'GET', `${INTERACTIONS_PATH}?entityId=${companyId}&limit=100`, { token })
  expect(response.status(), 'interactions should be listed for their company').toBe(200)
  const body = await readJsonSafe<ItemPage>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === interactionId)
  expect(item, 'the interaction should be listed').toBeTruthy()
  expect(typeof item?.updatedAt, 'the interaction should expose its edit version').toBe('string')
  return { updatedAt: String(item?.updatedAt), dealId: item?.dealId, title: item?.title }
}

async function waitUntil(description: string, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probe()) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`[internal] Timed out waiting until ${description}`)
}

async function editTransactionIsPausedAfterLoading(): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query<{ waiting: number }>(
      `select count(*)::int as waiting
         from pg_locks waiting
        where waiting.relation = $1::regclass
          and not waiting.granted
          and exists (
            select 1 from pg_locks held
             where held.pid = waiting.pid
               and held.granted
               and held.relation = 'customer_interactions'::regclass
          )`,
      [PAUSE_TABLE],
    )
    return (result.rows[0]?.waiting ?? 0) > 0
  })
}

async function committedDealId(interactionId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deal_id: string | null }>(
      'select deal_id from customer_interactions where id = $1',
      [interactionId],
    )
    return result.rows[0]?.deal_id ?? null
  })
}

async function releasePause(blocker: IntegrationDbClient, paused: boolean): Promise<void> {
  if (paused) await blocker.query('rollback')
}

/**
 * TC-CRM-DEAL-MERGE-EDIT-RACE: an interaction edit that loaded its version before a Deal merge
 * committed must not write with that pre-merge token.
 *
 * The edit is paused deterministically, without any test hook in production code: the spec holds
 * an ACCESS EXCLUSIVE lock on `customer_dictionary_entries`, which only the edit reads (the
 * activity-type catalog lookup runs after the edit loaded the interaction and passed its first
 * version check, before the write). The spec waits until PostgreSQL reports the edit's backend
 * waiting on that lock while its transaction already holds `customer_interactions` (it has
 * loaded the row), commits a merge that moves the interaction, and only then releases the lock.
 * The edit must re-read the version under the interaction row lock and return 409.
 *
 * The lock is table-wide on a table every tenant shares, so it would stall any other spec running
 * at the same time. The spec therefore runs serially and refuses to start unless Playwright runs
 * with a single worker (the integration config sets `workers: 1`); the blocker's `lock_timeout`
 * bounds the wait if that assumption is ever broken.
 */
test.describe('TC-CRM-DEAL-MERGE-EDIT-RACE: an edit paused across a Deal merge is rejected', () => {
  test.describe.configure({ mode: 'serial' })

  test('a title-only edit that loaded the pre-merge version returns 409 after the merge commits', async ({ request }, testInfo) => {
    expect(
      testInfo.config.workers,
      `${PAUSE_TABLE} is locked table-wide, so this spec requires a single Playwright worker`,
    ).toBe(1)
    test.slow()
    let token: string | null = null
    let companyId: string | null = null
    let survivorId: string | null = null
    let sourceId: string | null = null
    let interactionId: string | null = null
    let testFailed = true
    const stamp = Date.now()
    const originalTitle = `QA edit race interaction ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      const authToken = token
      companyId = await createCompanyFixture(request, authToken, `QA edit race Co ${stamp}`)
      survivorId = await createDealFixture(request, authToken, { title: `QA edit race survivor ${stamp}` })
      sourceId = await createDealFixture(request, authToken, { title: `QA edit race source ${stamp}` })
      const mergeSurvivorId = survivorId
      const mergeSourceId = sourceId

      const createResponse = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
        token: authToken,
        data: { entityId: companyId, dealId: sourceId, interactionType: 'task', title: originalTitle, status: 'planned' },
      })
      expect(createResponse.status(), 'interaction create should succeed').toBe(201)
      interactionId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(interactionId, 'interaction create should return an id').toBeTruthy()
      const editedId = interactionId as string

      const beforeMerge = await readInteraction(request, authToken, companyId, editedId)
      expect(beforeMerge.dealId).toBe(sourceId)

      const previewParams = new URLSearchParams({ left: survivorId, right: sourceId })
      const previewResponse = await apiRequest(request, 'GET', `${MERGE_PATH}?${previewParams}`, { token: authToken })
      expect(previewResponse.status(), 'merge preview should load both Deals').toBe(200)
      const preview = await readJsonSafe<MergePreview>(previewResponse)
      expect(preview?.left.id).toBe(survivorId)

      const { editResponse, mergeResponse } = await withClient(async (blocker) => {
        await blocker.query('begin')
        let paused = true
        const inFlight: Promise<APIResponse>[] = []
        try {
          await blocker.query("set local lock_timeout = '10s'")
          await blocker.query(`lock table ${PAUSE_TABLE} in access exclusive mode`)

          let editSettled = false
          const edit: Promise<APIResponse> = apiRequest(request, 'PUT', INTERACTIONS_PATH, {
            token: authToken,
            headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: beforeMerge.updatedAt },
            data: { id: editedId, title: `QA edit race stale title ${stamp}` },
          }).finally(() => { editSettled = true })
          inFlight.push(edit)

          await waitUntil('the edit has loaded the interaction and is paused', editTransactionIsPausedAfterLoading)
          expect(editSettled, 'the edit must still be in flight while paused').toBe(false)

          const merge = apiRequest(request, 'POST', MERGE_PATH, {
            token: authToken,
            data: {
              survivorId: mergeSurvivorId,
              sourceId: mergeSourceId,
              survivorUpdatedAt: preview!.left.updatedAt,
              sourceUpdatedAt: preview!.right.updatedAt,
              values: { ...preview!.left.fields, title: `QA edit race merged ${stamp}` },
              customFields: preview!.left.customFields ?? {},
              personIds: [],
              companyIds: [],
              primaryPersonEntityId: null,
            },
          })
          inFlight.push(merge)
          await waitUntil('the merge has committed the interaction move', async () =>
            (await committedDealId(editedId)) === mergeSurvivorId)
          expect(editSettled, 'the edit must not finish before the merge commits').toBe(false)

          await releasePause(blocker, paused)
          paused = false
          return { editResponse: await edit, mergeResponse: await merge }
        } finally {
          await releasePause(blocker, paused)
          await Promise.allSettled(inFlight)
        }
      })

      expect(mergeResponse.status(), 'the merge should succeed').toBe(200)
      sourceId = null
      const editBody = await readJsonSafe<{ code?: string }>(editResponse)
      expect(editResponse.status(), 'an edit holding a pre-merge version must not write').toBe(409)
      expect(editBody?.code).toBe('optimistic_lock_conflict')

      const afterRace = await readInteraction(request, authToken, companyId, editedId)
      expect(afterRace.dealId, 'the interaction keeps the Deal the merge moved it to').toBe(survivorId)
      expect(afterRace.title, 'the rejected edit must not change the title').toBe(originalTitle)
      expect(afterRace.updatedAt, 'the merge version stays current').not.toBe(beforeMerge.updatedAt)
      testFailed = false
    } finally {
      const cleanupFailures = await deleteOwnedFixtures(request, token, [
        { resource: 'interaction', id: interactionId, path: INTERACTIONS_PATH },
        { resource: 'source deal', id: sourceId, path: '/api/customers/deals' },
        { resource: 'survivor deal', id: survivorId, path: '/api/customers/deals' },
        { resource: 'company', id: companyId, path: '/api/customers/companies' },
      ])
      if (cleanupFailures.length > 0) {
        testInfo.annotations.push({ type: 'cleanup-failures', description: cleanupFailures.join('; ') })
        if (!testFailed) throw new Error(`Fixture cleanup failed: ${cleanupFailures.join('; ')}`)
      }
    }
  })
})
