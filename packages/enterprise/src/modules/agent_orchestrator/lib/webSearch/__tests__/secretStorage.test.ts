/**
 * Web-search adapter credentials were masked on the wire and stored in the
 * clear: `module_configs.value` held every tenant's SERP, Exa and Firecrawl key
 * as plaintext JSON. Masking protects the browser and does nothing for the row.
 *
 * These pin the three properties that make the fix trustworthy: the ciphertext
 * really is unreadable, only DECLARED secrets are touched, and a deployment
 * without encryption degrades visibly rather than silently.
 */
import { generateDek } from '@open-mercato/shared/lib/encryption/aes'
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
      if (name !== 'tenantDataEncryptionService') throw new Error(`unexpected resolve: ${name}`)
      return { isEnabled: () => enabled, getDek: async () => (dek ? { key: dek } : null) }
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
})
