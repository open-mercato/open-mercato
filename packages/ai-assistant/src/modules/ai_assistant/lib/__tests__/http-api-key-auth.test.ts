import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ApiKeyVerificationRateLimitError } from '@open-mercato/shared/lib/auth/apiKeyVerificationRateLimit'
import { authenticateHttpApiKey } from '../http-api-key-auth'

const mockFindApiKey = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: (...args: unknown[]) => mockFindApiKey(...args),
}))

it.each(['limited', 'invalid', 'unavailable'])('MCP HTTP authentication distinguishes %s without exposing credential details', async (outcome) => {
  if (outcome === 'limited') mockFindApiKey.mockRejectedValue(new ApiKeyVerificationRateLimitError(1200))
  else if (outcome === 'unavailable') mockFindApiKey.mockRejectedValue(new Error('lookup failure details'))
  else mockFindApiKey.mockResolvedValue(null)
  const entityManager = {} as EntityManager
  const server = createServer(async (_request, response) => {
    const record = await authenticateHttpApiKey(entityManager, 'omk_test.secret', response)
    if (record) response.end('authenticated')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}`)
    expect(response.headers.get('x-om-api-key-verification-throttled')).toBe(outcome === 'limited' ? '1' : null)
    expect(response.status).toBe(outcome === 'limited' ? 429 : outcome === 'unavailable' ? 503 : 401)
    expect(response.headers.get('retry-after')).toBe(outcome === 'limited' ? '2' : outcome === 'unavailable' ? '1' : null)
    const body = await response.text()
    expect(body).not.toContain('omk_test.secret')
    expect(body).not.toContain('lookup failure details')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
