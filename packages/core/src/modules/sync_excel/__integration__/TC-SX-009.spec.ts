import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  ENTITY_TYPE,
  INTEGRATION_ID,
  csvFilePart,
  decodeTokenScope,
  readJson,
  startImport,
  uploadMultipart,
  type JsonRecord,
} from './helpers/syncExcel'

const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')

// Match TC-SX-001: outside the integration runner, read DATABASE_URL and the queue dir from the app.
if (!TEST_APP_ROOT) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

type Scope = { tenantId: string; orgId: string }

type MappingRow = {
  id: string
  internal_entity_id: string
  deleted_at: Date | null
}

type RunCounts = {
  status: string
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
}

type StoredMapping = { id: string; mapping: Record<string, unknown> }

const IDENTITY_FIELDS = [
  { externalField: 'Record Id', localField: 'person.externalId', mappingKind: 'external_id', dedupeRole: 'primary' },
  { externalField: 'Lead Name', localField: 'person.displayName', mappingKind: 'core' },
]

function buildMapping(extraFields: Array<Record<string, string>> = []): JsonRecord {
  return {
    entityType: ENTITY_TYPE,
    matchStrategy: 'externalId',
    matchField: 'person.externalId',
    fields: [...IDENTITY_FIELDS, ...extraFields],
    unmappedColumns: [],
  }
}

async function cancelActiveRuns(db: Client, scope: Scope): Promise<void> {
  await db.query(
    `update sync_runs set status = 'cancelled', updated_at = now()
     where integration_id = $1 and entity_type = $2 and direction = 'import'
       and status in ('pending', 'running') and organization_id = $3 and tenant_id = $4 and deleted_at is null`,
    [INTEGRATION_ID, ENTITY_TYPE, scope.orgId, scope.tenantId],
  )
}

async function readMappingRows(db: Client, externalId: string, scope: Scope): Promise<MappingRow[]> {
  const result = await db.query<MappingRow>(
    `select id, internal_entity_id, deleted_at
     from sync_external_id_mappings
     where integration_id = $1 and internal_entity_type = $2 and external_id = $3
       and organization_id = $4 and tenant_id = $5
     order by created_at asc`,
    [INTEGRATION_ID, ENTITY_TYPE, externalId, scope.orgId, scope.tenantId],
  )
  return result.rows
}

async function personExists(db: Client, personId: string): Promise<boolean> {
  const result = await db.query(
    `select 1 from customer_entities where id = $1 and kind = 'person' and deleted_at is null`,
    [personId],
  )
  return result.rows.length === 1
}

async function countAddresses(db: Client, personId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    'select count(*)::text as count from customer_addresses where entity_id = $1',
    [personId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function listStoredMappings(request: APIRequestContext, token: string): Promise<StoredMapping[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/data_sync/mappings?integrationId=${encodeURIComponent(INTEGRATION_ID)}&entityType=${encodeURIComponent(ENTITY_TYPE)}&pageSize=20`,
    { token },
  )
  if (response.status() !== 200) return []
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items
    .map((item) => ({
      id: String(item.id ?? ''),
      mapping: item.mapping && typeof item.mapping === 'object' ? (item.mapping as Record<string, unknown>) : {},
    }))
    .filter((item) => item.id.length > 0)
}

async function restoreStoredMapping(
  request: APIRequestContext,
  token: string,
  previous: StoredMapping | null,
): Promise<void> {
  if (previous) {
    await apiRequest(request, 'POST', '/api/data_sync/mappings', {
      token,
      data: { integrationId: INTEGRATION_ID, entityType: ENTITY_TYPE, mapping: previous.mapping },
    })
    return
  }
  const current = (await listStoredMappings(request, token))[0] ?? null
  if (current) {
    await apiRequest(request, 'DELETE', `/api/data_sync/mappings/${encodeURIComponent(current.id)}`, { token })
  }
}

async function cancelRuns(request: APIRequestContext, token: string, runIds: string[]): Promise<void> {
  for (const runId of runIds) {
    await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(runId)}/cancel`, { token }).catch(() => undefined)
  }
}

