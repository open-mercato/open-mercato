import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { MAX_DYNAMIC_CODE_POOL_AMOUNT } from '../data/validators'
import { uniqueStamp } from './helpers'

test.describe('TC-PROM-086: dynamic code pool amount cap', () => {
  test('rejects creating a pool above the configured maximum', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/promotions/codes', {
      token,
      data: {
        name: `QA PROM 086 Oversized ${uniqueStamp()}`,
        type: 'dynamic',
        amount: MAX_DYNAMIC_CODE_POOL_AMOUNT + 1,
        usage: 'unlimited',
      },
    })

    expect(response.status(), await response.text()).toBe(400)
  })
})
