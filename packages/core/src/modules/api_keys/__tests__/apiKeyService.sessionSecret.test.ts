/**
 * MCP and the AI chat authenticate by session token, and that only works if the ephemeral key's
 * secret can be handed back later — `session_secret_encrypted` exists for no other reason.
 *
 * It used to be written only when a DEK was reachable, which is never true under
 * `TENANT_DATA_ENCRYPTION=no`. The column stayed null, `findSessionApiKeyWithSecret` returned null,
 * and the only trace was a debug-level log: MCP session auth was simply off for anyone who had
 * disabled encryption, with nothing to point at.
 */

const mockCreateKmsService = jest.fn()

// `resolveEncryptionMode` stays real — it is the disabled/unavailable split under test.
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: (...args: unknown[]) => mockCreateKmsService(...args),
}))

import { generateDek, looksLikeEncryptedPayload } from '@open-mercato/shared/lib/encryption/aes'
import { createSessionApiKey, findSessionApiKeyWithSecret } from '../services/apiKeyService'

const TENANT = 'tenant-1'
const previousToggle = process.env.TENANT_DATA_ENCRYPTION

function mockKms(dek: string | null) {
  mockCreateKmsService.mockReturnValue({
    isHealthy: () => Boolean(dek),
    getTenantDek: jest.fn(async (tenantId: string) => (dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null)),
    createTenantDek: jest.fn(async (tenantId: string) => (dek ? { tenantId, key: dek, fetchedAt: Date.now() } : null)),
  })
}

function buildEm() {
  const created: Array<Record<string, unknown>> = []
  const flush = jest.fn().mockResolvedValue(undefined)
  const em = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `key-${created.length + 1}`, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(() => ({ flush })),
    flush,
    // `findApiKeyBySessionToken` reads the row back through the plain EntityManager.
    findOne: jest.fn(async () => created[0] ?? null),
  }
  return { em, created }
}

/** Round-trip a freshly minted session key through storage and back out again. */
async function roundTrip(): Promise<{ stored: unknown; recovered: string | null }> {
  const { em, created } = buildEm()
  await createSessionApiKey(em as never, {
    sessionToken: 'sess_alice',
    userId: 'user-alice',
    userRoles: ['admin'],
    tenantId: TENANT,
    organizationId: 'org-1',
  })
  const row = created[0]
  const result = await findSessionApiKeyWithSecret(em as never, 'sess_alice')
  return { stored: row.sessionSecretEncrypted, recovered: result?.secret ?? null }
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
  else process.env.TENANT_DATA_ENCRYPTION = previousToggle
})

describe('session secret storage', () => {
  it('seals the secret when encryption is active', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())

    const { stored, recovered } = await roundTrip()

    expect(looksLikeEncryptedPayload(stored)).toBe(true)
    expect(recovered).toEqual(expect.any(String))
    expect(recovered).not.toEqual(stored)
  })

  it('round-trips the secret in the clear when the operator disabled encryption', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    mockKms(null)

    const { stored, recovered } = await roundTrip()

    expect(stored).toEqual(expect.any(String))
    expect(looksLikeEncryptedPayload(stored)).toBe(false)
    expect(recovered).toBe(stored)
  })

  it('still refuses to store a secret in the clear when the KMS is merely unreachable', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(null)

    const { stored, recovered } = await roundTrip()

    // A Vault outage must not silently downgrade a secret nobody asked to store in plaintext.
    expect(stored).toBeNull()
    expect(recovered).toBeNull()
  })

  it('gives up honestly on a secret sealed before the toggle was flipped off', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    mockKms(generateDek())
    const { em, created } = buildEm()
    await createSessionApiKey(em as never, {
      sessionToken: 'sess_alice',
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })
    const sealed = created[0]

    process.env.TENANT_DATA_ENCRYPTION = 'no'
    mockKms(null)
    expect(sealed.sessionSecretEncrypted).toEqual(expect.any(String))

    // Handing the envelope back as if it were the secret would authenticate nothing and look like
    // a wrong password; null at least routes the caller to re-issue the session key.
    await expect(findSessionApiKeyWithSecret(em as never, 'sess_alice')).resolves.toBeNull()
  })
})
