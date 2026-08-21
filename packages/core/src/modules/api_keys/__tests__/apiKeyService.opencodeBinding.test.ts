/**
 * Unit tests for the OpenCode-binding helpers added by the security fix
 * `.ai/specs/2026-05-23-fix-opencode-session-ownership.md`.
 *
 * Verifies that:
 *   1. `bindOpencodeSessionToApiKey` writes the binding on the first call.
 *   2. The same call is idempotent when the row already points at the
 *      same OpenCode session.
 *   3. The same call refuses to silently overwrite an existing binding.
 *   4. `findApiKeyByOpencodeSessionId` filters out expired rows.
 *   5. `findApiKeyByOpencodeSessionId` returns null when the row is
 *      soft-deleted.
 */

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  __esModule: true,
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import {
  bindOpencodeSessionToApiKey,
  findApiKeyByOpencodeSessionId,
} from '../services/apiKeyService'
import { ApiKey } from '../data/entities'

type RowShape = {
  id: string
  sessionToken: string
  sessionUserId: string
  tenantId: string | null
  organizationId: string | null
  opencodeSessionId?: string | null
  expiresAt: Date | null
  deletedAt: Date | null
}

function buildEm() {
  const flush = jest.fn().mockResolvedValue(undefined)
  const em = {
    findOne: jest.fn(),
    persist: jest.fn().mockImplementation(() => ({ flush })),
    flush,
  }
  return em
}

function makeRow(overrides: Partial<RowShape> = {}): RowShape {
  return {
    id: 'api-key-id',
    sessionToken: 'sess_alice',
    sessionUserId: 'user-alice',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    opencodeSessionId: null,
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('bindOpencodeSessionToApiKey', () => {
  it('writes the binding when the row has no OpenCode session yet', async () => {
    const row = makeRow()
    const em = buildEm()
    em.findOne.mockResolvedValueOnce(row)

    await bindOpencodeSessionToApiKey(em as any, 'sess_alice', 'ses_alice')

    expect(row.opencodeSessionId).toBe('ses_alice')
    expect(em.persist).toHaveBeenCalledWith(row)
    expect(em.flush).toHaveBeenCalled()
  })

  it('is idempotent when the row already points at the same OpenCode session', async () => {
    const row = makeRow({ opencodeSessionId: 'ses_alice' })
    const em = buildEm()
    em.findOne.mockResolvedValueOnce(row)

    await bindOpencodeSessionToApiKey(em as any, 'sess_alice', 'ses_alice')

    expect(row.opencodeSessionId).toBe('ses_alice')
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('throws when the row already points at a different OpenCode session', async () => {
    const row = makeRow({ opencodeSessionId: 'ses_original' })
    const em = buildEm()
    em.findOne.mockResolvedValueOnce(row)

    await expect(
      bindOpencodeSessionToApiKey(em as any, 'sess_alice', 'ses_attacker')
    ).rejects.toThrow(/already bound/)
    expect(row.opencodeSessionId).toBe('ses_original')
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('throws when the session token cannot be found or is expired', async () => {
    const em = buildEm()
    em.findOne.mockResolvedValueOnce(null)

    await expect(
      bindOpencodeSessionToApiKey(em as any, 'sess_missing', 'ses_alice')
    ).rejects.toThrow(/Session token not found or expired/)
    expect(em.persist).not.toHaveBeenCalled()
  })
})

describe('findApiKeyByOpencodeSessionId', () => {
  const em = buildEm() as any

  it('returns the row when it exists and is active', async () => {
    const row = makeRow({ opencodeSessionId: 'ses_alice' })
    mockFindOneWithDecryption.mockResolvedValueOnce(row)

    const result = await findApiKeyByOpencodeSessionId(em, 'ses_alice')

    expect(result).toBe(row)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      ApiKey,
      expect.objectContaining({ opencodeSessionId: 'ses_alice', deletedAt: null })
    )
  })

  it('returns null when the row is expired', async () => {
    const row = makeRow({
      opencodeSessionId: 'ses_alice',
      expiresAt: new Date(Date.now() - 60_000),
    })
    mockFindOneWithDecryption.mockResolvedValueOnce(row)

    const result = await findApiKeyByOpencodeSessionId(em, 'ses_alice')

    expect(result).toBeNull()
  })

  it('returns null when the row was soft-deleted (no match returned)', async () => {
    // The deletedAt: null filter inside findOneWithDecryption means a
    // soft-deleted row simply isn't returned by the underlying query.
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const result = await findApiKeyByOpencodeSessionId(em, 'ses_alice')

    expect(result).toBeNull()
  })

  it('returns null when no opencodeSessionId is supplied', async () => {
    const result = await findApiKeyByOpencodeSessionId(em, '')

    expect(result).toBeNull()
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
