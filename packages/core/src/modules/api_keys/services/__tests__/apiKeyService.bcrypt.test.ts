import { getRounds, hash } from 'bcryptjs'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ApiKey } from '../../data/entities'
import {
  createApiKey,
  createSessionApiKey,
  findApiKeyBySecret,
  generateApiKeySecret,
  hashApiKey,
  verifyApiKey,
} from '../apiKeyService'

function buildEntityManager() {
  const records: ApiKey[] = []
  const entityManager = {
    create: jest.fn((_entity: typeof ApiKey, data: Partial<ApiKey>) => {
      const record = Object.assign(new ApiKey(), data)
      records.push(record)
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    isInTransaction: () => false,
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    find: jest.fn(async (_entity: typeof ApiKey, where: { keyPrefix: string; deletedAt: null }) => (
      records.filter((record) => record.keyPrefix === where.keyPrefix && record.deletedAt == null)
    )),
  }
  return { entityManager: entityManager as unknown as EntityManager, records }
}

describe('API-key bcrypt work factor', () => {
  it('hashes new secrets at cost 12 and rejects a wrong secret', async () => {
    const { secret } = generateApiKeySecret()

    const keyHash = await hashApiKey(secret)

    expect(getRounds(keyHash)).toBe(12)
    await expect(verifyApiKey(secret, keyHash)).resolves.toBe(true)
    await expect(verifyApiKey(`${secret}wrong`, keyHash)).resolves.toBe(false)
  })

  it('creates a cost-12 key that can be found by its secret', async () => {
    const { entityManager, records } = buildEntityManager()

    const { record, secret } = await createApiKey(entityManager, { name: 'bcrypt regression' })

    expect(records).toEqual([record])
    expect(getRounds(record.keyHash)).toBe(12)
    await expect(findApiKeyBySecret(entityManager, secret)).resolves.toBe(record)
    await expect(findApiKeyBySecret(entityManager, `${secret}wrong`)).resolves.toBeNull()
  })

  it('creates session API keys at cost 12', async () => {
    const { entityManager, records } = buildEntityManager()

    const { secret } = await createSessionApiKey(entityManager, {
      sessionToken: 'sess_bcrypt_regression',
      userId: 'user-bcrypt',
      userRoles: [],
    })

    expect(records).toHaveLength(1)
    expect(getRounds(records[0].keyHash)).toBe(12)
    await expect(findApiKeyBySecret(entityManager, secret)).resolves.toBe(records[0])
  })

  it('continues to verify existing cost-10 hashes and rejects wrong secrets', async () => {
    const { secret, prefix } = generateApiKeySecret()
    const keyHash = await hash(secret, 10)
    const { entityManager, records } = buildEntityManager()
    const legacyRecord = Object.assign(new ApiKey(), { keyHash, keyPrefix: prefix })
    records.push(legacyRecord)

    expect(getRounds(keyHash)).toBe(10)
    await expect(verifyApiKey(secret, keyHash)).resolves.toBe(true)
    await expect(verifyApiKey(`${secret}wrong`, keyHash)).resolves.toBe(false)
    await expect(findApiKeyBySecret(entityManager, secret)).resolves.toBe(legacyRecord)
    await expect(findApiKeyBySecret(entityManager, `${secret}wrong`)).resolves.toBeNull()
    expect(legacyRecord.keyHash).toBe(keyHash)
  })
})