async function importCsv(
  request: APIRequestContext,
  token: string,
  input: { fileName: string; csv: string; mapping: JsonRecord; runIds: string[] },
): Promise<RunCounts> {
  const upload = await uploadMultipart(request, token, {
    entityType: ENTITY_TYPE,
    file: csvFilePart({ name: input.fileName, content: input.csv }),
  })
  expect(upload.status()).toBe(200)
  const uploadId = String((await readJson(upload)).uploadId ?? '')

  const started = await startImport(request, token, {
    uploadId,
    entityType: ENTITY_TYPE,
    mapping: input.mapping,
  })
  expect(started.status()).toBe(201)
  const runId = String((await readJson(started)).runId ?? '')
  input.runIds.push(runId)

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(runId)}`, { token })
    expect(runResponse.status()).toBe(200)
    const run = await readJson(runResponse)
    const status = String(run.status ?? '')
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
      return {
        status,
        createdCount: Number(run.createdCount ?? 0),
        updatedCount: Number(run.updatedCount ?? 0),
        skippedCount: Number(run.skippedCount ?? 0),
        failedCount: Number(run.failedCount ?? 0),
      }
    }
    await drainIntegrationQueue('data-sync-import', { appRoot: APP_ROOT })
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for sync run ${runId}`)
}

/**
 * TC-SX-009: a CSV re-import converges on one live person per external id.
 *
 * The external-id mapping outlives the person it points at (`customers.people.delete` is a hard
 * delete and does not touch `sync_external_id_mappings`), and a row can fail in its address step
 * after its person was already committed. Both used to leave the import unable to recover: the
 * first failed the row with "Person not found" on every later import, the second left a person
 * without a mapping. Requires `DATABASE_URL` (provided by the integration runner).
 */
