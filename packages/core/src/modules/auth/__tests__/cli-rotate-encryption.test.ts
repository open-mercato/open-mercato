/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

const persist = jest.fn()
const flush = jest.fn()
const execute = jest.fn()
const find = jest.fn()
const getDek = jest.fn()
const encryptEntityPayload = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  decryptWithAesGcm: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: jest.fn().mockImplementation(() => ({
    isEnabled: () => true,
    getDek,
    encryptEntityPayload,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: () => ({
      getConnection: () => ({ execute }),
      getMetadata: () => ({ get: () => ({ tableName: 'users' }) }),
      find,
      persist,
      flush,
    }),
  })),
}))

describe('auth rotate-encryption-key CLI', () => {
  const rotate = cli.find((command) => command.command === 'rotate-encryption-key')!
  const encryptedValue = 'iv:cipher:tag:v1'
  let previousEncryptionToggle: string | undefined
  let previousOldKey: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    execute.mockReset()
    jest.mocked(decryptWithAesGcm).mockReset()
    getDek.mockReset().mockImplementation(async (tenantId: string) => ({ tenantId, key: 'new-key', fetchedAt: 0 }))
    encryptEntityPayload.mockReset().mockImplementation(async (_entityId: string, payload: Record<string, unknown>) => ({
      ...payload,
      email: `enc:${payload.email}`,
      emailHash: 'hash',
    }))
    previousEncryptionToggle = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    previousOldKey = process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
    delete process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
    find.mockImplementation(async (entity: unknown) => entity === Organization
      ? [{ id: 'org-1', tenant: { id: 'tenant-1' } }]
      : [])
    execute.mockResolvedValue([{ id: 'user-1' }])
  })

  afterEach(() => {
    if (previousEncryptionToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryptionToggle
    if (previousOldKey === undefined) delete process.env.TENANT_DATA_ENCRYPTION_OLD_KEY
    else process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = previousOldKey
  })

  it.each([null, 'old-hash'])('rotates ciphertext using the original email and hash %s', async (originalHash) => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: originalHash }])
    jest.mocked(decryptWithAesGcm).mockReturnValueOnce('user@example.com')
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'

    await rotate.run([])

    expect(decryptWithAesGcm).toHaveBeenCalled()
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining('SET email = ?, email_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND organization_id = ? AND email IS NOT DISTINCT FROM ? AND email_hash IS NOT DISTINCT FROM ? RETURNING id'),
      ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', encryptedValue, originalHash],
    )
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('rotates with the previous key from argv only through the unsafe bridge and warns', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])
    jest.mocked(decryptWithAesGcm).mockReturnValueOnce('user@example.com')
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      await rotate.run(['--allow-unsafe-old-key', '--old-key', 'old-secret', '--tenant', 'tenant-1', '--org', 'org-1'])

      expect(decryptWithAesGcm).toHaveBeenCalledWith(encryptedValue, expect.any(String))
      expect(execute).toHaveBeenLastCalledWith(
        expect.stringContaining('WHERE id = ? AND tenant_id = ? AND organization_id = ?'),
        ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', encryptedValue, null],
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TENANT_DATA_ENCRYPTION_OLD_KEY'))
    } finally {
      warn.mockRestore()
    }
  })

  it('rotates with the previous key from TENANT_DATA_ENCRYPTION_OLD_KEY without the argv warning', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])
    jest.mocked(decryptWithAesGcm).mockReturnValueOnce('user@example.com')
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

      expect(warn).not.toHaveBeenCalled()
      expect(execute).toHaveBeenLastCalledWith(
        expect.stringContaining('WHERE id = ? AND tenant_id = ? AND organization_id = ?'),
        ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', encryptedValue, null],
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('accepts an --old-key equal to TENANT_DATA_ENCRYPTION_OLD_KEY through the bridge', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])
    jest.mocked(decryptWithAesGcm).mockReturnValueOnce('user@example.com')
    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      await rotate.run(['--allow-unsafe-old-key', '--old-key', ' old-secret ', '--tenant', 'tenant-1', '--org', 'org-1'])

      expect(execute).toHaveBeenLastCalledWith(
        expect.stringContaining('WHERE id = ? AND tenant_id = ? AND organization_id = ?'),
        ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', encryptedValue, null],
      )
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('TENANT_DATA_ENCRYPTION_OLD_KEY'))
    } finally {
      warn.mockRestore()
    }
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
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      if (environmentKey !== undefined) process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = environmentKey

      await expect(rotate.run([...flags, '--tenant', 'tenant-1', '--org', 'org-1'])).rejects.toThrow(message)

      expect(createRequestContainer).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('encrypts plaintext through a scoped compare-and-swap without flushing managed entities', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: 'user@example.com', email_hash: null }])

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE id = ? AND tenant_id = ? AND organization_id = ?'),
      ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', 'user@example.com', null],
    )
    expect(find).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it.each([[], undefined, [{ id: 'user-1' }, { id: 'user-2' }]])('aborts when the guarded write does not return exactly one row: %j', async (result) => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: 'user@example.com', email_hash: 'original-hash' }])
      .mockResolvedValueOnce(result)
    const log = jest.spyOn(console, 'log').mockImplementation()
    try {
      await expect(rotate.run(['--tenant', 'tenant-1', '--org', 'org-1']))
        .rejects.toThrow('A row changed concurrently during auth encryption maintenance')
      expect(log.mock.calls.flat().join('\n')).not.toContain('Encrypted 1 auth user')
      expect(persist).not.toHaveBeenCalled()
      expect(flush).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('does not write or decrypt during a dry run', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])

    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1', '--dry-run'])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(decryptWithAesGcm).not.toHaveBeenCalled()
    expect(getDek).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('leaves existing ciphertext alone without an old key', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('rejects unrecoverable ciphertext without reporting success (explicit scope: %s)', async (explicitScope) => {
    execute.mockResolvedValueOnce([{ id: 'unrecoverable-user', email: encryptedValue, email_hash: 'original-hash' }])
    jest.mocked(decryptWithAesGcm).mockReturnValue(null)
    const log = jest.spyOn(console, 'log').mockImplementation()
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      const args = explicitScope ? ['--tenant', 'tenant-1', '--org', 'org-1'] : []
      process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
      await expect(rotate.run(args))
        .rejects.toThrow('1 auth user email(s) could not be rotated')

      expect(getDek).toHaveBeenCalledWith('tenant-1')
      expect(decryptWithAesGcm).toHaveBeenLastCalledWith(encryptedValue, 'new-key')
      expect(execute).toHaveBeenCalledTimes(1)
      expect(encryptEntityPayload).not.toHaveBeenCalled()
      const output = [...log.mock.calls, ...warn.mock.calls].flat().join('\n')
      expect(output).toContain('unrecoverable-user')
      expect(output).toContain('tenant=tenant-1 org=org-1')
      expect(output).not.toContain('already encrypted')
      expect(output).not.toContain(encryptedValue)
      expect(output).not.toContain('old-secret')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
  })

  it('recognizes real current-key ciphertext without rewriting or double encrypting it', async () => {
    const aes = jest.requireActual<typeof import('@open-mercato/shared/lib/encryption/aes')>('@open-mercato/shared/lib/encryption/aes')
    const currentKey = Buffer.alloc(32, 1).toString('base64')
    const currentEmail = aes.encryptWithAesGcm('current@example.com', currentKey).raw
    getDek.mockResolvedValue({ tenantId: 'tenant-1', key: currentKey, fetchedAt: 0 })
    execute.mockResolvedValueOnce([{ id: 'current-user', email: currentEmail, email_hash: 'current-hash' }])
    jest.mocked(decryptWithAesGcm).mockImplementation(aes.decryptWithAesGcm)

    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'

    await expect(rotate.run(['--tenant', 'tenant-1', '--org', 'org-1']))
      .resolves.toBeUndefined()

    expect(decryptWithAesGcm).toHaveBeenCalledTimes(2)
    expect(decryptWithAesGcm).toHaveBeenLastCalledWith(currentEmail, currentKey)
    expect(encryptEntityPayload).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('collects failures across organizations while rotating recoverable rows', async () => {
    find.mockResolvedValue([
      { id: 'org-1', tenant: { id: 'tenant-1' } },
      { id: 'org-2', tenant: { id: 'tenant-2' } },
    ])
    const oldEmail = 'iv:old:tag:v1'
    const currentEmail = 'iv:current:tag:v1'
    execute.mockResolvedValueOnce([
      { id: 'broken-1', email: encryptedValue, email_hash: null },
      { id: 'old-user', email: oldEmail, email_hash: 'old-hash' },
      { id: 'current-user', email: currentEmail, email_hash: 'current-hash' },
      { id: 'plaintext-user', email: 'plain@example.com', email_hash: null },
    ]).mockResolvedValueOnce([{ id: 'old-user' }])
      .mockResolvedValueOnce([{ id: 'broken-2', email: encryptedValue, email_hash: null }])
    jest.mocked(decryptWithAesGcm).mockImplementation((value, key) => {
      if (value === oldEmail) return 'old@example.com'
      if (value === currentEmail && key === 'new-key') return 'current@example.com'
      return null
    })
    const log = jest.spyOn(console, 'log').mockImplementation()
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'
      await expect(rotate.run([]))
        .rejects.toThrow('2 auth user email(s) could not be rotated')

      expect(encryptEntityPayload).toHaveBeenCalledTimes(1)
      expect(encryptEntityPayload).toHaveBeenCalledWith('auth:user', { email: 'old@example.com' }, 'tenant-1', 'org-1')
      expect(execute).toHaveBeenCalledTimes(3)
      const output = [...log.mock.calls, ...warn.mock.calls].flat().join('\n')
      expect(output).toContain('broken-1')
      expect(output).toContain('broken-2')
      expect(output).toContain('tenant=tenant-2 org=org-2')
      expect(output).not.toContain('Encrypted 1 auth user')
      expect(output).not.toContain('old@example.com')
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
  })

  it('fails when the previous key cannot decrypt and the current DEK is unavailable', async () => {
    getDek.mockResolvedValue(null)
    execute.mockResolvedValueOnce([{ id: 'broken-user', email: encryptedValue, email_hash: null }])
    jest.mocked(decryptWithAesGcm).mockReturnValue(null)

    process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'

    await expect(rotate.run(['--tenant', 'tenant-1', '--org', 'org-1']))
      .rejects.toThrow('1 auth user email(s) could not be rotated')

    expect(encryptEntityPayload).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('bounds unrecoverable row diagnostics while reporting the full count', async () => {
    execute.mockResolvedValueOnce(Array.from({ length: 22 }, (_, index) => ({
      id: `broken-${index}`, email: encryptedValue, email_hash: null,
    })))
    jest.mocked(decryptWithAesGcm).mockReturnValue(null)
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      process.env.TENANT_DATA_ENCRYPTION_OLD_KEY = 'old-secret'

    await expect(rotate.run(['--tenant', 'tenant-1', '--org', 'org-1']))
        .rejects.toThrow('22 auth user email(s) could not be rotated')

      const output = warn.mock.calls.flat().join('\n')
      expect(output).toContain('row=broken-19')
      expect(output).not.toContain('row=broken-20')
      expect(output).toContain('and 2 more')
      expect(getDek).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
