let mockNow = 0
jest.mock('node:perf_hooks', () => ({ performance: { now: () => mockNow } }))

const mockCompare = jest.fn<Promise<boolean>, [string, string]>()
jest.mock('bcryptjs', () => ({ compare: (...args: [string, string]) => mockCompare(...args) }))
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

const storedHash = '$2b$12$' + 'a'.repeat(53)
const prefix = 'omk_12345678'
let verify: typeof import('../apiKeyVerification').verifyApiKeyHash

beforeEach(async () => {
  jest.resetModules()
  mockNow = 0
  mockCompare.mockReset().mockResolvedValue(false)
  verify = (await import('../apiKeyVerification')).verifyApiKeyHash
})

it('rejects changing wrong suffixes before bcrypt and does not extend recovery on rejection', async () => {
  await expect(verify(`${prefix}.first`, storedHash)).resolves.toBe(false)
  for (let attempt = 0; attempt < 1000; attempt++) {
    await expect(verify(`${prefix}.${attempt}`, storedHash)).rejects.toMatchObject({ name: 'ApiKeyVerificationRateLimitError' })
  }
  expect(mockCompare).toHaveBeenCalledTimes(1)
  mockNow = 249
  await expect(verify(`${prefix}.still-blocked`, storedHash)).rejects.toMatchObject({ retryAfterMs: 1 })
  expect(mockCompare).toHaveBeenCalledTimes(1)
  mockNow = 250
  mockCompare.mockResolvedValue(true)
  await expect(verify(`${prefix}.valid`, storedHash)).resolves.toBe(true)
  expect(mockCompare).toHaveBeenCalledTimes(2)
})

it('shares the work limit across different prefixes and stored hashes', async () => {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const keyHash = '$2b$12$' + String(attempt).padStart(53, 'a')
    if (attempt === 0) await verify(`omk_${attempt}.wrong`, keyHash)
    else await expect(verify(`omk_${attempt}.wrong`, keyHash)).rejects.toMatchObject({ name: 'ApiKeyVerificationRateLimitError' })
  }
  expect(mockCompare).toHaveBeenCalledTimes(1)
})

it('allows one active comparison and rejects excess work without waiting in a queue', async () => {
  let complete: (valid: boolean) => void = () => undefined
  mockCompare.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  const pending = verify(`${prefix}.first`, storedHash)
  mockNow = 10_000
  const rejected = await Promise.all(Array.from({ length: 1000 }, (_, index) => (
    verify(`${prefix}.wrong-${index}`, storedHash).catch((error: Error) => error.name)
  )))
  expect(rejected.every((name) => name === 'ApiKeyVerificationRateLimitError')).toBe(true)
  expect(mockCompare).toHaveBeenCalledTimes(1)
  complete(false)
  await expect(pending).resolves.toBe(false)
  mockCompare.mockResolvedValue(true)
  mockNow = 39_999
  await expect(verify(`${prefix}.retry`, storedHash)).rejects.toMatchObject({ retryAfterMs: 1 })
  mockNow = 40_000
  await expect(verify(`${prefix}.retry`, storedHash)).resolves.toBe(true)
})

it('adapts recovery to actual verification duration under sustained traffic', async () => {
  mockCompare.mockImplementation(async () => { mockNow += 100; return false })
  while (mockNow < 10_000) {
    await verify(`${prefix}.${mockNow}`, storedHash).catch((error: Error) => {
      expect(error.name).toBe('ApiKeyVerificationRateLimitError')
    })
    mockNow += 1
  }
  expect(mockCompare).toHaveBeenCalledTimes(25)
  expect(mockCompare.mock.calls.length * 100).toBeLessThanOrEqual(mockNow / 4)
})

it.each([true, false])('never caches a comparison result of %s', async (valid) => {
  mockCompare.mockResolvedValue(valid)
  await expect(verify(`${prefix}.same`, storedHash)).resolves.toBe(valid)
  mockNow = 250
  mockCompare.mockResolvedValue(!valid)
  await expect(verify(`${prefix}.same`, storedHash)).resolves.toBe(!valid)
  expect(mockCompare).toHaveBeenCalledTimes(2)
})

it('releases the active slot and applies recovery after comparison errors', async () => {
  mockCompare.mockImplementationOnce(async () => { mockNow += 100; throw new Error('bcrypt failure') })
  await expect(verify(`${prefix}.retry`, storedHash)).rejects.toThrow('bcrypt failure')
  mockCompare.mockResolvedValue(true)
  mockNow = 399
  await expect(verify(`${prefix}.retry`, storedHash)).rejects.toMatchObject({ retryAfterMs: 1 })
  mockNow = 400
  await expect(verify(`${prefix}.retry`, storedHash)).resolves.toBe(true)
})

