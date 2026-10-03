import { test } from '@playwright/test'
import { expectUnauthenticated } from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-015: POST /generate requires auth', () => {
  test('answers 401 without credentials', async () => {
    await expectUnauthenticated('POST', '/api/document-generators/generate', { template_id: 'sales.order-invoice', data: { id: '00000000-0000-4000-8000-000000000000' } })
  })
})
