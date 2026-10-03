import { test } from '@playwright/test'
import { expectUnauthenticated } from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-016: GET /documents requires auth', () => {
  test('answers 401 without credentials', async () => {
    await expectUnauthenticated('GET', '/api/document-generators/documents')
  })
})
