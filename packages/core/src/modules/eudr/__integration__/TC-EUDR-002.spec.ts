import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'
const REQUIRED_MISSING_FIELDS = [
  'origin_country',
  'geolocation',
  'quantity',
  'harvest_period',
  'producer',
  'documents',
]

type EvidenceSubmissionRow = {
  id: string
  supplierEntityId?: string | null
  commodity?: string | null
  originCountry?: string | null
  geolocation?: unknown
  quantityKg?: string | number | null
  harvestFrom?: string | null
  harvestTo?: string | null
  producerName?: string | null
  attachmentIds?: string[]
  status?: string | null
  completenessScore?: number
  missingFields?: string[]
  updatedAt?: string | null
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

async function readSubmissionById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<EvidenceSubmissionRow | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  )
  expect(response.status(), `GET evidence submission by id should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: EvidenceSubmissionRow[] }>(response)
  return body?.items?.[0] ?? null
}

async function deleteSubmissionIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(
    request,
    'DELETE',
    `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined)
}

/**
 * TC-EUDR-002: Evidence submissions + completeness scoring.
 *
 * Completeness is server-owned: client-provided score fields must not control
 * persisted `completenessScore`/`missingFields`.
 */
test.describe('TC-EUDR-002: Evidence submissions + completeness scoring', () => {
  test('computes completeness, decrypts detail fields, and cleans up submissions', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let supplierId: string | null = null
    let submissionId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-002 Supplier ${stamp}`)

      const rejectedResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
          completenessScore: 55,
        },
      })
      expect(rejectedResponse.status(), 'client-sent completenessScore must be rejected as server-computed').toBe(400)
      const rejectedBody = await readJsonSafe<{ details?: Array<{ message?: string }> }>(rejectedResponse)
      expect(JSON.stringify(rejectedBody)).toContain('eudr.errors.serverComputedField')

      const createResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
        },
      })
      expect(createResponse.status(), `create minimal submission failed: ${createResponse.status()}`).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      submissionId = expectId(created?.id, 'Evidence submission create response should include id')

      const minimal = await readSubmissionById(request, token, submissionId)
      expect(minimal, 'created evidence submission should be readable by id').toBeTruthy()
      expect(minimal?.status).toBe('draft')
      expect(minimal?.completenessScore).toBe(0)
      expect(minimal?.missingFields).toEqual(REQUIRED_MISSING_FIELDS)

      const producerName = `TC-EUDR-002 Producer ${stamp}`
      const harvestFrom = isoDaysAgo(90)
      const harvestTo = isoDaysAgo(30)
      const attachmentId = randomUUID()
      const updateResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          id: submissionId,
          originCountry: 'br',
          geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
          quantityKg: 1500,
          harvestFrom,
          harvestTo,
          producerName,
          attachmentIds: [attachmentId],
        },
      })
      expect(updateResponse.status(), `update complete submission failed: ${updateResponse.status()}`).toBe(200)
      const updated = await readJsonSafe<{ ok?: boolean; updatedAt?: string | null }>(updateResponse)
      expect(updated?.ok).toBe(true)
      expect(typeof updated?.updatedAt === 'string' && updated.updatedAt.length > 0).toBe(true)

      const complete = await readSubmissionById(request, token, submissionId)
      expect(complete?.originCountry).toBe('BR')
      expect(complete?.geolocation).toEqual({ type: 'Point', coordinates: [-48.5, -21.2] })
      expect(Number(complete?.quantityKg)).toBe(1500)
      expect(complete?.producerName).toBe(producerName)
      expect(complete?.attachmentIds).toEqual([attachmentId])
      expect(complete?.completenessScore).toBe(100)
      expect(complete?.missingFields).toEqual([])

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(submissionId)}`,
        { token },
      )
      expect(deleteResponse.status(), `delete evidence submission failed: ${deleteResponse.status()}`).toBe(200)
      const deleted = await readJsonSafe<{ ok?: boolean }>(deleteResponse)
      expect(deleted?.ok).toBe(true)

      const afterDelete = await readSubmissionById(request, token, submissionId)
      expect(afterDelete, 'deleted evidence submission should disappear from id readback').toBeNull()
      submissionId = null
    } finally {
      await deleteSubmissionIfExists(request, token, submissionId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('returns 400 for invalid origin country, geolocation type, and harvest range', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let supplierId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-002 Invalid Supplier ${stamp}`)

      const invalidOriginResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
          originCountry: 'XYZ',
        },
      })
      expect(invalidOriginResponse.status(), 'three-letter origin country should return 400').toBe(400)

      const invalidGeolocationResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
          geolocation: { type: 'LineString' },
        },
      })
      expect(invalidGeolocationResponse.status(), 'unsupported GeoJSON type should return 400').toBe(400)

      const invalidHarvestResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
          harvestFrom: isoDaysAgo(10),
          harvestTo: isoDaysAgo(20),
        },
      })
      expect(invalidHarvestResponse.status(), 'harvestFrom after harvestTo should return 400').toBe(400)
    } finally {
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
