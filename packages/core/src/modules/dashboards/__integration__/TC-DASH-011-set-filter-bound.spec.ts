import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { MAX_SET_FILTER_VALUES } from '../api/widgets/data/schema'

const API = {
  widgetData: '/api/dashboards/widgets/data',
  widgetDataBatch: '/api/dashboards/widgets/data/batch',
}

type ValidationIssue = {
  code?: string
  path?: Array<string | number>
}

type ValidationErrorResponse = {
  error?: string
  issues?: ValidationIssue[]
}

function buildOversizedRequest(operator: 'in' | 'not_in') {
  return {
    entityType: 'sales:orders',
    metric: { field: 'id', aggregate: 'count' },
    filters: [
      {
        field: 'id',
        operator,
        value: Array.from({ length: MAX_SET_FILTER_VALUES + 1 }, (_, index) => `id-${index}`),
      },
    ],
  }
}

test.describe('TC-DASH-011: widget-data set-filter request bound', () => {
  test('rejects oversized filters at both API boundaries with the indexed issue path', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const singleResponse = await apiRequest(request, 'POST', API.widgetData, {
      token: adminToken,
      data: buildOversizedRequest('in'),
    })
    const singleBody = await readJsonSafe<ValidationErrorResponse>(singleResponse)

    expect(singleResponse.status()).toBe(400)
    expect(singleBody?.error).toBe('Invalid request payload')
    expect(singleBody?.issues?.[0]).toEqual(
      expect.objectContaining({ code: 'too_big', path: ['filters', 0, 'value'] }),
    )

    const batchResponse = await apiRequest(request, 'POST', API.widgetDataBatch, {
      token: adminToken,
      data: {
        requests: [{ id: 'oversized', request: buildOversizedRequest('not_in') }],
      },
    })
    const batchBody = await readJsonSafe<ValidationErrorResponse>(batchResponse)

    expect(batchResponse.status()).toBe(400)
    expect(batchBody?.error).toBe('Invalid request payload')
    expect(batchBody?.issues?.[0]).toEqual(
      expect.objectContaining({
        code: 'too_big',
        path: ['requests', 0, 'request', 'filters', 0, 'value'],
      }),
    )
  })
})
