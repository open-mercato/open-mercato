/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const persist = jest.fn()
const flush = jest.fn()
const execute = jest.fn()
const find = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  decryptWithAesGcm: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek: jest.fn(async (tenantId: string) => ({ tenantId, key: 'new-key', fetchedAt: 0 })),
    encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      email: `enc:${payload.email}`,
      emailHash: 'hash',
    })),
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({
      getConnection: () => ({ execute }),
      getMetadata: () => ({ get: () => ({ tableName: 'users' }) }),
      find: (...args: any[]) => find(...args),
      persist,
      flush,
    }),
  }),
}))

describe('auth rotate-encryption-key CLI', () => {
  const originalOldKey = process.env.TENANT_DATA_ENCRYPTION_OLD_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    delete process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalOldKey === undefined) delete process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
    else process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = originalOldKey
  })

  const mockEncryptedUser = () => {
    const encryptedValue = 'iv:cipher:tag:v1'
    find.mockImplementation(async (entity: unknown) => {
      if (entity === Organization) {
        return [{ id: 'org-1', tenant: { id: 'tenant-1' } }]
      }
      if (entity === User) {
        return [{ id: 'user-1', email: encryptedValue, emailHash: null }]
      }
      return []
    })
    execute.mockResolvedValue([{ id: 'user-1', email: encryptedValue, email_hash: null }])
    ;(decryptWithAesGcm as jest.Mock).mockReturnValueOnce('user@example.com')
  }

  it('rotates encrypted emails with old key and uses raw find', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockEncryptedUser()

    await rotate.run(['--allow-unsafe-old-key', '--old-key', 'old-secret'])

    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(decryptWithAesGcm).toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ email: 'enc:user@example.com' }))
    expect(flush).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TENANT_DATA_ENCRYPTION_OLD_KEY'))
  })

  it('rotates with the previous key from TENANT_DATA_ENCRYPTION_OLD_KEY', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
    mockEncryptedUser()

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(warnSpy).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(decryptWithAesGcm).toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ email: 'enc:user@example.com' }))
    expect(flush).toHaveBeenCalled()
  })

  it('rejects argv key material unless the unsafe compatibility bridge is explicit', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!

    await expect(rotate.run(['--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1'])).rejects.toThrow('--allow-unsafe-old-key')

    expect(execute).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('rejects argv key material when the unsafe compatibility bridge is explicitly false', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!

    await expect(
      rotate.run(['--allow-unsafe-old-key=false', '--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1']),
    ).rejects.toThrow('--allow-unsafe-old-key')

    expect(execute).not.toHaveBeenCalled()
  })

  it('accepts an --old-key equal to TENANT_DATA_ENCRYPTION_OLD_KEY through the bridge', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
    mockEncryptedUser()

    await rotate.run(['--allow-unsafe-old-key', '--old-key', ' old-secret ', '--tenant', 'tenant-1', '--org', 'org-1'])

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ email: 'enc:user@example.com' }))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TENANT_DATA_ENCRYPTION_OLD_KEY'))
  })

  it('rejects an --old-key that differs from TENANT_DATA_ENCRYPTION_OLD_KEY', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'environment-secret'

    await expect(
      rotate.run(['--allow-unsafe-old-key', '--old-key', 'argument-secret', '--tenant', 'tenant-1', '--org', 'org-1']),
    ).rejects.toThrow('contain different values')

    expect(execute).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('encrypts plaintext emails without old key using findWithDecryption', async () => {
    const rotate = cli.find((c: any) => c.command === 'rotate-encryption-key')!
    const plaintextEmail = 'user@example.com'

    find.mockImplementation(async (entity: any) => {
      if (entity === Organization) {
        return [{ id: 'org-1', tenant: { id: 'tenant-1' } }]
      }
      return []
    })

    execute.mockResolvedValue([{ id: 'user-1', email: plaintextEmail, email_hash: null }])
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { id: 'user-1', email: plaintextEmail, emailHash: null },
    ])

    await rotate.run([])

    expect(findWithDecryption).toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ email: 'enc:user@example.com' }))
  })
})
