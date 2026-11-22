import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type EvidenceSubmissionRow = {
  id: string
  harvestFrom?: string | null
  harvestTo?: string | null
}

async function readSubmissionById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<EvidenceSubmissionRow | null> {
  const response = await apiRequest(request, 'GET', `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET evidence submission by id should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<{ items?: EvidenceSubmissionRow[] }>(response)
  return body?.items?.[0] ?? null
}

type ValidationErrorBody = {
  error?: string
  details?: Array<{ path?: unknown[]; message?: string }>
}

async function expectHarvestRangeRefusal(response: APIResponse, label: string): Promise<ValidationErrorBody | null> {
  expect(response.status(), `${label} should return 400`).toBe(400)
  const body = await readJsonSafe<ValidationErrorBody>(response)
  expect(body?.details).toEqual([
    expect.objectContaining({ path: ['harvestTo'], message: 'eudr.errors.harvestRange' }),
  ])
  return body
}

/**
 * TC-EUDR-023: Updating only one harvest date is checked against the stored other date.
 */
test.describe('TC-EUDR-023: Evidence submission single-date harvest range update', () => {
  test('rejects a single-date update that inverts the stored harvest window', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let supplierId: string | null = null
    let submissionId: string | null = null

    try {
      const supplierResponse = await apiRequest(request, 'POST', CUSTOMERS_COMPANIES_PATH, {
        token,
        data: { displayName: `TC-EUDR-023 Supplier ${stamp}` },
      })
      expect(supplierResponse.ok(), `create supplier failed: ${supplierResponse.status()}`).toBeTruthy()
      const supplier = await readJsonSafe<{ id?: string }>(supplierResponse)
      supplierId = expectId(supplier?.id, 'Supplier create response should include id')

      const createResponse = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          supplierEntityId: supplierId,
          commodity: 'coffee',
          harvestFrom: '2024-01-01T00:00:00.000Z',
          harvestTo: '2024-06-01T00:00:00.000Z',
        },
      })
      expect(createResponse.status(), `create submission failed: ${createResponse.status()}`).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      submissionId = expectId(created?.id, 'Evidence submission create response should include id')

      const bothDatesResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: { id: submissionId, harvestFrom: '2024-09-01T00:00:00.000Z', harvestTo: '2023-01-01T00:00:00.000Z' },
      })
      const bothDatesBody = await expectHarvestRangeRefusal(bothDatesResponse, 'inverted both-dates update')

      const invertedToResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: { id: submissionId, harvestTo: '2023-01-01T00:00:00.000Z' },
      })
      const invertedToBody = await expectHarvestRangeRefusal(invertedToResponse, 'harvestTo-only update before stored harvestFrom')
      expect(invertedToBody?.error).toBe(bothDatesBody?.error)

      const invertedFromResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: { id: submissionId, harvestFrom: '2024-09-01T00:00:00.000Z' },
      })
      const invertedFromBody = await expectHarvestRangeRefusal(invertedFromResponse, 'harvestFrom-only update after stored harvestTo')
      expect(invertedFromBody?.error).toBe(bothDatesBody?.error)

      const unchanged = await readSubmissionById(request, token, submissionId)
      expect(unchanged?.harvestFrom?.slice(0, 10)).toBe('2024-01-01')
      expect(unchanged?.harvestTo?.slice(0, 10)).toBe('2024-06-01')

      const validResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: { id: submissionId, harvestTo: '2024-03-01T00:00:00.000Z' },
      })
      expect(validResponse.status(), `ordered single-date update should succeed: ${validResponse.status()}`).toBe(200)

      const updated = await readSubmissionById(request, token, submissionId)
      expect(updated?.harvestFrom?.slice(0, 10)).toBe('2024-01-01')
      expect(updated?.harvestTo?.slice(0, 10)).toBe('2024-03-01')
    } finally {
      await deleteGeneralEntityIfExists(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionId)
      await deleteGeneralEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
