import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'query_index'] }

/**
 * TC-CRM-DEAL-MERGE-BRIDGE: a legacy `customer_activities` row and the canonical interaction the
 * compatibility bridge created for it share one primary key. Merging their Deal marks both records
 * as updated in the same data engine; each must keep its own CRUD event and query-index upsert, so
 * both the legacy activity projection and the interaction projection follow the survivor.
 *
 * Legacy activity rows can no longer be created over the API (POST /api/customers/activities writes
 * canonical interactions only), so the fixture inserts the legacy row directly, then bridges it via
 * PUT /api/customers/activities exactly as an operator editing a historical activity would.
 *
 * The second case moves more than INLINE_MOVED_EFFECT_LIMIT (32) records so the merge hands the
 * moved-record effects to the `customers-deal-merge-effects` worker whenever the app process
 * manages that queue (OM_MANAGED_QUEUE_WORKERS) and the always-consistent read projection is off.
 * When the environment keeps effects inline, the case still asserts the same outcome and records
 * which path ran as a test annotation; both paths are covered deterministically by
 * `lib/__tests__/dealMergeEffects.bridge.test.ts`.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const DEALS_PATH = '/api/customers/deals'
const MERGE_PATH = '/api/customers/deals/merge'
const ACTIVITIES_PATH = '/api/customers/activities'
const INTERACTIONS_PATH = '/api/customers/interactions'
const COMMENTS_PATH = '/api/customers/comments'
const MERGE_EFFECTS_QUEUE = 'customers-deal-merge-effects'
const WORKER_PATH_COMMENT_COUNT = 34

type MergeRecordPreview = { id: string; updatedAt: string; fields: Record<string, unknown> }
type MergePreview = { left: MergeRecordPreview; right: MergeRecordPreview }
type ItemPage = { items?: Array<Record<string, unknown>> }

type Fixture = {
  token: string
  companyId: string | null
  dealIds: Set<string>
  activityId: string | null
  commentIds: string[]
}

async function insertLegacyActivity(token: string, companyId: string, dealId: string, stamp: string): Promise<string> {
  const { tenantId, organizationId } = getTokenContext(token)
  const id = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into customer_activities
         (id, organization_id, tenant_id, activity_type, subject, body, occurred_at, entity_id, deal_id, created_at, updated_at)
       values ($1, $2, $3, 'note', null, null, null, $4, $5, now(), now())`,
      [id, organizationId, tenantId, companyId, dealId],
    )
  })
  return id
}

async function bridgeLegacyActivity(request: APIRequestContext, token: string, activityId: string): Promise<void> {
  const response = await apiRequest(request, 'PUT', ACTIVITIES_PATH, {
    token,
    data: { id: activityId, appearanceIcon: 'lucide:link' },
  })
  expect(response.ok(), `bridging the legacy activity through PUT ${ACTIVITIES_PATH} returned ${response.status()}`).toBeTruthy()
  const bridged = await withClient(async (client) => {
    const result = await client.query<{ deal_id: string | null }>(
      'select deal_id from customer_interactions where id = $1 and deleted_at is null',
      [activityId],
    )
    return result.rows
  })
  expect(bridged, 'the bridge must create the canonical interaction under the legacy activity id').toHaveLength(1)
}

async function loadMergePreview(request: APIRequestContext, token: string, leftId: string, rightId: string): Promise<MergePreview> {
  const response = await apiRequest(request, 'GET', `${MERGE_PATH}?${new URLSearchParams({ left: leftId, right: rightId })}`, { token })
  expect(response.status(), 'merge preview should load both Deals').toBe(200)
  const body = await readJsonSafe<MergePreview>(response)
  expect(body?.left.updatedAt).toBeTruthy()
  expect(body?.right.updatedAt).toBeTruthy()
  return body!
}

async function mergeDeals(request: APIRequestContext, token: string, survivorId: string, sourceId: string, title: string): Promise<void> {
  const preview = await loadMergePreview(request, token, survivorId, sourceId)
  const response = await apiRequest(request, 'POST', MERGE_PATH, {
    token,
    data: {
      survivorId,
      sourceId,
      survivorUpdatedAt: preview.left.updatedAt,
      sourceUpdatedAt: preview.right.updatedAt,
      values: { ...preview.left.fields, title },
      customFields: {},
      personIds: [],
      companyIds: [],
      primaryPersonEntityId: null,
    },
  })
  expect(response.status(), `merge returned ${response.status()}`).toBe(200)
}

async function readProjectionDealId(entityType: string, recordId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deal_id: string | null }>(
      `select doc->>'deal_id' as deal_id
         from entity_indexes
        where entity_type = $1 and entity_id = $2 and deleted_at is null`,
      [entityType, recordId],
    )
    return result.rows[0]?.deal_id ?? null
  })
}

async function readLegacyActivityDealId(activityId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deal_id: string | null }>('select deal_id from customer_activities where id = $1', [activityId])
    return result.rows[0]?.deal_id ?? null
  })
}

async function listIds(request: APIRequestContext, token: string, pathWithQuery: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', pathWithQuery, { token })
  expect(response.status(), `GET ${pathWithQuery} returned ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ItemPage>(response)
  return (body?.items ?? []).map((item) => String(item.id))
}

async function expectBridgedRecordsFollowSurvivor(
  request: APIRequestContext,
  token: string,
  activityId: string,
  survivorId: string,
  sourceId: string,
  drainWorker: boolean,
): Promise<number> {
  let processedJobs = 0
  await expect.poll(async () => {
    if (drainWorker) processedJobs += await drainIntegrationQueue(MERGE_EFFECTS_QUEUE, { appRoot: APP_ROOT })
    return {
      activityProjection: await readProjectionDealId('customers:customer_activity', activityId),
      interactionProjection: await readProjectionDealId('customers:customer_interaction', activityId),
    }
  }, {
    message: 'both the legacy activity and the shared-id interaction projections must point at the survivor',
    timeout: 60_000,
    intervals: [500, 1_000, 2_000],
  }).toEqual({ activityProjection: survivorId, interactionProjection: survivorId })

  expect(await readLegacyActivityDealId(activityId), 'the legacy activity row must reference the survivor').toBe(survivorId)
  expect(await listIds(request, token, `${ACTIVITIES_PATH}?dealId=${survivorId}&pageSize=100`)).toContain(activityId)
  expect(await listIds(request, token, `${ACTIVITIES_PATH}?dealId=${sourceId}&pageSize=100`)).toEqual([])
  expect(await listIds(request, token, `${INTERACTIONS_PATH}?dealId=${survivorId}&limit=100`)).toContain(activityId)
  expect(await listIds(request, token, `${INTERACTIONS_PATH}?dealId=${sourceId}&limit=100`)).toEqual([])
  return processedJobs
}

async function createBridgedFixture(request: APIRequestContext, fixture: Fixture, stamp: string) {
  const companyId = await createCompanyFixture(request, fixture.token, `QA bridge merge company ${stamp}`)
  fixture.companyId = companyId
  const survivorId = await createDealFixture(request, fixture.token, { title: `QA bridge survivor ${stamp}` })
  fixture.dealIds.add(survivorId)
  const sourceId = await createDealFixture(request, fixture.token, { title: `QA bridge source ${stamp}` })
  fixture.dealIds.add(sourceId)
  const activityId = await insertLegacyActivity(fixture.token, companyId, sourceId, stamp)
  fixture.activityId = activityId
  await bridgeLegacyActivity(request, fixture.token, activityId)
  return { companyId, survivorId, sourceId, activityId }
}

async function cleanupFixture(request: APIRequestContext, fixture: Fixture, bodyPassed: boolean): Promise<void> {
  const { token } = fixture
  for (const id of fixture.commentIds) await deleteEntityIfExists(request, token, COMMENTS_PATH, id)
  if (fixture.activityId) {
    const activityId = fixture.activityId
    await deleteEntityIfExists(request, token, INTERACTIONS_PATH, activityId)
    await withClient(async (client) => {
      await client.query('delete from customer_activities where id = $1', [activityId])
      await client.query(
        `delete from entity_indexes where entity_id = $1 and entity_type in ('customers:customer_activity', 'customers:customer_interaction')`,
        [activityId],
      )
    }).catch((error: unknown) => {
      const description = `legacy activity ${activityId}: ${error instanceof Error ? error.message : String(error)}`
      test.info().annotations.push({ type: 'cleanup-failures', description })
      if (bodyPassed) throw new Error(`Fixture cleanup failed: ${description}`)
    })
  }
  for (const id of fixture.dealIds) await deleteEntityIfExists(request, token, DEALS_PATH, id)
  if (fixture.companyId) await deleteEntityIfExists(request, token, '/api/customers/companies', fixture.companyId)
}

test.describe('TC-CRM-DEAL-MERGE-BRIDGE: merging a Deal with a bridged legacy activity', () => {
  test('inline effects update both the legacy activity and its shared-id interaction', async ({ request }) => {
    test.setTimeout(120_000)
    const fixture: Fixture = { token: await getAuthToken(request, 'admin'), companyId: null, dealIds: new Set(), activityId: null, commentIds: [] }
    const stamp = randomUUID().slice(0, 8)
    let bodyPassed = false
    try {
      const { survivorId, sourceId, activityId } = await createBridgedFixture(request, fixture, stamp)

      await mergeDeals(request, fixture.token, survivorId, sourceId, `QA bridge merged ${stamp}`)
      fixture.dealIds.delete(sourceId)

      await expectBridgedRecordsFollowSurvivor(request, fixture.token, activityId, survivorId, sourceId, false)
      bodyPassed = true
    } finally {
      await cleanupFixture(request, fixture, bodyPassed)
    }
  })

  test('effects handed to the merge-effects worker update both the legacy activity and its shared-id interaction', async ({ request }) => {
    test.slow()
    test.setTimeout(240_000)
    const fixture: Fixture = { token: await getAuthToken(request, 'admin'), companyId: null, dealIds: new Set(), activityId: null, commentIds: [] }
    const stamp = randomUUID().slice(0, 8)
    let bodyPassed = false
    try {
      const { companyId, survivorId, sourceId, activityId } = await createBridgedFixture(request, fixture, stamp)
      for (let index = 0; index < WORKER_PATH_COMMENT_COUNT; index += 1) {
        const response = await apiRequest(request, 'POST', COMMENTS_PATH, {
          token: fixture.token,
          data: { entityId: companyId, dealId: sourceId, body: `QA bridge comment ${stamp} #${index}` },
        })
        expect(response.ok(), `POST ${COMMENTS_PATH} returned ${response.status()}`).toBeTruthy()
        fixture.commentIds.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'comment id'))
      }

      await mergeDeals(request, fixture.token, survivorId, sourceId, `QA bridge worker merged ${stamp}`)
      fixture.dealIds.delete(sourceId)

      const processedJobs = await expectBridgedRecordsFollowSurvivor(request, fixture.token, activityId, survivorId, sourceId, true)
      test.info().annotations.push({
        type: 'deal-merge-effects-path',
        description: processedJobs > 0 ? `worker (${processedJobs} job(s) drained)` : 'inline (no merge-effects job was queued in this environment)',
      })
      if (process.env.OM_MANAGED_QUEUE_WORKERS?.split(',').includes(MERGE_EFFECTS_QUEUE)) {
        expect(processedJobs, 'the managed merge-effects worker must process the queued job').toBeGreaterThan(0)
      }
      await expect.poll(
        () => listIds(request, fixture.token, `${COMMENTS_PATH}?entityId=${companyId}&dealId=${survivorId}&pageSize=100`),
        { message: 'every moved comment must be listed under the survivor', timeout: 30_000 },
      ).toEqual(expect.arrayContaining(fixture.commentIds))
      bodyPassed = true
    } finally {
      await cleanupFixture(request, fixture, bodyPassed)
    }
  })
})
