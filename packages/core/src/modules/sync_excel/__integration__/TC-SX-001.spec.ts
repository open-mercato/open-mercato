import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import '@open-mercato/core/modules/customers/commands/index'
import type { BootstrapData } from '@open-mercato/shared/lib/bootstrap'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

type JsonRecord = Record<string, unknown>
type SyncExcelUploadPreview = JsonRecord & {
  uploadId: string
  entityType: string
  headers: string[]
  sampleRows: JsonRecord[]
  totalRows: number
  suggestedMapping: JsonRecord & {
    fields: JsonRecord[]
  }
}

type SyncRunSummary = {
  status: string
  createdCount: number
  updatedCount: number
  skippedCount: number
  failedCount: number
}

type IntegrationLogEntry = {
  message: string
  level: string
  runId: string | null
  payload: JsonRecord | null
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const TEST_APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
const APP_ROOT = TEST_APP_ROOT
  ? path.resolve(TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')
const APP_QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
const ENTITY_TYPE = 'customers.person'
const INTEGRATION_ID = 'sync_excel'
const PERSON_PROFILE_ENTITY_ID = 'customers:customer_person_profile'
const DATA_SYNC_IMPORT_QUEUE = 'data-sync-import'

let bootstrapDataPromise: Promise<BootstrapData> | null = null

if (!TEST_APP_ROOT) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = APP_QUEUE_BASE_DIR
}

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function getBootstrapData(): Promise<BootstrapData> {
  if (!bootstrapDataPromise) {
    bootstrapDataPromise = bootstrapFromAppRoot(APP_ROOT)
  }
  return bootstrapDataPromise
}

async function drainQueue(queueName: string): Promise<number> {
  const data = await getBootstrapData()
  const worker = data.modules
    .flatMap((module) => module.workers ?? [])
    .find((entry) => entry.queue === queueName)
  if (!worker) return 0

  const container = await createRequestContainer()
  const queue = createQueue(queueName, 'local', { baseDir: APP_QUEUE_BASE_DIR, concurrency: 1 })
  const resolve = <T = unknown>(name: string): T => container.resolve(name) as T

  try {
    let processedJobs = 0
    while (true) {
      const result = await queue.process(
        async (job, ctx) => {
          await Promise.resolve(worker.handler(job, { ...ctx, resolve }))
        },
        { limit: 100 },
      )
      const handled = result.processed + result.failed
      processedJobs += handled
      if (handled === 0) return processedJobs
    }
  } finally {
    await queue.close()
  }
}

async function drainDataSyncImportQueue(): Promise<void> {
  await drainQueue(DATA_SYNC_IMPORT_QUEUE)
}

async function waitForCompletedRun(
  request: APIRequestContext,
  token: string,
  runId: string,
): Promise<void> {
  await expect.poll(async () => {
    const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(runId)}`, { token })
    expect(runResponse.status()).toBe(200)
    const runBody = await readJson(runResponse)
    const status = String(runBody.status ?? '')
    if (status !== 'completed') {
      await drainDataSyncImportQueue()
    }
    return status
  }, { timeout: 30_000, intervals: [250, 500, 1_000, 2_000] }).toBe('completed')
}

function asRunSummary(value: JsonRecord): SyncRunSummary {
  return {
    status: String(value.status ?? ''),
    createdCount: Number(value.createdCount ?? 0),
    updatedCount: Number(value.updatedCount ?? 0),
    skippedCount: Number(value.skippedCount ?? 0),
    failedCount: Number(value.failedCount ?? 0),
  }
}

function asUploadPreview(value: JsonRecord): SyncExcelUploadPreview {
  return {
    ...value,
    uploadId: String(value.uploadId ?? ''),
    entityType: String(value.entityType ?? ''),
    headers: Array.isArray(value.headers) ? value.headers.map((header) => String(header)) : [],
    sampleRows: Array.isArray(value.sampleRows)
      ? value.sampleRows.filter((row): row is JsonRecord => typeof row === 'object' && row !== null)
      : [],
    totalRows: Number(value.totalRows ?? 0),
    suggestedMapping:
      value.suggestedMapping && typeof value.suggestedMapping === 'object'
        ? {
            ...(value.suggestedMapping as JsonRecord),
            fields: Array.isArray((value.suggestedMapping as JsonRecord).fields)
              ? ((value.suggestedMapping as JsonRecord).fields as unknown[]).filter(
                  (field): field is JsonRecord => typeof field === 'object' && field !== null,
                )
              : [],
          }
        : { fields: [] },
  }
}

function buildMultipartCsv(fileName: string, csv: string) {
  return {
    entityType: ENTITY_TYPE,
    file: {
      name: fileName,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    },
  }
}

function decodeTokenScope(token: string): { tenantId: string; orgId: string } {
  const [, payload] = token.split('.')
  if (!payload) throw new Error('Auth token is missing a JWT payload')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JsonRecord
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : ''
  const orgId = typeof claims.orgId === 'string' ? claims.orgId : ''
  if (!tenantId || !orgId) throw new Error('Auth token is missing tenantId/orgId claims')
  return { tenantId, orgId }
}

function syncExcelHeaders(token: string, selectedOrgId?: string): Record<string, string> {
  const scope = decodeTokenScope(token)
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `om_selected_tenant=${scope.tenantId}; om_selected_org=${selectedOrgId ?? scope.orgId}`,
  }
}

function withFieldMapping(
  mapping: SyncExcelUploadPreview['suggestedMapping'],
  input: {
    externalField: string
    localField: string
    mappingKind?: string
  },
) {
  const fields = [
    {
      externalField: input.externalField,
      localField: input.localField,
      mappingKind: input.mappingKind ?? 'core',
    },
  ]
  const remainingFields = mapping.fields.filter((field) => field.externalField !== input.externalField && field.localField !== input.localField)

  const unmappedColumns = Array.isArray(mapping.unmappedColumns)
    ? (mapping.unmappedColumns as unknown[]).filter(
        (column): column is string => typeof column === 'string' && column !== input.externalField,
      )
    : []

  return {
    ...mapping,
    fields: [...remainingFields, ...fields],
    unmappedColumns,
  }
}

function withCustomFieldMapping(
  mapping: SyncExcelUploadPreview['suggestedMapping'],
  input: {
    externalField: string
    customFieldKey: string
  },
) {
  return withFieldMapping(mapping, {
    externalField: input.externalField,
    localField: `cf:${input.customFieldKey}`,
    mappingKind: 'custom_field',
  })
}

function readCustomFieldValue(customFields: unknown, key: string): unknown {
  if (!customFields || typeof customFields !== 'object') return undefined
  const record = customFields as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  return record[`cf_${key}`]
}

function findPrimaryAddress(value: unknown): JsonRecord | null {
  if (!Array.isArray(value)) return null
  const address = value.find((item) => typeof item === 'object' && item !== null && (item as JsonRecord).isPrimary === true)
  return address && typeof address === 'object' ? address as JsonRecord : null
}

function expectAddressPostalCode(address: JsonRecord | null, expected: string): void {
  expect(String(address?.postalCode ?? '')).toBe(expected)
}

async function uploadCsv(
  request: APIRequestContext,
  token: string,
  fileName: string,
  csv: string,
): Promise<JsonRecord> {
  const response = await request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
    method: 'POST',
    headers: syncExcelHeaders(token),
    multipart: buildMultipartCsv(fileName, csv),
  })
  expect(response.status()).toBe(200)
  return readJson(response)
}

async function previewUpload(
  request: APIRequestContext,
  token: string,
  uploadId: string,
): Promise<APIResponse> {
  return request.get(`${BASE_URL}/api/sync_excel/preview?uploadId=${encodeURIComponent(uploadId)}&entityType=${encodeURIComponent(ENTITY_TYPE)}`, {
    headers: syncExcelHeaders(token),
  })
}

async function startSyncExcelImport(
  request: APIRequestContext,
  token: string,
  data: JsonRecord,
): Promise<APIResponse> {
  return request.fetch(`${BASE_URL}/api/sync_excel/import`, {
    method: 'POST',
    headers: {
      ...syncExcelHeaders(token),
      'Content-Type': 'application/json',
    },
    data,
  })
}

async function listSyncExcelMappings(
  request: APIRequestContext,
  token: string,
): Promise<Array<{ id: string; mapping: Record<string, unknown> }>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/data_sync/mappings?integrationId=${encodeURIComponent(INTEGRATION_ID)}&entityType=${encodeURIComponent(ENTITY_TYPE)}&pageSize=20`,
    { token },
  )

  if (response.status() === 404) return []
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items
    .map((item) => ({
      id: String(item.id ?? ''),
      mapping: item.mapping && typeof item.mapping === 'object' ? item.mapping as Record<string, unknown> : {},
    }))
    .filter((item) => item.id.length > 0)
}

async function restoreSyncExcelMapping(
  request: APIRequestContext,
  token: string,
  previous: { id: string; mapping: Record<string, unknown> } | null,
): Promise<void> {
  const current = await listSyncExcelMappings(request, token)
  const currentItem = current[0] ?? null

  if (previous) {
    if (currentItem?.id === previous.id) {
      await apiRequest(request, 'PUT', `/api/data_sync/mappings/${encodeURIComponent(previous.id)}`, {
        token,
        data: { mapping: previous.mapping },
      })
      return
    }

    const createOrUpsert = await apiRequest(request, 'POST', '/api/data_sync/mappings', {
      token,
      data: {
        integrationId: INTEGRATION_ID,
        entityType: ENTITY_TYPE,
        mapping: previous.mapping,
      },
    })
    expect([200, 201]).toContain(createOrUpsert.status())
    return
  }

  if (currentItem) {
    const deleteResponse = await apiRequest(request, 'DELETE', `/api/data_sync/mappings/${encodeURIComponent(currentItem.id)}`, {
      token,
    })
    expect(deleteResponse.status()).toBe(200)
  }
}

async function listIntegrationLogs(
  request: APIRequestContext,
  token: string,
  input?: {
    runId?: string
  },
): Promise<IntegrationLogEntry[]> {
  const params = new URLSearchParams({
    integrationId: INTEGRATION_ID,
    page: '1',
    pageSize: '50',
  })
  if (input?.runId) params.set('runId', input.runId)

  const response = await apiRequest(request, 'GET', `/api/integrations/logs?${params.toString()}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? body.items as JsonRecord[] : []
  return items.map((item) => ({
    message: String(item.message ?? ''),
    level: String(item.level ?? ''),
    runId: typeof item.runId === 'string' ? item.runId : null,
    payload: item.payload && typeof item.payload === 'object' ? item.payload as JsonRecord : null,
  }))
}

async function readIntegrationDetail(
  request: APIRequestContext,
  token: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${encodeURIComponent(INTEGRATION_ID)}`, { token })
  expect(response.status()).toBe(200)
  return readJson(response)
}

async function findPersonByEmail(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<JsonRecord | null> {
  const normalizedEmail = email.trim().toLowerCase()

  for (let page = 1; page <= 4; page += 1) {
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/people?page=${page}&pageSize=50&sortField=createdAt&sortDir=desc`,
      { token },
    )
    expect(response.status()).toBe(200)
    const body = await readJson(response)
    const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
    const matching = items.find((item) => {
      const primaryEmail =
        typeof item.primary_email === 'string'
          ? item.primary_email.trim().toLowerCase()
          : typeof item.primaryEmail === 'string'
            ? item.primaryEmail.trim().toLowerCase()
            : ''
      return primaryEmail === normalizedEmail
    })
    if (matching) return matching
    if (items.length < 50) break
  }

  return null
}

async function createCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  input: {
    entityId: string
    key: string
    label: string
  },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: {
      entityId: input.entityId,
      key: input.key,
      kind: 'text',
      configJson: {
        label: input.label,
      },
    },
  })
  expect(response.status()).toBe(200)
}

async function deleteCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  input: {
    entityId: string
    key: string
  },
): Promise<void> {
  const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: {
      entityId: input.entityId,
      key: input.key,
    },
  })
  expect([200, 404]).toContain(response.status())
}

test.describe('TC-SX-001: sync_excel upload preview and import APIs', () => {
  test('authorization is enforced for upload, preview, and import endpoints', async ({ request }) => {
    const noTokenUpload = await request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
      method: 'POST',
      multipart: buildMultipartCsv('unauthorized.csv', 'Record Id,Lead Name\nunauth-1,Unauthorized Example\n'),
    })
    expect(noTokenUpload.status()).toBe(401)

    const noTokenPreview = await request.get(`${BASE_URL}/api/sync_excel/preview?uploadId=00000000-0000-0000-0000-000000000000&entityType=${encodeURIComponent(ENTITY_TYPE)}`)
    expect(noTokenPreview.status()).toBe(401)

    const noTokenImport = await request.post(`${BASE_URL}/api/sync_excel/import`, {
      data: {
        uploadId: '00000000-0000-0000-0000-000000000000',
        entityType: ENTITY_TYPE,
        mapping: {
          entityType: ENTITY_TYPE,
          matchStrategy: 'externalId',
          matchField: 'person.externalId',
          fields: [],
          unmappedColumns: [],
        },
      },
    })
    expect(noTokenImport.status()).toBe(401)

    const employeeToken = await getAuthToken(request, 'employee')
    const forbiddenUpload = await request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${employeeToken}`,
      },
      multipart: buildMultipartCsv('forbidden.csv', 'Record Id,Lead Name\nforbidden-1,Forbidden Example\n'),
    })
    expect(forbiddenUpload.status()).toBe(403)

    const adminToken = await getAuthToken(request, 'admin')
    const allOrganizationsUpload = await request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
      method: 'POST',
      headers: syncExcelHeaders(adminToken, '__all__'),
      multipart: buildMultipartCsv('all-orgs.csv', 'Record Id,Lead Name\nall-1,All Organizations Example\n'),
    })
    expect(allOrganizationsUpload.status()).toBe(422)
    await expect(readJson(allOrganizationsUpload)).resolves.toMatchObject({
      error: 'Select a concrete organization before importing CSV.',
    })

    const allOrganizationsPreview = await request.get(`${BASE_URL}/api/sync_excel/preview?uploadId=00000000-0000-0000-0000-000000000000&entityType=${encodeURIComponent(ENTITY_TYPE)}`, {
      headers: syncExcelHeaders(adminToken, '__all__'),
    })
    expect(allOrganizationsPreview.status()).toBe(422)

    const allOrganizationsImport = await request.fetch(`${BASE_URL}/api/sync_excel/import`, {
      method: 'POST',
      headers: {
        ...syncExcelHeaders(adminToken, '__all__'),
        'Content-Type': 'application/json',
      },
      data: {
        uploadId: '00000000-0000-0000-0000-000000000000',
        entityType: ENTITY_TYPE,
        mapping: {
          entityType: ENTITY_TYPE,
          matchStrategy: 'externalId',
          matchField: 'person.externalId',
          fields: [],
          unmappedColumns: [],
        },
      },
    })
    expect(allOrganizationsImport.status()).toBe(422)
  })

  test('upload preview and import create then update a customer person', async ({ request }) => {
    test.setTimeout(60_000)

    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const email = `sync-excel-${timestamp}@example.com`
    const externalId = `sync-excel-${timestamp}`
    const customFieldKey = `sync_excel_color_${timestamp}`
    const customFieldLabel = 'Favorite Color'
    const fileName = `sync-excel-${timestamp}.csv`
    let createdPersonId: string | null = null
    let createdAddressId: string | null = null
    let firstRunId: string | null = null
    let secondRunId: string | null = null
    let thirdRunId: string | null = null
    const previousMapping = (await listSyncExcelMappings(request, token))[0] ?? null

    const initialCsv = [
      `Record Id,First Name,Last Name,Lead Name,Email,Title,Lead Status,Lead Source,Description,Address Line 1,City,Postal Code,${customFieldLabel}`,
      `${externalId},Ada,Lovelace,Ada Lovelace,${email},Founder,Open,Import Test,Initial row,123 Main Street,Austin,78701,Blue`,
    ].join('\n')

    const updatedCsv = [
      `Record Id,First Name,Last Name,Lead Name,Email,Title,Lead Status,Lead Source,Description,Address Line 1,City,Postal Code,${customFieldLabel}`,
      `${externalId},Ada,Lovelace,Ada Byron,${email},Principal Engineer,Qualified,Import Test,Updated row,500 Updated Avenue,Dallas,75201,Purple`,
    ].join('\n')

    const recreatedAddressCsv = [
      `Record Id,First Name,Last Name,Lead Name,Email,Title,Lead Status,Lead Source,Description,Address Line 1,City,Postal Code,${customFieldLabel}`,
      `${externalId},Ada,Lovelace,Ada Byron,${email},Principal Engineer,Qualified,Import Test,Address recreated,900 Recreated Road,Houston,77002,Gold`,
    ].join('\n')

    try {
      await createCustomFieldDefinition(request, token, {
        entityId: PERSON_PROFILE_ENTITY_ID,
        key: customFieldKey,
        label: customFieldLabel,
      })

      const uploadPreview = asUploadPreview(await uploadCsv(request, token, fileName, initialCsv))
      expect(uploadPreview.entityType).toBe(ENTITY_TYPE)
      expect(uploadPreview.totalRows).toBe(1)
      expect(uploadPreview.headers).toEqual([
        'Record Id',
        'First Name',
        'Last Name',
        'Lead Name',
        'Email',
        'Title',
        'Lead Status',
        'Lead Source',
        'Description',
        'Address Line 1',
        'City',
        'Postal Code',
        customFieldLabel,
      ])
      expect(Array.isArray(uploadPreview.sampleRows)).toBe(true)
      expect(uploadPreview.sampleRows?.[0]).toMatchObject({
        'Record Id': externalId,
        'Lead Name': 'Ada Lovelace',
        Email: email,
      })

      const suggestedFields = uploadPreview.suggestedMapping.fields
      expect(suggestedFields.some((field) => field.externalField === 'Record Id' && field.localField === 'person.externalId')).toBe(true)
      expect(suggestedFields.some((field) => field.externalField === 'Email' && field.localField === 'person.primaryEmail')).toBe(true)
      expect(suggestedFields.some((field) => field.externalField === 'Address Line 1' && field.localField === 'address.addressLine1')).toBe(true)
      expect(suggestedFields.some((field) => field.externalField === 'Postal Code' && field.localField === 'address.postalCode')).toBe(true)
      const importMapping = withFieldMapping(withFieldMapping(withCustomFieldMapping(uploadPreview.suggestedMapping, {
        externalField: customFieldLabel,
        customFieldKey,
      }), {
        externalField: 'Address Line 1',
        localField: 'address.addressLine1',
      }), {
        externalField: 'Postal Code',
        localField: 'address.postalCode',
      })

      const previewAgain = await previewUpload(request, token, String(uploadPreview.uploadId))
      expect(previewAgain.status()).toBe(200)

      const importStart = await startSyncExcelImport(request, token, {
        uploadId: uploadPreview.uploadId,
        entityType: ENTITY_TYPE,
        mapping: importMapping,
      })
      expect(importStart.status()).toBe(201)
      const importStartBody = await readJson(importStart)
      firstRunId = String(importStartBody.runId)
      expect(firstRunId).toMatch(/^[0-9a-f-]{36}$/i)
      await waitForCompletedRun(request, token, firstRunId)

      const firstRunResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(firstRunId)}`, { token })
      expect(firstRunResponse.status()).toBe(200)
      expect(asRunSummary(await readJson(firstRunResponse))).toMatchObject({
        status: 'completed',
        createdCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      })

      const firstRunLogs = await listIntegrationLogs(request, token, { runId: firstRunId })
      expect(firstRunLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          message: 'Sync run started',
          level: 'info',
          runId: firstRunId,
          payload: expect.objectContaining({
            operationalStatus: 'running',
          }),
        }),
        expect.objectContaining({
          message: 'Sync run completed',
          level: 'info',
          runId: firstRunId,
          payload: expect.objectContaining({
            operationalStatus: 'completed',
          }),
        }),
      ]))

      const integrationDetailAfterFirstRun = await readIntegrationDetail(request, token)
      expect(integrationDetailAfterFirstRun.state).toMatchObject({
        lastHealthStatus: 'healthy',
      })
      expect(typeof (integrationDetailAfterFirstRun.state as JsonRecord).lastHealthCheckedAt).toBe('string')

      const createdPerson = await findPersonByEmail(request, token, email)
      expect(createdPerson).not.toBeNull()
      createdPersonId = String(createdPerson?.id ?? '')
      expect(createdPersonId).toMatch(/^[0-9a-f-]{36}$/i)

      const createdDetailResponse = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(createdPersonId)}?include=addresses`, { token })
      expect(createdDetailResponse.status()).toBe(200)
      const createdDetailBody = await readJson(createdDetailResponse)
      expect(createdDetailBody.person).toMatchObject({
        displayName: 'Ada Lovelace',
        primaryEmail: email,
        status: 'Open',
        source: 'Import Test',
        description: 'Initial row',
      })
      expect(createdDetailBody.profile).toMatchObject({
        firstName: 'Ada',
        lastName: 'Lovelace',
        jobTitle: 'Founder',
      })
      const createdPrimaryAddress = findPrimaryAddress(createdDetailBody.addresses)
      expect(createdPrimaryAddress).toMatchObject({
        addressLine1: '123 Main Street',
        city: 'Austin',
        isPrimary: true,
      })
      expectAddressPostalCode(createdPrimaryAddress, '78701')
      createdAddressId = String(createdPrimaryAddress?.id ?? '')
      expect(createdAddressId).toMatch(/^[0-9a-f-]{36}$/i)

      const secondUpload = asUploadPreview(await uploadCsv(request, token, `updated-${fileName}`, updatedCsv))
      const secondImportMapping = withFieldMapping(withFieldMapping(withCustomFieldMapping(secondUpload.suggestedMapping, {
        externalField: customFieldLabel,
        customFieldKey,
      }), {
        externalField: 'Address Line 1',
        localField: 'address.addressLine1',
      }), {
        externalField: 'Postal Code',
        localField: 'address.postalCode',
      })
      const secondImportStart = await startSyncExcelImport(request, token, {
        uploadId: secondUpload.uploadId,
        entityType: ENTITY_TYPE,
        mapping: secondImportMapping,
      })
      expect(secondImportStart.status()).toBe(201)
      const secondImportBody = await readJson(secondImportStart)
      secondRunId = String(secondImportBody.runId)
      await waitForCompletedRun(request, token, secondRunId)

      const secondRunResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(secondRunId)}`, { token })
      expect(secondRunResponse.status()).toBe(200)
      expect(asRunSummary(await readJson(secondRunResponse))).toMatchObject({
        status: 'completed',
        createdCount: 0,
        updatedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      })

      const updatedDetailResponse = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(createdPersonId)}?include=addresses`, { token })
      expect(updatedDetailResponse.status()).toBe(200)
      const updatedDetailBody = await readJson(updatedDetailResponse)
      expect(updatedDetailBody.person).toMatchObject({
        displayName: 'Ada Byron',
        primaryEmail: email,
        status: 'Qualified',
        description: 'Updated row',
      })
      expect(updatedDetailBody.profile).toMatchObject({
        firstName: 'Ada',
        lastName: 'Lovelace',
        jobTitle: 'Principal Engineer',
      })
      expect(readCustomFieldValue(updatedDetailBody.customFields, customFieldKey)).toBe('Purple')
      const updatedPrimaryAddress = findPrimaryAddress(updatedDetailBody.addresses)
      expect(updatedPrimaryAddress).toMatchObject({
        id: createdAddressId,
        addressLine1: '500 Updated Avenue',
        city: 'Dallas',
        isPrimary: true,
      })
      expectAddressPostalCode(updatedPrimaryAddress, '75201')

      const deleteAddressResponse = await apiRequest(request, 'DELETE', `/api/customers/addresses?id=${encodeURIComponent(createdAddressId)}`, { token })
      expect(deleteAddressResponse.status()).toBe(200)

      const thirdUpload = asUploadPreview(await uploadCsv(request, token, `recreated-${fileName}`, recreatedAddressCsv))
      const thirdImportMapping = withFieldMapping(withFieldMapping(withCustomFieldMapping(thirdUpload.suggestedMapping, {
        externalField: customFieldLabel,
        customFieldKey,
      }), {
        externalField: 'Address Line 1',
        localField: 'address.addressLine1',
      }), {
        externalField: 'Postal Code',
        localField: 'address.postalCode',
      })
      const thirdImportStart = await startSyncExcelImport(request, token, {
        uploadId: thirdUpload.uploadId,
        entityType: ENTITY_TYPE,
        mapping: thirdImportMapping,
      })
      expect(thirdImportStart.status()).toBe(201)
      const thirdImportBody = await readJson(thirdImportStart)
      thirdRunId = String(thirdImportBody.runId)
      await waitForCompletedRun(request, token, thirdRunId)

      const thirdRunResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(thirdRunId)}`, { token })
      expect(thirdRunResponse.status()).toBe(200)
      expect(asRunSummary(await readJson(thirdRunResponse))).toMatchObject({
        status: 'completed',
        createdCount: 0,
        updatedCount: 1,
        skippedCount: 0,
        failedCount: 0,
      })

      const recreatedDetailResponse = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(createdPersonId)}?include=addresses`, { token })
      expect(recreatedDetailResponse.status()).toBe(200)
      const recreatedDetailBody = await readJson(recreatedDetailResponse)
      const recreatedPrimaryAddress = findPrimaryAddress(recreatedDetailBody.addresses)
      expect(recreatedPrimaryAddress).toMatchObject({
        addressLine1: '900 Recreated Road',
        city: 'Houston',
        isPrimary: true,
      })
      expectAddressPostalCode(recreatedPrimaryAddress, '77002')
      expect(String(recreatedPrimaryAddress?.id ?? '')).not.toBe(createdAddressId)
      expect(readCustomFieldValue(recreatedDetailBody.customFields, customFieldKey)).toBe('Gold')
    } finally {
      if (firstRunId) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(firstRunId)}/cancel`, { token }).catch(() => undefined)
      }
      if (secondRunId) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(secondRunId)}/cancel`, { token }).catch(() => undefined)
      }
      if (thirdRunId) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(thirdRunId)}/cancel`, { token }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', createdPersonId)
      await deleteCustomFieldDefinition(request, token, {
        entityId: PERSON_PROFILE_ENTITY_ID,
        key: customFieldKey,
      })
      await restoreSyncExcelMapping(request, token, previousMapping)
    }
  })
})
