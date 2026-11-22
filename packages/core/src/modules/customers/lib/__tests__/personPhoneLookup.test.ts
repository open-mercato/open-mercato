import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import {
  hashPersonPhoneDigits,
  hasPersonPhoneLookupPepper,
  normalizePhoneLookupDigits,
  personPhoneHashCandidates,
} from '../personPhoneLookup'

const organizationId = 'organization-one'

describe('person phone lookup digest', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      LOOKUP_HASH_PEPPER: 'a-current-test-lookup-secret',
      LOOKUP_HASH_OLD_PEPPER: undefined,
      TENANT_DATA_ENCRYPTION_KEY: undefined,
      TENANT_DATA_ENCRYPTION_FALLBACK_KEY: undefined,
    })
  })

  afterEach(() => jest.restoreAllMocks())

  it('hashes formatted digits identically within an organization', () => {
    const digest = hashPersonPhoneDigits('+00 (415) 555-0148', organizationId)

    expect(digest).toMatch(/^v2:[0-9a-f]{64}$/)
    expect(hashPersonPhoneDigits('004155550148', organizationId)).toBe(digest)
    expect(hashPersonPhoneDigits('004155550148', 'another-organization')).not.toBe(digest)
    expect(personPhoneHashCandidates('004155550148', organizationId)).toEqual([digest])
  })

  it('keeps the previous keyed digest searchable during pepper rotation', () => {
    const oldDigest = hashPersonPhoneDigits('004155550148', organizationId)
    process.env.LOOKUP_HASH_OLD_PEPPER = process.env.LOOKUP_HASH_PEPPER
    process.env.LOOKUP_HASH_PEPPER = 'a-new-test-lookup-secret'
    const newDigest = hashPersonPhoneDigits('004155550148', organizationId)

    expect(newDigest).not.toBe(oldDigest)
    expect(personPhoneHashCandidates('004155550148', organizationId)).toEqual([newDigest, oldDigest])
  })

  it('leaves phones unindexed when there is no lookup secret', () => {
    delete process.env.LOOKUP_HASH_PEPPER

    expect(hasPersonPhoneLookupPepper()).toBe(false)
    expect(hashPersonPhoneDigits('004155550148', organizationId)).toBeNull()
    expect(personPhoneHashCandidates('004155550148', organizationId)).toEqual([])
  })

  it('skips missing numbers and undecrypted envelopes', () => {
    const { value } = encryptWithAesGcm('004155550148', generateDek())

    expect(hashPersonPhoneDigits(null, organizationId)).toBeNull()
    expect(hashPersonPhoneDigits('123', organizationId)).toBeNull()
    expect(normalizePhoneLookupDigits(value)).toBe('')
    expect(hashPersonPhoneDigits(value, organizationId)).toBeNull()
  })
})
