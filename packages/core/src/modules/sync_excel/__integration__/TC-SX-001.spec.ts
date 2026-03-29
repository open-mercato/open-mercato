import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
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

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const ENTITY_TYPE = 'customers.person'
const INTEGRATION_ID = 'sync_excel'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
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

async function uploadCsv(
  request: APIRequestContext,
  token: string,
  fileName: string,
  csv: string,
): Promise<JsonRecord> {
  const response = await request.fetch(`${BASE_URL}/api/sync_excel/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    multipart: buildMultipartCsv(fileName, csv),
  })
  expect(response.status()).toBe(200)
  return readJson(response)
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
  })

  test('upload preview and import create then update a customer person', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const timestamp = Date.now()
    const email = `sync-excel-${timestamp}@example.com`
    const externalId = `sync-excel-${timestamp}`
    const fileName = `sync-excel-${timestamp}.csv`
    let createdPersonId: string | null = null
    let firstRunId: string | null = null
    let secondRunId: string | null = null
    const previousMapping = (await listSyncExcelMappings(request, token))[0] ?? null

    const initialCsv = [
      'Record Id,First Name,Last Name,Lead Name,Email,Title,Lead Status,Lead Source,Description',
      `${externalId},Ada,Lovelace,Ada Lovelace,${email},Founder,Open,Import Test,Initial row`,
    ].join('\n')

    const updatedCsv = [
      'Record Id,First Name,Last Name,Lead Name,Email,Title,Lead Status,Lead Source,Description',
      `${externalId},Ada,Lovelace,Ada Byron,${email},Principal Engineer,Qualified,Import Test,Updated row`,
    ].join('\n')

    try {
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

      const previewAgain = await apiRequest(
        request,
        'GET',
        `/api/sync_excel/preview?uploadId=${encodeURIComponent(String(uploadPreview.uploadId))}&entityType=${encodeURIComponent(ENTITY_TYPE)}`,
        { token },
      )
      expect(previewAgain.status()).toBe(200)

      const importStart = await apiRequest(request, 'POST', '/api/sync_excel/import', {
        token,
        data: {
          uploadId: uploadPreview.uploadId,
          entityType: ENTITY_TYPE,
          mapping: uploadPreview.suggestedMapping,
        },
      })
      expect(importStart.status()).toBe(201)
      const importStartBody = await readJson(importStart)
      firstRunId = String(importStartBody.runId)
      expect(firstRunId).toMatch(/^[0-9a-f-]{36}$/i)

      await expect.poll(async () => {
        const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(firstRunId!)}`, { token })
        expect(runResponse.status()).toBe(200)
        const runBody = await readJson(runResponse)
        return String(runBody.status ?? '')
      }, { timeout: 15_000, intervals: [500, 1_000, 2_000] }).toBe('completed')

      const createdPersonList = await apiRequest(
        request,
        'GET',
        `/api/customers/people?email=${encodeURIComponent(email)}&pageSize=10`,
        { token },
      )
      expect(createdPersonList.status()).toBe(200)
      const createdPersonListBody = await readJson(createdPersonList)
      const createdItems = Array.isArray(createdPersonListBody.items) ? createdPersonListBody.items as JsonRecord[] : []
      expect(createdItems).toHaveLength(1)
      createdPersonId = String(createdItems[0].id)

      const createdDetailResponse = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(createdPersonId)}`, { token })
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

      const secondUpload = asUploadPreview(await uploadCsv(request, token, `updated-${fileName}`, updatedCsv))
      const secondImportStart = await apiRequest(request, 'POST', '/api/sync_excel/import', {
        token,
        data: {
          uploadId: secondUpload.uploadId,
          entityType: ENTITY_TYPE,
          mapping: secondUpload.suggestedMapping,
        },
      })
      expect(secondImportStart.status()).toBe(201)
      const secondImportBody = await readJson(secondImportStart)
      secondRunId = String(secondImportBody.runId)

      await expect.poll(async () => {
        const runResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${encodeURIComponent(secondRunId!)}`, { token })
        expect(runResponse.status()).toBe(200)
        const runBody = await readJson(runResponse)
        return String(runBody.status ?? '')
      }, { timeout: 15_000, intervals: [500, 1_000, 2_000] }).toBe('completed')

      const updatedDetailResponse = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(createdPersonId)}`, { token })
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
    } finally {
      if (firstRunId) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(firstRunId)}/cancel`, { token }).catch(() => undefined)
      }
      if (secondRunId) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${encodeURIComponent(secondRunId)}/cancel`, { token }).catch(() => undefined)
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', createdPersonId)
      await restoreSyncExcelMapping(request, token, previousMapping)
    }
  })
})
