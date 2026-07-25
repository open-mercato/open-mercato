import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  createApiKey: jest.fn(),
  deleteApiKey: jest.fn(),
  findApiKeyBySecret: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import {
  createApiKey,
  deleteApiKey,
  findApiKeyBySecret,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureMcpApiKey, DEFAULT_MCP_KEY_NAME } from '../mcp-ensure-api-key'

const mockedCreateApiKey = createApiKey as jest.Mock
const mockedDeleteApiKey = deleteApiKey as jest.Mock
const mockedFindApiKeyBySecret = findApiKeyBySecret as jest.Mock
const mockedFindOneWithDecryption = findOneWithDecryption as jest.Mock
const mockedFindWithDecryption = findWithDecryption as jest.Mock

const owner = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'superadmin@acme.com',
}

function createEm() {
  return { find: jest.fn().mockResolvedValue([]) } as any
}

describe('ensureMcpApiKey', () => {
  let workDir: string
  let filePath: string

  beforeEach(async () => {
    jest.clearAllMocks()
    workDir = await fs.mkdtemp(join(tmpdir(), 'mcp-key-test-'))
    filePath = join(workDir, 'shared', 'mcp-api-key')
    mockedFindOneWithDecryption.mockResolvedValue(owner)
    mockedFindWithDecryption.mockResolvedValue([{ role: { id: 'role-1' } }])
    mockedCreateApiKey.mockResolvedValue({
      record: { id: 'key-new', keyPrefix: 'omk_new.' },
      secret: 'omk_new1.aaaabbbbccccddddeeeeffff',
    })
  })

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('returns valid without touching the DB when the file secret resolves to a live key of the same name', async () => {
    await fs.mkdir(join(workDir, 'shared'), { recursive: true })
    await fs.writeFile(filePath, 'omk_old1.secret\n')
    mockedFindApiKeyBySecret.mockResolvedValue({
      id: 'key-old',
      name: DEFAULT_MCP_KEY_NAME,
      keyPrefix: 'omk_old1.sec',
    })

    const em = createEm()
    const result = await ensureMcpApiKey({ em, filePath })

    expect(result).toEqual({ status: 'valid', keyId: 'key-old', keyPrefix: 'omk_old1.sec' })
    expect(mockedCreateApiKey).not.toHaveBeenCalled()
    expect(mockedDeleteApiKey).not.toHaveBeenCalled()
    expect((await fs.readFile(filePath, 'utf8')).trim()).toBe('omk_old1.secret')
  })

  it('creates a key owned by the superadmin and writes the secret file when no file exists', async () => {
    const em = createEm()
    const result = await ensureMcpApiKey({ em, filePath })

    expect(result).toEqual({ status: 'created', keyId: 'key-new', keyPrefix: 'omk_new.' })
    expect(mockedCreateApiKey).toHaveBeenCalledWith(
      em,
      expect.objectContaining({
        name: DEFAULT_MCP_KEY_NAME,
        tenantId: 'tenant-1',
        organizationId: null,
        roles: ['role-1'],
        createdBy: 'user-1',
      }),
      expect.anything(),
    )
    expect((await fs.readFile(filePath, 'utf8')).trim()).toBe('omk_new1.aaaabbbbccccddddeeeeffff')
  })

  it('resolves the owner with an encrypted-email-aware $or filter', async () => {
    const em = createEm()
    await ensureMcpApiKey({ em, filePath })

    expect(mockedFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({
        deletedAt: null,
        $or: expect.arrayContaining([
          { email: 'superadmin@acme.com' },
          expect.objectContaining({ emailHash: expect.anything() }),
        ]),
      }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('scopes stale-key cleanup to the owner tenant', async () => {
    const em = createEm()
    await ensureMcpApiKey({ em, filePath })

    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: DEFAULT_MCP_KEY_NAME, tenantId: 'tenant-1', deletedAt: null }),
    )
  })

  it('soft-deletes stale keys with the same name before creating a replacement', async () => {
    await fs.mkdir(join(workDir, 'shared'), { recursive: true })
    await fs.writeFile(filePath, 'omk_stale.secret\n')
    mockedFindApiKeyBySecret.mockResolvedValue(null)

    const em = createEm()
    em.find.mockResolvedValue([{ id: 'stale-1' }, { id: 'stale-2' }])

    const result = await ensureMcpApiKey({ em, filePath })

    expect(result.status).toBe('created')
    expect(mockedDeleteApiKey).toHaveBeenCalledTimes(2)
    expect(mockedDeleteApiKey).toHaveBeenCalledWith(em, 'stale-1', expect.anything())
    expect(mockedDeleteApiKey).toHaveBeenCalledWith(em, 'stale-2', expect.anything())
  })

  it('rotates even when the file secret is valid if rotate is set', async () => {
    await fs.mkdir(join(workDir, 'shared'), { recursive: true })
    await fs.writeFile(filePath, 'omk_old1.secret\n')
    mockedFindApiKeyBySecret.mockResolvedValue({
      id: 'key-old',
      name: DEFAULT_MCP_KEY_NAME,
      keyPrefix: 'omk_old1.sec',
    })

    const em = createEm()
    const result = await ensureMcpApiKey({ em, filePath, rotate: true })

    expect(result.status).toBe('created')
    expect(mockedFindApiKeyBySecret).not.toHaveBeenCalled()
    expect((await fs.readFile(filePath, 'utf8')).trim()).toBe('omk_new1.aaaabbbbccccddddeeeeffff')
  })

  it('rotates when the file secret resolves to a key with a different name', async () => {
    await fs.mkdir(join(workDir, 'shared'), { recursive: true })
    await fs.writeFile(filePath, 'omk_old1.secret\n')
    mockedFindApiKeyBySecret.mockResolvedValue({
      id: 'key-other',
      name: '__session_something__',
      keyPrefix: 'omk_old1.sec',
    })

    const em = createEm()
    const result = await ensureMcpApiKey({ em, filePath })

    expect(result.status).toBe('created')
    expect(mockedCreateApiKey).toHaveBeenCalled()
  })

  it('throws a clear error when the owner user does not exist', async () => {
    mockedFindOneWithDecryption.mockResolvedValue(null)

    const em = createEm()
    await expect(ensureMcpApiKey({ em, filePath })).rejects.toThrow(/owner not found/)
    expect(mockedCreateApiKey).not.toHaveBeenCalled()
  })
})
