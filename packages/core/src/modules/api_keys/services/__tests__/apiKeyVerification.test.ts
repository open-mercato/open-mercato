jest.mock('node:perf_hooks', () => ({ performance: { now: () => Date.now() } }))

const mockCompare = jest.fn<Promise<boolean>, [string, string]>()
jest.mock('bcryptjs', () => ({ compare: (...args: [string, string]) => mockCompare(...args) }))

const storedHash = '$2b$10$' + 'a'.repeat(53)
const prefix = 'omk_12345678.'
let verify: typeof import('../apiKeyVerification').verifyApiKeyHash

beforeEach(async () => {
  jest.resetModules()
  jest.useFakeTimers()
  mockCompare.mockReset().mockResolvedValue(false)
  verify = (await import('../apiKeyVerification')).verifyApiKeyHash
})

afterEach(() => jest.useRealTimers())

it('bounds sequential distinct wrong suffixes for a known prefix and recovers after refill', async () => {
  for (let attempt = 0; attempt < 1000; attempt++) {
    await expect(verify(`${prefix}${attempt}`, storedHash)).resolves.toBe(false)
  }
  expect(mockCompare).toHaveBeenCalledTimes(4)
  jest.advanceTimersByTime(1000)
  mockCompare.mockResolvedValue(true)
  await expect(verify(`${prefix}valid`, storedHash)).resolves.toBe(true)
  expect(mockCompare).toHaveBeenCalledTimes(5)
})

it('bounds distinct-suffix abuse through the service used by application and MCP authentication', async () => {
  const { findApiKeyBySecret } = await import('../apiKeyService')
  const record = { keyHash: storedHash, expiresAt: null }
  const find = jest.fn().mockResolvedValue([record])
  const entityManager = { find } as unknown as Parameters<typeof findApiKeyBySecret>[0]
  for (let attempt = 0; attempt < 1000; attempt++) {
    await expect(findApiKeyBySecret(entityManager, `${prefix}${attempt}`)).resolves.toBeNull()
  }
  expect(mockCompare).toHaveBeenCalledTimes(4)
})

it('still checks live records and expiry after a cached successful comparison', async () => {
  const { findApiKeyBySecret } = await import('../apiKeyService')
  const record = { keyHash: storedHash, expiresAt: null as Date | null }
  const find = jest.fn().mockResolvedValue([record])
  const entityManager = { find } as unknown as Parameters<typeof findApiKeyBySecret>[0]
  mockCompare.mockResolvedValue(true)
  await expect(findApiKeyBySecret(entityManager, `${prefix}valid`)).resolves.toBe(record)
  record.expiresAt = new Date(Date.now() - 1)
  await expect(findApiKeyBySecret(entityManager, `${prefix}valid`)).resolves.toBeNull()
  find.mockResolvedValue([])
  await expect(findApiKeyBySecret(entityManager, `${prefix}valid`)).resolves.toBeNull()
  expect(mockCompare).toHaveBeenCalledTimes(1)
})

it('admits at most two concurrent bcrypt operations without queueing excess requests', async () => {
  const pending: Array<(valid: boolean) => void> = []
  mockCompare.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
  const first = verify(`${prefix}first`, storedHash)
  const second = verify(`${prefix}second`, storedHash)
  const rejected = await Promise.all(Array.from({ length: 1000 }, (_, index) => (
    verify(`${prefix}wrong-${index}`, storedHash)
  )))
  expect(rejected.every((valid) => valid === false)).toBe(true)
  expect(mockCompare).toHaveBeenCalledTimes(2)
  pending.forEach((resolve) => resolve(false))
  await Promise.all([first, second])
  mockCompare.mockResolvedValue(true)
  await expect(verify(`${prefix}retry`, storedHash)).resolves.toBe(true)
})

it('shares bounded work across different prefixes', async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    await verify(`omk_${attempt}.wrong`, storedHash)
  }
  expect(mockCompare).toHaveBeenCalledTimes(4)
})

it('caches both outcomes and binds cached verification to the stored hash', async () => {
  mockCompare.mockResolvedValueOnce(true).mockResolvedValue(false)
  await expect(verify(`${prefix}valid`, storedHash)).resolves.toBe(true)
  await expect(verify(`${prefix}valid`, storedHash)).resolves.toBe(true)
  await expect(verify(`${prefix}wrong`, storedHash)).resolves.toBe(false)
  await expect(verify(`${prefix}wrong`, storedHash)).resolves.toBe(false)
  await expect(verify(`${prefix}valid`, storedHash.replace('$10$', '$12$'))).resolves.toBe(false)
  expect(mockCompare).toHaveBeenCalledTimes(3)
  jest.advanceTimersByTime(10_001)
  await expect(verify(`${prefix}valid`, storedHash)).resolves.toBe(false)
  expect(mockCompare).toHaveBeenCalledTimes(4)
})

it('releases concurrency slots after bcrypt errors without caching errors', async () => {
  mockCompare.mockRejectedValueOnce(new Error('bcrypt failure'))
  await expect(verify(`${prefix}retry`, storedHash)).rejects.toThrow('bcrypt failure')
  mockCompare.mockResolvedValue(true)
  await expect(verify(`${prefix}retry`, storedHash)).resolves.toBe(true)
  expect(mockCompare).toHaveBeenCalledTimes(2)
})

it('rejects malformed hashes and invalid work factors before bcrypt', async () => {
  for (const keyHash of ['', 'invalid', storedHash.replace('$10$', '$99$')]) {
    await expect(verify(`${prefix}valid`, keyHash)).resolves.toBe(false)
  }
  expect(mockCompare).not.toHaveBeenCalled()
})

it('evicts old verification entries when the cache reaches its bound', async () => {
  for (let attempt = 0; attempt < 1025; attempt++) {
    jest.advanceTimersByTime(1)
    if (attempt % 4 === 0) jest.advanceTimersByTime(500)
    await verify(`${prefix}${attempt}`, storedHash)
  }
  expect(mockCompare).toHaveBeenCalledTimes(1025)
  jest.advanceTimersByTime(1000)
  await verify(`${prefix}0`, storedHash)
  expect(mockCompare).toHaveBeenCalledTimes(1026)
})
