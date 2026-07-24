import { MetadataStorage } from '@mikro-orm/core'
import { findApiKeyBySecret, generateApiKeySecret } from '../apiKeyService'
import { ApiKey } from '../../data/entities'

// Regression guard for #3812: findApiKeyBySecret bcrypt-compares every live row that
// shares the keyPrefix. The candidate set stays bounded only because the keyPrefix is
// unique, has a fixed width, and the lookup filters on keyPrefix + deletedAt: null.
// These tests fail if a refactor drops the unique constraint, widens the prefix space,
// or drops the soft-delete filter.
describe('api-key prefix candidate loop — bounded-set invariant (#3812)', () => {
  it('keeps the unique constraint on keyPrefix (bounds the candidate set to <=1 live row)', () => {
    const path = (ApiKey as unknown as Record<symbol, string>)[MetadataStorage.PATH_SYMBOL]
    const meta = MetadataStorage.getMetadata(ApiKey.name, path)
    const hasKeyPrefixUnique = (meta?.uniques ?? []).some((unique) => {
      const properties = Array.isArray(unique.properties) ? unique.properties : [unique.properties]
      return properties.includes('keyPrefix')
    })
    expect(hasKeyPrefixUnique).toBe(true)
  })

  it('generates a fixed-width 12-char prefix (omk_ + 8 hex)', () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const { secret, prefix } = generateApiKeySecret()
      expect(prefix).toMatch(/^omk_[0-9a-f]{8}$/)
      expect(prefix).toHaveLength(12)
      expect(secret.startsWith(`${prefix}.`)).toBe(true)
    }
  })

  it('narrows candidates by unique keyPrefix and excludes soft-deleted rows', async () => {
    const findSpy = jest.fn(async () => [])
    const mockEm = { find: findSpy } as unknown as Parameters<typeof findApiKeyBySecret>[0]
    const { secret, prefix } = generateApiKeySecret()

    const result = await findApiKeyBySecret(mockEm, secret)

    expect(result).toBeNull()
    expect(findSpy).toHaveBeenCalledTimes(1)
    expect(findSpy).toHaveBeenCalledWith(ApiKey, { keyPrefix: prefix, deletedAt: null })
  })
})
