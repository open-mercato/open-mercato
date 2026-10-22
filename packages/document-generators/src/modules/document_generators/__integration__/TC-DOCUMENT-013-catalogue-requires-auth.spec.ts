import { test } from '@playwright/test'
import { expectUnauthenticated } from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-013: GET /templates requires auth', () => {
  test('answers 401 without credentials', async () => {
    await expectUnauthenticated('GET', '/api/document-generators/templates')
  })
})
