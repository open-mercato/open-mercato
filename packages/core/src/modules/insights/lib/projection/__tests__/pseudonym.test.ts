import { randomBytes } from 'node:crypto'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import {
  NO_PSEUDONYM_KEY_FINGERPRINT,
  TENANT_KEY_PSEUDONYM_PREFIX,
  XrayPseudonymKeyUnavailableError,
  comparePseudonymKeys,
  createActorPseudonymizer,
  type PseudonymKeySource,
} from '../pseudonym'

const TENANT_A = '11111111-0000-4000-8000-000000000001'
const TENANT_B = '11111111-0000-4000-8000-000000000002'
const USER = 'AAAAAAAA-0000-4000-8000-000000000001'

const ENV_KEYS = ['TENANT_DATA_ENCRYPTION', 'LOOKUP_HASH_PEPPER', 'TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'TENANT_DATA_ENCRYPTION_KEY'] as const

type KeySourceMock = PseudonymKeySource & { getDek: jest.Mock; createDek: jest.Mock }

function keySource(keys: Record<string, string>, enabled = true, created: string | null = null): KeySourceMock {
  return {
    isEnabled: () => enabled,
    getDek: jest.fn(async (tenantId: string | null | undefined) => (tenantId && keys[tenantId]
      ? { tenantId, key: keys[tenantId], fetchedAt: Date.now() }
      : null)),
    createDek: jest.fn(async (tenantId: string) => (created ? { tenantId, key: created, fetchedAt: Date.now() } : null)),
  }
}

describe('createActorPseudonymizer', () => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = original[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('with tenant data encryption on', () => {
    it('derives a keyed, deterministic, case-insensitive pseudonym and a key fingerprint from the tenant data key', async () => {
      const source = keySource({ [TENANT_A]: randomBytes(32).toString('base64') })
      const pseudonymizer = await createActorPseudonymizer(TENANT_A, source)
      const pseudonym = pseudonymizer.pseudonymize(USER) ?? ''
      expect(pseudonymizer.mode).toBe('tenant_key')
      expect(pseudonym.startsWith(TENANT_KEY_PSEUDONYM_PREFIX)).toBe(true)
      expect(pseudonym).toMatch(/^tk1:[0-9a-f]{64}$/)
      expect(pseudonymizer.pseudonymize(USER.toLowerCase())).toBe(pseudonym)
      expect(pseudonym).not.toContain(USER.toLowerCase())
      expect(pseudonymizer.fingerprint).toMatch(/^tk1:[0-9a-f]{32}$/)
      expect(pseudonym).not.toContain(pseudonymizer.fingerprint.slice(4))
      expect(source.getDek).toHaveBeenCalledWith(TENANT_A)
      expect(source.createDek).not.toHaveBeenCalled()
    })

    it('separates tenants and keys, and changes the fingerprint with the key', async () => {
      const sharedKey = randomBytes(32).toString('base64')
      const first = await createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: sharedKey }))
      const again = await createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: sharedKey }))
      const second = await createActorPseudonymizer(TENANT_B, keySource({ [TENANT_B]: sharedKey }))
      const rotated = await createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: randomBytes(32).toString('base64') }))
      expect(again.fingerprint).toBe(first.fingerprint)
      expect(first.pseudonymize(USER)).not.toBe(second.pseudonymize(USER))
      expect(first.fingerprint).not.toBe(second.fingerprint)
      expect(first.pseudonymize(USER)).not.toBe(rotated.pseudonymize(USER))
      expect(first.fingerprint).not.toBe(rotated.fingerprint)
    })

    it('provisions the tenant data key when the tenant has none yet', async () => {
      const created = randomBytes(32).toString('base64')
      const source = keySource({}, true, created)
      const pseudonymizer = await createActorPseudonymizer(TENANT_A, source)
      expect(source.createDek).toHaveBeenCalledWith(TENANT_A)
      expect(pseudonymizer.pseudonymize(USER)).toBe((await createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: created }))).pseudonymize(USER))
    })

    it('fails instead of falling back when the key service is missing, unhealthy or keyless', async () => {
      process.env.LOOKUP_HASH_PEPPER = 'test-pepper'
      await expect(createActorPseudonymizer(TENANT_A, null)).rejects.toBeInstanceOf(XrayPseudonymKeyUnavailableError)
      await expect(createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: randomBytes(32).toString('base64') }, false)))
        .rejects.toBeInstanceOf(XrayPseudonymKeyUnavailableError)
      await expect(createActorPseudonymizer(TENANT_A, keySource({}))).rejects.toBeInstanceOf(XrayPseudonymKeyUnavailableError)
    })
  })

  describe('with tenant data encryption off', () => {
    beforeEach(() => {
      process.env.TENANT_DATA_ENCRYPTION = 'no'
    })

    it('uses the keyed platform lookup hash bound to the tenant when a pepper is configured', async () => {
      process.env.LOOKUP_HASH_PEPPER = 'test-pepper'
      const pseudonymizer = await createActorPseudonymizer(TENANT_A, null)
      const expected = hashForLookup(USER.toLowerCase(), `insights.xray.actor:${TENANT_A}`)
      expect(expected.startsWith('v2:')).toBe(true)
      expect(pseudonymizer.mode).toBe('lookup_pepper')
      expect(pseudonymizer.pseudonymize(USER)).toBe(expected)
      expect(pseudonymizer.fingerprint).toMatch(/^lk1:[0-9a-f]{32}$/)
      const otherTenant = await createActorPseudonymizer(TENANT_B, null)
      expect(otherTenant.pseudonymize(USER)).not.toBe(expected)
      expect(otherTenant.fingerprint).not.toBe(pseudonymizer.fingerprint)
    })

    it('never writes an unkeyed digest: without a pepper no pseudonym is produced', async () => {
      const pseudonymizer = await createActorPseudonymizer(TENANT_A, keySource({ [TENANT_A]: randomBytes(32).toString('base64') }))
      expect(pseudonymizer).toEqual(expect.objectContaining({ mode: 'none', fingerprint: NO_PSEUDONYM_KEY_FINGERPRINT }))
      expect(pseudonymizer.pseudonymize(USER)).toBeNull()
    })
  })
})

describe('comparePseudonymKeys', () => {
  it('matches the same key, adopts a key on a cursor without keyed rows and refuses any other change', () => {
    expect(comparePseudonymKeys('tk1:a', 'tk1:a')).toBe('match')
    expect(comparePseudonymKeys(NO_PSEUDONYM_KEY_FINGERPRINT, NO_PSEUDONYM_KEY_FINGERPRINT)).toBe('match')
    expect(comparePseudonymKeys(null, 'tk1:a')).toBe('adopt')
    expect(comparePseudonymKeys(NO_PSEUDONYM_KEY_FINGERPRINT, 'tk1:a')).toBe('adopt')
    expect(comparePseudonymKeys('tk1:a', 'tk1:b')).toBe('mismatch')
    expect(comparePseudonymKeys('tk1:a', NO_PSEUDONYM_KEY_FINGERPRINT)).toBe('mismatch')
    expect(comparePseudonymKeys('lk1:a', 'tk1:a')).toBe('mismatch')
  })
})
