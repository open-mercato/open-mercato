import type { EntityManager } from '@mikro-orm/core'
import { decryptCustomFieldValue, encryptCustomFieldValue, resolveTenantEncryptionService } from '../customFieldValues'

const fixedKey = Buffer.alloc(32, 1).toString('base64')

describe('customFieldValues encryption helpers', () => {
  it('caches tenant encryption service per entity manager', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const em = {} as EntityManager
    const first = resolveTenantEncryptionService(em)
    const second = resolveTenantEncryptionService(em)
    expect(first).toBe(second)
    warnSpy.mockRestore()
  })

  it('encrypts and decrypts primitives when enabled', async () => {
    const service = {
      isEnabled: () => true,
      getDek: async () => ({ key: fixedKey }),
    } as any
    const cache = new Map<string | null, string | null>()

    const encrypted = await encryptCustomFieldValue('secret', 'tenant-1', service, cache)
    expect(typeof encrypted).toBe('string')
    const decrypted = await decryptCustomFieldValue(encrypted, 'tenant-1', service, cache)
    expect(decrypted).toBe('secret')

    const encryptedNumber = await encryptCustomFieldValue(42, 'tenant-1', service, cache)
    const decryptedNumber = await decryptCustomFieldValue(encryptedNumber, 'tenant-1', service, cache)
    expect(decryptedNumber).toBe(42)
  })

  it('returns original value when encryption is disabled or tenant is missing', async () => {
    const disabledService = {
      isEnabled: () => false,
      getDek: async () => ({ key: fixedKey }),
    } as any
    expect(await encryptCustomFieldValue('plain', 'tenant-1', disabledService)).toBe('plain')
    expect(await decryptCustomFieldValue('plain', 'tenant-1', disabledService)).toBe('plain')
    expect(await encryptCustomFieldValue('plain', null, disabledService)).toBe('plain')
  })
})
