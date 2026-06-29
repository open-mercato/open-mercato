import { test, expect } from '@playwright/test'

function resolveUrl(path: string): string {
  const baseUrl = process.env.BASE_URL?.trim()
  return baseUrl ? `${baseUrl}${path}` : path
}

test.describe('TC-UMES-022: modules.ts overrides', () => {
  test('routes.api override replaces the example override probe handler', async ({ request }) => {
    const response = await request.get(resolveUrl('/api/example/override-probe'))

    expect(response.ok(), `GET /api/example/override-probe returned ${response.status()}`).toBeTruthy()
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      source: 'modules.ts override',
      route: 'example.override-probe',
    })
  })
})

