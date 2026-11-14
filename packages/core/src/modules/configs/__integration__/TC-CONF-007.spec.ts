import { expect, test } from '@playwright/test'

test.describe('TC-CONF-007: application readiness', () => {
  test('reports ready only after required runtime services initialize', async ({ request }) => {
    const response = await request.get('/api/configs/health/ready')

    expect(response.status()).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ready' })
    expect(response.headers()['cache-control']).toBe('no-store')
  })
})
