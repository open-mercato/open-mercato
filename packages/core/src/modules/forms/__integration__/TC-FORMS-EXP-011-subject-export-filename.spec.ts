import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-FORMS-EXP-011: subject exports preserve the display type and use a safe download name', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const subjectId = randomUUID()
  const subjectType = 'Employee Application'
  const expectedFilename = `forms-export-Employee_Application-${subjectId}.json`

  const response = await apiRequest(
    request,
    'GET',
    `/api/forms/subjects/${encodeURIComponent(subjectType)}/${subjectId}/export`,
    { token },
  )

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(response.headers()['content-disposition']).toBe(
    `attachment; filename="${expectedFilename}"; filename*=UTF-8''${expectedFilename}`,
  )
  expect(await readJsonSafe(response)).toMatchObject({ subjectType, subjectId, submissions: [] })
})
