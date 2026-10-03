import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import * as dg from './helpers/document-generators-api'

test.describe('TC-DOCUMENT-019: template filter options shape', () => {
  test('GET /templates/options returns deduplicated sorted facets and no template list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await dg.listTemplateOptions(request, token)
    expect(response.status()).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['formats', 'resourceKinds'])
    expect(body).not.toHaveProperty('items')
    expect(body).not.toHaveProperty('templates')
    for (const key of ['resourceKinds', 'formats']) {
      const values = body[key] as string[]
      expect(Array.isArray(values)).toBe(true)
      expect(new Set(values).size).toBe(values.length)
      expect([...values].sort()).toEqual(values)
    }
  })
})
