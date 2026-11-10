import { ApiKeyVerificationRateLimitError } from '@open-mercato/shared/lib/auth/apiKeyVerificationRateLimit'
import { POST } from '../api/identity/token/route'

const mockIssueAgentToken = jest.fn()
jest.mock('../lib/identity/agentTokenService', () => ({
  issueAgentToken: (...args: unknown[]) => mockIssueAgentToken(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({}),
}))
jest.mock('../lib/guardrails/publicEndpointRateLimit', () => ({
  enforcePublicEndpointRateLimit: async () => null,
}))

it.each([true, false])('keeps verification overload distinct from invalid_client (%s)', async (limited) => {
  if (limited) mockIssueAgentToken.mockRejectedValue(new ApiKeyVerificationRateLimitError(1500))
  else mockIssueAgentToken.mockResolvedValue(null)
  const response = await POST(new Request('https://example.test/api/agent_orchestrator/identity/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials', client_id: '11111111-1111-4111-8111-111111111111',
      client_secret: 'omk_12345678.fixture-secret',
    }),
  }))
  expect(response.status).toBe(limited ? 429 : 401)
  expect(response.headers.get('x-om-api-key-verification-throttled')).toBe(limited ? '1' : null)
  expect(response.headers.get('retry-after')).toBe(limited ? '2' : null)
  expect(await response.json()).toEqual({ error: limited ? 'temporarily_unavailable' : 'invalid_client' })
})