test.describe('TC-SX-009: sync_excel re-import after a delete or a failed row', () => {
  test('re-importing a file after its person was deleted creates the person again, then updates it', async ({ request }) => {
    test.setTimeout(240_000)

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required for TC-SX-009')
    const db = new Client({ connectionString })
    await db.connect()

    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    const externalId = `sx-009-delete-${stamp}`
    const csv = `Record Id,Lead Name\n${externalId},Reimport Person ${stamp}\n`
    const mapping = buildMapping()
    const previousMapping = (await listStoredMappings(request, token))[0] ?? null
    const personIds = new Set<string>()
    const runIds: string[] = []

    try {
      await cancelActiveRuns(db, scope)

      const firstRun = await importCsv(request, token, { fileName: `sx-009-first-${stamp}.csv`, csv, mapping, runIds })
      expect(firstRun).toMatchObject({ status: 'completed', createdCount: 1, updatedCount: 0, failedCount: 0 })
      const mappingAfterFirstRun = await readMappingRows(db, externalId, scope)
      expect(mappingAfterFirstRun).toHaveLength(1)
      const originalPersonId = mappingAfterFirstRun[0].internal_entity_id
      personIds.add(originalPersonId)
      expect(await personExists(db, originalPersonId)).toBe(true)

      const deleted = await apiRequest(request, 'DELETE', `/api/customers/people?id=${encodeURIComponent(originalPersonId)}`, { token })
      expect(deleted.status()).toBe(200)
      expect(await personExists(db, originalPersonId)).toBe(false)
      const mappingAfterDelete = await readMappingRows(db, externalId, scope)
      expect(mappingAfterDelete).toHaveLength(1)
      expect(mappingAfterDelete[0]).toMatchObject({ internal_entity_id: originalPersonId, deleted_at: null })

      const secondRun = await importCsv(request, token, { fileName: `sx-009-second-${stamp}.csv`, csv, mapping, runIds })
      expect(secondRun).toMatchObject({ status: 'completed', createdCount: 1, updatedCount: 0, failedCount: 0 })
      const mappingAfterSecondRun = await readMappingRows(db, externalId, scope)
      expect(mappingAfterSecondRun).toHaveLength(1)
      expect(mappingAfterSecondRun[0].id).toBe(mappingAfterFirstRun[0].id)
      expect(mappingAfterSecondRun[0].deleted_at).toBeNull()
      const recreatedPersonId = mappingAfterSecondRun[0].internal_entity_id
      personIds.add(recreatedPersonId)
      expect(recreatedPersonId).not.toBe(originalPersonId)
      expect(await personExists(db, recreatedPersonId)).toBe(true)

      const detail = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(recreatedPersonId)}`, { token })
      expect(detail.status()).toBe(200)
      expect((await readJson(detail)).person).toMatchObject({ displayName: `Reimport Person ${stamp}` })

      const thirdRun = await importCsv(request, token, { fileName: `sx-009-third-${stamp}.csv`, csv, mapping, runIds })
      expect(thirdRun).toMatchObject({ status: 'completed', createdCount: 0, updatedCount: 1, failedCount: 0 })
      const mappingAfterThirdRun = await readMappingRows(db, externalId, scope)
      expect(mappingAfterThirdRun).toHaveLength(1)
      expect(mappingAfterThirdRun[0]).toMatchObject({
        id: mappingAfterFirstRun[0].id,
        internal_entity_id: recreatedPersonId,
        deleted_at: null,
      })
    } finally {
      for (const row of await readMappingRows(db, externalId, scope).catch(() => [])) {
        personIds.add(row.internal_entity_id)
      }
      for (const personId of personIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
      await restoreStoredMapping(request, token, previousMapping).catch(() => undefined)
      await cancelRuns(request, token, runIds)
      await db.end().catch(() => undefined)
    }
  })

  test('a row whose address is rejected keeps its mapping, so the corrected file updates the same person', async ({ request }) => {
    test.setTimeout(240_000)

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required for TC-SX-009')
    const db = new Client({ connectionString })
    await db.connect()

    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    const externalId = `sx-009-address-${stamp}`
    const header = 'Record Id,Lead Name,Address Line 1,Latitude'
    const rejectedCsv = `${header}\n${externalId},Address Person ${stamp},1 Polar Road,123\n`
    const correctedCsv = `${header}\n${externalId},Address Person ${stamp},1 Polar Road,12.5\n`
    const mapping = buildMapping([
      { externalField: 'Address Line 1', localField: 'address.addressLine1', mappingKind: 'core' },
      { externalField: 'Latitude', localField: 'address.latitude', mappingKind: 'core' },
    ])
    const previousMapping = (await listStoredMappings(request, token))[0] ?? null
    const personIds = new Set<string>()
    const runIds: string[] = []

    try {
      await cancelActiveRuns(db, scope)

      const rejectedRun = await importCsv(request, token, { fileName: `sx-009-rejected-${stamp}.csv`, csv: rejectedCsv, mapping, runIds })
      expect(rejectedRun).toMatchObject({ status: 'completed', createdCount: 0, updatedCount: 0, failedCount: 1 })
      const mappingAfterRejectedRun = await readMappingRows(db, externalId, scope)
      expect(mappingAfterRejectedRun).toHaveLength(1)
      const personId = mappingAfterRejectedRun[0].internal_entity_id
      personIds.add(personId)
      expect(await personExists(db, personId)).toBe(true)
      expect(await countAddresses(db, personId)).toBe(0)

      const correctedRun = await importCsv(request, token, { fileName: `sx-009-corrected-${stamp}.csv`, csv: correctedCsv, mapping, runIds })
      expect(correctedRun).toMatchObject({ status: 'completed', createdCount: 0, updatedCount: 1, failedCount: 0 })
      const mappingAfterCorrectedRun = await readMappingRows(db, externalId, scope)
      expect(mappingAfterCorrectedRun).toHaveLength(1)
      expect(mappingAfterCorrectedRun[0]).toMatchObject({
        id: mappingAfterRejectedRun[0].id,
        internal_entity_id: personId,
        deleted_at: null,
      })
      expect(await countAddresses(db, personId)).toBe(1)
    } finally {
      for (const row of await readMappingRows(db, externalId, scope).catch(() => [])) {
        personIds.add(row.internal_entity_id)
      }
      const leftovers = await apiRequest(
        request,
        'GET',
        `/api/customers/people?search=${encodeURIComponent(`Address Person ${stamp}`)}&pageSize=20`,
        { token },
      ).catch(() => null)
      if (leftovers && leftovers.status() === 200) {
        const items = (await readJson(leftovers)).items
        for (const item of Array.isArray(items) ? (items as JsonRecord[]) : []) {
          if (typeof item.id === 'string') personIds.add(item.id)
        }
      }
      for (const personId of personIds) {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
      await restoreStoredMapping(request, token, previousMapping).catch(() => undefined)
      await cancelRuns(request, token, runIds)
      await db.end().catch(() => undefined)
    }
  })
})
