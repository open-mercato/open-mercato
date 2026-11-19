/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'

const persist = jest.fn()
const flush = jest.fn()
const execute = jest.fn()
const find = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  decryptWithAesGcm: jest.fn(),
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
      find,
      persist,
      flush,
    }),
  }),
}))

describe('auth rotate-encryption-key CLI', () => {
  const rotate = cli.find((command) => command.command === 'rotate-encryption-key')!
  const encryptedValue = 'iv:cipher:tag:v1'
  let previousEncryptionToggle: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    execute.mockReset()
    jest.mocked(decryptWithAesGcm).mockReset()
    previousEncryptionToggle = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    find.mockImplementation(async (entity: unknown) => entity === Organization
      ? [{ id: 'org-1', tenant: { id: 'tenant-1' } }]
      : [])
    execute.mockResolvedValue([{ id: 'user-1' }])
  })

  afterEach(() => {
    if (previousEncryptionToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousEncryptionToggle
  })

  it.each([null, 'old-hash'])('rotates ciphertext using the original email and hash %s', async (originalHash) => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: originalHash }])
    jest.mocked(decryptWithAesGcm).mockReturnValueOnce('user@example.com')

    await rotate.run(['--old-key', 'old-secret'])

    expect(decryptWithAesGcm).toHaveBeenCalled()
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining('SET email = ?, email_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND organization_id = ? AND email IS NOT DISTINCT FROM ? AND email_hash IS NOT DISTINCT FROM ? RETURNING id'),
      ['enc:user@example.com', 'hash', 'user-1', 'tenant-1', 'org-1', encryptedValue, originalHash],
    )
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
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

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1', '--old-key', 'old-secret', '--dry-run'])

    expect(execute).toHaveBeenCalledTimes(1)
    expect(decryptWithAesGcm).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('leaves existing ciphertext alone without an old key', async () => {
    execute.mockResolvedValueOnce([{ id: 'user-1', email: encryptedValue, email_hash: null }])

    await rotate.run(['--tenant', 'tenant-1', '--org', 'org-1'])

    expect(execute).toHaveBeenCalledTimes(1)
  })
})