it('rejects malformed hashes before admitting expensive work', async () => {
  for (const keyHash of ['', 'invalid', storedHash.replace('$12$', '$99$')]) {
    await expect(verify(`${prefix}.valid`, keyHash)).resolves.toBe(false)
  }
  expect(mockCompare).not.toHaveBeenCalled()
  mockCompare.mockResolvedValue(true)
  await expect(verify(`${prefix}.valid`, storedHash)).resolves.toBe(true)
})

it('continues to check live records and expiry on every lookup', async () => {
  const { findApiKeyBySecret } = await import('../apiKeyService')
  const record = { keyHash: storedHash, expiresAt: null as Date | null }
  const find = jest.fn().mockResolvedValue([record])
  const entityManager = { find } as unknown as Parameters<typeof findApiKeyBySecret>[0]
  mockCompare.mockResolvedValue(true)
  await expect(findApiKeyBySecret(entityManager, `${prefix}.valid`)).resolves.toBe(record)
  record.expiresAt = new Date(Date.now() - 1)
  await expect(findApiKeyBySecret(entityManager, `${prefix}.valid`)).resolves.toBeNull()
  find.mockResolvedValue([])
  await expect(findApiKeyBySecret(entityManager, `${prefix}.valid`)).resolves.toBeNull()
  expect(find).toHaveBeenCalledTimes(3)
  expect(mockCompare).toHaveBeenCalledTimes(1)
})

it('bounds work through the actual application and MCP authentication consumers with caches cleared', async () => {
  const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
  const { authenticateMcpRequest } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/auth')
  const { resetSharedApiKeyAuthCacheForTests } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
  const entityManager = { find: jest.fn().mockResolvedValue([{ keyHash: storedHash, expiresAt: null }]) }
  const container = { resolve: jest.fn().mockReturnValue(entityManager) }
  mockCreateRequestContainer.mockResolvedValue(container)
  for (let attempt = 0; attempt < 100; attempt++) {
    resetSharedApiKeyAuthCacheForTests()
    const applicationResult = await resolveAuthFromRequestDetailed(new Request('https://example.test/api/test', {
      headers: { 'x-api-key': `${prefix}.app-${attempt}` },
    }))
    if (attempt === 0) expect(applicationResult).toEqual({ auth: null, status: 'missing' })
    else expect(applicationResult).toMatchObject({ auth: null, status: 'error', retryAfterMs: 250 })
    await expect(authenticateMcpRequest(`${prefix}.mcp-${attempt}`, container as unknown as Parameters<typeof authenticateMcpRequest>[1]))
      .rejects.toMatchObject({ name: 'ApiKeyVerificationRateLimitError' })
  }
  expect(entityManager.find).toHaveBeenCalledTimes(200)
  expect(mockCompare).toHaveBeenCalledTimes(1)
})

it('does not negative-cache a valid key while the verifier is busy and permits a later retry', async () => {
  const { resolveAuthFromRequestDetailed } = await import('@open-mercato/shared/lib/auth/server')
  const { getSharedApiKeyAuthCache } = await import('@open-mercato/shared/lib/auth/apiKeyAuthCache')
  const record = {
    id: 'key-retry', name: 'retry', keyHash: storedHash, expiresAt: null,
    rolesJson: [], tenantId: null, organizationId: null, createdBy: null,
  }
  const entityManager = { find: jest.fn().mockResolvedValue([record]) }
  mockCreateRequestContainer.mockResolvedValue({ resolve: () => entityManager })
  await verify(`${prefix}.attack`, storedHash)
  const request = new Request('https://example.test/api/test', { headers: { 'x-api-key': `${prefix}.valid` } })
  await expect(resolveAuthFromRequestDetailed(request)).resolves.toMatchObject({
    auth: null, status: 'error', retryAfterMs: 250,
  })
  expect(getSharedApiKeyAuthCache().get(`${prefix}.valid`)).toBeUndefined()
  mockNow = 250
  mockCompare.mockResolvedValue(true)
  await expect(resolveAuthFromRequestDetailed(request)).resolves.toMatchObject({
    status: 'authenticated', auth: { keyId: 'key-retry' },
  })
  expect(mockCompare).toHaveBeenCalledTimes(2)
})
