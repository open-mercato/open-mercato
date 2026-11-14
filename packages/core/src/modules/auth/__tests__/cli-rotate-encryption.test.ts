/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

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
  createRequestContainer: jest.fn(async () => ({
    resolve: () => ({
      getConnection: () => ({ execute }),
      getMetadata: () => ({ get: () => ({ tableName: 'users' }) }),
      find: (...args: any[]) => find(...args),
      persist,
      flush,
    }),
  })),
}))

describe('auth rotate-encryption-key CLI', () => {
  const originalOldKey = process.env.TENANT_DATA_ENCRYPTION_OLD_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    find.mockReset()
    execute.mockReset()
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
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
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

  it('leaves plaintext emails alone while TENANT_DATA_ENCRYPTION_OLD_KEY is set', async () => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
    find.mockResolvedValue([{ id: 'user-1', email: 'user@example.com', emailHash: null }])
    execute.mockResolvedValue([{ id: 'user-1', email: 'user@example.com', email_hash: null }])
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(execute).toHaveBeenCalled()
    expect(find).toHaveBeenCalledWith(User, expect.anything())
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(decryptWithAesGcm).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
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

  it.each<{ name: string; flags: string[]; message: string; environmentKey?: string }>([
    { name: 'argv key material without the unsafe bridge', flags: ['--old-key', 'old-secret'], message: '--allow-unsafe-old-key' },
    { name: 'the --old-key=<value> form without the unsafe bridge', flags: ['--old-key=old-secret'], message: '--allow-unsafe-old-key' },
    { name: 'the --oldKey alias without the unsafe bridge', flags: ['--oldKey', 'old-secret'], message: '--allow-unsafe-old-key' },
    {
      name: 'an --old-key equal to TENANT_DATA_ENCRYPTION_OLD_KEY without the unsafe bridge',
      flags: ['--old-key', 'old-secret'],
      message: '--allow-unsafe-old-key',
      environmentKey: 'old-secret',
    },
    { name: 'an unsafe bridge set to false', flags: ['--allow-unsafe-old-key=false', '--old-key', 'old-secret'], message: '--allow-unsafe-old-key' },
    { name: 'a bare --old-key flag', flags: ['--allow-unsafe-old-key', '--old-key'], message: '--old-key requires a value' },
    { name: 'an empty --old-key value', flags: ['--allow-unsafe-old-key', '--old-key='], message: '--old-key requires a value' },
    { name: 'a whitespace-only --old-key value', flags: ['--allow-unsafe-old-key', '--old-key', '  '], message: '--old-key requires a value' },
    {
      name: 'an --old-key that differs from TENANT_DATA_ENCRYPTION_OLD_KEY',
      flags: ['--allow-unsafe-old-key', '--old-key', 'argument-secret'],
      message: 'contain different values',
      environmentKey: 'environment-secret',
    },
    { name: 'an empty TENANT_DATA_ENCRYPTION_OLD_KEY', flags: [], message: 'TENANT_DATA_ENCRYPTION_OLD_KEY is set but empty', environmentKey: '' },
    { name: 'a whitespace-only TENANT_DATA_ENCRYPTION_OLD_KEY', flags: [], message: 'TENANT_DATA_ENCRYPTION_OLD_KEY is set but empty', environmentKey: '   ' },
  ])('rejects $name before opening the database', async ({ flags, message, environmentKey }) => {
    const rotate = cli.find((c) => c.command === 'rotate-encryption-key')!
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    if (environmentKey !== undefined) process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = environmentKey

    await expect(rotate.run([...flags, '--tenant', 'tenant-1', '--org', 'org-1'])).rejects.toThrow(message)

    expect(createRequestContainer).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
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
