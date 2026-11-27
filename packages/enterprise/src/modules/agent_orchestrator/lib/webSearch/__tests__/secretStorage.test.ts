/**
 * Web-search adapter credentials were masked on the wire and stored in the
 * clear: `module_configs.value` held every tenant's SERP, Exa and Firecrawl key
 * as plaintext JSON. Masking protects the browser and does nothing for the row.
 *
 * These pin the three properties that make the fix trustworthy: the ciphertext
 * really is unreadable, only DECLARED secrets are touched, and a deployment
 * without encryption degrades visibly rather than silently.
 */
import { asValue, createContainer } from 'awilix'
import { generateDek, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import {
  canEncryptSecrets,
  decryptAdapterSecrets,
  encryptAdapterSecrets,
  type AdapterSecretFields,
} from '../secretStorage'

const FIELDS: AdapterSecretFields = {
  serp: [
    { name: 'apiKey', secret: true },
    { name: 'endpoint' },
  ],
  'model-native': [{ name: 'maxResults' }],
}

const containerWith = (dek: string | null, enabled = true) =>
  ({
    resolve: (name: string) => {
      if (name !== 'tenantEncryptionService') throw new Error(`unexpected resolve: ${name}`)
      return {
        isEnabled: () => enabled,
        getDek: async () => (dek ? { key: dek } : null),
        createDek: async () => null,
      }
    },
  }) as never

describe('adapter secret storage', () => {
  const dek = generateDek()

  it('makes the stored key unreadable and round-trips it', async () => {
    const container = containerWith(dek)
    const options = { serp: { apiKey: 'sk-live-abc123', endpoint: 'https://serp.example' } }

    const { adapterOptions: stored, encrypted } = await encryptAdapterSecrets(
      container,
      'tenant-1',
      options,
      FIELDS,
    )

    expect(encrypted).toBe(true)
    const storedKey = (stored.serp as Record<string, unknown>).apiKey as string
    expect(storedKey).not.toBe('sk-live-abc123')
    expect(storedKey).not.toContain('sk-live')

    const back = await decryptAdapterSecrets(container, 'tenant-1', stored, FIELDS)
    expect((back.serp as Record<string, unknown>).apiKey).toBe('sk-live-abc123')
  })

  it('touches only the fields the adapter declared secret', async () => {
    const container = containerWith(dek)
    const { adapterOptions: stored } = await encryptAdapterSecrets(
      container,
      'tenant-1',
      { serp: { apiKey: 'sk-live', endpoint: 'https://serp.example' }, 'model-native': { maxResults: 5 } },
      FIELDS,
    )
    // A non-secret field encrypted by accident becomes unreadable to anyone
    // reading the row for diagnostics, for no gain.
    expect((stored.serp as Record<string, unknown>).endpoint).toBe('https://serp.example')
    expect((stored['model-native'] as Record<string, unknown>).maxResults).toBe(5)
  })

  it('does not double-encrypt on a re-save', async () => {
    // The settings PUT restores unchanged secrets from the stored row, so on
    // every save most values arrive already encrypted.
    const container = containerWith(dek)
    const first = await encryptAdapterSecrets(container, 't', { serp: { apiKey: 'sk' } }, FIELDS)
    const second = await encryptAdapterSecrets(container, 't', first.adapterOptions, FIELDS)

    expect((second.adapterOptions.serp as Record<string, unknown>).apiKey).toBe(
      (first.adapterOptions.serp as Record<string, unknown>).apiKey,
    )
    const back = await decryptAdapterSecrets(container, 't', second.adapterOptions, FIELDS)
    expect((back.serp as Record<string, unknown>).apiKey).toBe('sk')
  })

  it('reports the degradation instead of hiding it when there is no key', async () => {
    const container = containerWith(null)
    const result = await encryptAdapterSecrets(container, 't', { serp: { apiKey: 'sk' } }, FIELDS)

    // Storing plaintext is survivable; believing it is encrypted is not.
    expect(result.encrypted).toBe(false)
    expect((result.adapterOptions.serp as Record<string, unknown>).apiKey).toBe('sk')
    expect(await canEncryptSecrets(container, 't')).toBe(false)
  })

  it('reports the degradation when encryption is switched off entirely', async () => {
    const container = containerWith(dek, false)
    expect(await canEncryptSecrets(container, 't')).toBe(false)
    expect((await encryptAdapterSecrets(container, 't', { serp: { apiKey: 'sk' } }, FIELDS)).encrypted).toBe(
      false,
    )
  })

  it('passes through a plaintext key written before this shipped', async () => {
    // Dropping it would break a working adapter to prove a point.
    const container = containerWith(dek)
    const back = await decryptAdapterSecrets(container, 't', { serp: { apiKey: 'legacy-plain' } }, FIELDS)
    expect((back.serp as Record<string, unknown>).apiKey).toBe('legacy-plain')
  })

  it('survives an absent encryption service', async () => {
    const container = {
      resolve: () => {
        throw new Error('not registered')
      },
    } as never
    expect(await canEncryptSecrets(container, 't')).toBe(false)
    expect(
      (await decryptAdapterSecrets(container, 't', { serp: { apiKey: 'x' } }, FIELDS)).serp,
    ).toEqual({ apiKey: 'x' })
  })

  it('ignores an adapter with no declared secrets and a malformed entry', async () => {
    const container = containerWith(dek)
    const { adapterOptions } = await encryptAdapterSecrets(
      container,
      't',
      { unknownAdapter: { apiKey: 'sk' }, broken: null },
      FIELDS,
    )
    expect((adapterOptions.unknownAdapter as Record<string, unknown>).apiKey).toBe('sk')
    expect(adapterOptions.broken).toBeNull()
  })

  describe('against the real TenantDataEncryptionService under its bootstrap DI name', () => {
    // The helper used to resolve `tenantDataEncryptionService`, a name nothing
    // registers: the resolve threw, the catch returned null, and every key was
    // written in plaintext while the mocks above — keyed by the same wrong name —
    // stayed green. This wires the service exactly as core bootstrap does.
    const originalToggle = process.env.TENANT_DATA_ENCRYPTION
    beforeEach(() => {
      process.env.TENANT_DATA_ENCRYPTION = 'yes'
    })
    afterEach(() => {
      if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    })

    const bootstrapContainer = (tenantId: string, existingDek: string | null) => {
      const deks = new Map<string, string>()
      if (existingDek) deks.set(tenantId, existingDek)
      const toDek = (id: string) => {
        const key = deks.get(id)
        return key ? { tenantId: id, key, fetchedAt: Date.now() } : null
      }
      const kms = {
        isHealthy: () => true,
        getTenantDek: jest.fn(async (id: string) => toDek(id)),
        createTenantDek: jest.fn(async (id: string) => {
          deks.set(id, generateDek())
          return toDek(id)
        }),
      }
      const service = new TenantDataEncryptionService({} as never, { kms: kms as never })
      const container = createContainer()
      container.register({ tenantEncryptionService: asValue(service) })
      return { container: container as never, kms, deks }
    }

    it('stores a declared secret as an iv:ct:tag:v1 envelope', async () => {
      const tenantId = `tenant-envelope-${Date.now()}`
      const { container, deks } = bootstrapContainer(tenantId, generateDek())

      const { adapterOptions: stored, encrypted } = await encryptAdapterSecrets(
        container,
        tenantId,
        { serp: { apiKey: 'sk-live-real', endpoint: 'https://serp.example' } },
        FIELDS,
      )

      expect(encrypted).toBe(true)
      const storedKey = (stored.serp as Record<string, unknown>).apiKey as string
      expect(storedKey).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:v1$/)
      expect(isEncryptedPayloadShape(storedKey)).toBe(true)
      expect(storedKey).not.toContain('sk-live')
      expect(deks.get(tenantId)).toBeDefined()
      expect(await canEncryptSecrets(container, tenantId)).toBe(true)

      const back = await decryptAdapterSecrets(container, tenantId, stored, FIELDS)
      expect((back.serp as Record<string, unknown>).apiKey).toBe('sk-live-real')
    })

    it('reads a legacy plaintext key and re-seals it on the next save', async () => {
      const tenantId = `tenant-legacy-${Date.now()}`
      const { container } = bootstrapContainer(tenantId, generateDek())
      const legacyRow = { serp: { apiKey: 'legacy-plain' } }

      const read = await decryptAdapterSecrets(container, tenantId, legacyRow, FIELDS)
      expect((read.serp as Record<string, unknown>).apiKey).toBe('legacy-plain')

      const { adapterOptions: resaved, encrypted } = await encryptAdapterSecrets(
        container,
        tenantId,
        read,
        FIELDS,
      )
      expect(encrypted).toBe(true)
      const sealed = (resaved.serp as Record<string, unknown>).apiKey as string
      expect(isEncryptedPayloadShape(sealed)).toBe(true)
      const back = await decryptAdapterSecrets(container, tenantId, resaved, FIELDS)
      expect((back.serp as Record<string, unknown>).apiKey).toBe('legacy-plain')
    })

    it('provisions a DEK on first save, but never from the preview', async () => {
      const tenantId = `tenant-fresh-${Date.now()}`
      const { container, kms } = bootstrapContainer(tenantId, null)

      expect(await canEncryptSecrets(container, tenantId)).toBe(false)
      expect(kms.createTenantDek).not.toHaveBeenCalled()

      const { adapterOptions: stored, encrypted } = await encryptAdapterSecrets(
        container,
        tenantId,
        { serp: { apiKey: 'sk-first' } },
        FIELDS,
      )
      expect(encrypted).toBe(true)
      expect(kms.createTenantDek).toHaveBeenCalledTimes(1)
      expect(isEncryptedPayloadShape((stored.serp as Record<string, unknown>).apiKey)).toBe(true)
      expect(await canEncryptSecrets(container, tenantId)).toBe(true)
    })
  })
})
