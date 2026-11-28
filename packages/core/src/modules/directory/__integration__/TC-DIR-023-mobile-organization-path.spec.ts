import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

const organizationsPath = '/api/directory/organizations'

test('TC-DIR-023: a long organization path fits the mobile edit form', async ({ page, request }) => {
  const token = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(token)
  const name = `Mobile${randomUUID().replaceAll('-', '')}`.padEnd(200, 'W')
  let organizationId: string | null = null

  try {
    const response = await apiRequest(request, 'POST', organizationsPath, {
      token,
      data: { name, tenantId },
    })
    expect(response.status()).toBe(201)
    organizationId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Organization creation should return an id')

    await login(page, 'superadmin')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/backend/directory/organizations/${organizationId}/edit`)

    await expect(page.getByText(`Path: ${name}`, { exact: true }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.getByRole('button', { name: 'Save', exact: true }).first()).toBeVisible()
  } finally {
    await deleteGeneralEntityIfExists(request, token, organizationsPath, organizationId)
  }
})
