import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr'],
}

const STATEMENTS_PATH = '/api/eudr/statements'

type ReadinessResponse = {
  status?: string
  allowed?: boolean
  reasons?: string[]
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: {
      title,
      commodity: 'coffee',
      actorRole: 'operator',
    },
  })
  expect(response.status(), `statement create failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'statement create response should include id')
}

test.describe('TC-EUDR-017 statement submit-gate readiness endpoint', () => {
  test('reports unmet gate requirements for a draft statement without a submit attempt', async ({ request }) => {
    const token = await getAuthToken(request)
    const stamp = randomUUID().slice(0, 8)
    let statementId: string | null = null

    try {
      statementId = await createStatement(request, token, `TC-EUDR-017 draft ${stamp}`)

      const readinessResponse = await apiRequest(
        request,
        'GET',
        `${STATEMENTS_PATH}/${encodeURIComponent(statementId)}/readiness`,
        { token },
      )
      expect(readinessResponse.status(), 'readiness endpoint should return 200 for a visible statement').toBe(200)
      const readiness = await readJsonSafe<ReadinessResponse>(readinessResponse)
      expect(readiness?.status).toBe('draft')
      expect(readiness?.allowed).toBe(false)
      expect(Array.isArray(readiness?.reasons)).toBe(true)
      expect(readiness?.reasons).toContain('eudr.gate.noSubmissions')
      expect(readiness?.reasons).toContain('eudr.gate.riskConclusionMissing')
      for (const reason of readiness?.reasons ?? []) {
        expect(reason.startsWith('eudr.gate.')).toBe(true)
      }
    } finally {
      if (statementId) {
        await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(statementId)}`, { token })
          .catch(() => undefined)
      }
    }
  })

  test('returns 404 for an unknown statement and 401 without auth', async ({ request }) => {
    const token = await getAuthToken(request)

    const missingResponse = await apiRequest(
      request,
      'GET',
      `${STATEMENTS_PATH}/${encodeURIComponent(randomUUID())}/readiness`,
      { token },
    )
    expect(missingResponse.status()).toBe(404)

    const unauthenticatedResponse = await request.get(
      `${STATEMENTS_PATH}/${encodeURIComponent(randomUUID())}/readiness`,
    )
    expect([401, 403]).toContain(unauthenticatedResponse.status())
  })
})
