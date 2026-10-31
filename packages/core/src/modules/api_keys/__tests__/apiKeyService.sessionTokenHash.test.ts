/**
 * #2254: the AI-chat session token is a bearer credential — it unlocks the decrypted API
 * key secret and the user's ACL on the MCP server — so it must never be persisted or looked
 * up in the clear. These tests pin the hash-based storage/lookup contract.
 */

import { createHash } from 'node:crypto'
import {
  createSessionApiKey,
  findApiKeyBySessionToken,
  deleteSessionApiKey,
  hashSessionToken,
} from '../services/apiKeyService'

const TENANT = 'tenant-1'
const SESSION_TOKEN = 'sess_alice_plaintext_token'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildEm() {
  const created: Array<Record<string, unknown>> = []
  const flush = jest.fn().mockResolvedValue(undefined)
  let inTransaction = false
  const em = {
    create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `key-${created.length + 1}`, deletedAt: null, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(() => ({ flush })),
    flush,
    find: jest.fn(async () => created.slice()),
    findOne: jest.fn(async (_Entity: unknown, where: Record<string, unknown>) => {
      const row = created.find((candidate) => (
        Object.entries(where).every(([key, value]) => value == null || candidate[key] === value)
      ))
      return row ?? null
    }),
    isInTransaction: () => inTransaction,
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
  }
  return { em, created }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hashSessionToken', () => {
  it('is a plain SHA-256 hex digest', () => {
    expect(hashSessionToken(SESSION_TOKEN)).toBe(sha256Hex(SESSION_TOKEN))
  })

  it('never matches the raw token', () => {
    expect(hashSessionToken(SESSION_TOKEN)).not.toBe(SESSION_TOKEN)
  })
})

describe('createSessionApiKey', () => {
  it('stores the hash, never the plaintext session token, on the row', async () => {
    const { em, created } = buildEm()

    await createSessionApiKey(em as never, {
      sessionToken: SESSION_TOKEN,
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })

    const row = created[0]
    expect(row.sessionTokenHash).toBe(sha256Hex(SESSION_TOKEN))
    expect(row.sessionTokenHash).not.toBe(SESSION_TOKEN)
    expect(Object.values(row)).not.toContain(SESSION_TOKEN)
  })

  it('does not embed the raw token in the row name either', async () => {
    const { em, created } = buildEm()

    await createSessionApiKey(em as never, {
      sessionToken: SESSION_TOKEN,
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })

    expect(created[0].name as string).not.toContain(SESSION_TOKEN)
  })

  it('still returns the plaintext token to the caller at issuance', async () => {
    const { em } = buildEm()

    const result = await createSessionApiKey(em as never, {
      sessionToken: SESSION_TOKEN,
      userId: 'user-alice',
      userRoles: ['admin'],
      tenantId: TENANT,
      organizationId: 'org-1',
    })

    expect(result.sessionToken).toBe(SESSION_TOKEN)
  })
})

describe('findApiKeyBySessionToken', () => {
  it('looks up by hash, not by the raw token', async () => {
    const { em, created } = buildEm()
    await createSessionApiKey(em as never, {
      sessionToken: SESSION_TOKEN,
      userId: 'user-alice',
      userRoles: [],
      tenantId: TENANT,
      organizationId: 'org-1',
    })
    ;(em.findOne as jest.Mock).mockClear()

    const found = await findApiKeyBySessionToken(em as never, SESSION_TOKEN)

    expect(found).toBe(created[0])
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionTokenHash: sha256Hex(SESSION_TOKEN) }),
    )
    const [, where] = (em.findOne as jest.Mock).mock.calls[0]
    expect(where).not.toHaveProperty('sessionToken')
  })

  it('returns null for a token that was never issued', async () => {
    const { em } = buildEm()

    await expect(findApiKeyBySessionToken(em as never, 'sess_never_issued')).resolves.toBeNull()
  })

  it('#7304: falls back to a legacy plaintext-only row and self-heals it onto the hash', async () => {
    const { em, created } = buildEm()
    // A row minted by pre-#2254 code during a deploy window: plaintext only, no hash yet.
    created.push({
      id: 'legacy-key-1',
      deletedAt: null,
      sessionToken: SESSION_TOKEN,
      sessionTokenHash: null,
      expiresAt: null,
    })

    const found = await findApiKeyBySessionToken(em as never, SESSION_TOKEN)

    expect(found).toBe(created[0])
    expect(created[0].sessionTokenHash).toBe(sha256Hex(SESSION_TOKEN))
    expect(created[0].sessionToken).toBeNull()
    expect(em.flush).toHaveBeenCalled()

    // Self-healed: a second lookup resolves by hash alone, no fallback needed.
    ;(em.findOne as jest.Mock).mockClear()
    const foundAgain = await findApiKeyBySessionToken(em as never, SESSION_TOKEN)
    expect(foundAgain).toBe(created[0])
    expect(em.findOne).toHaveBeenCalledTimes(1)
  })
})

describe('deleteSessionApiKey', () => {
  it('soft-deletes the row matched by hash', async () => {
    const { em, created } = buildEm()
    await createSessionApiKey(em as never, {
      sessionToken: SESSION_TOKEN,
      userId: 'user-alice',
      userRoles: [],
      tenantId: TENANT,
      organizationId: 'org-1',
    })

    await deleteSessionApiKey(em as never, SESSION_TOKEN)

    expect(created[0].deletedAt).not.toBeNull()
  })

  it('is a no-op for a token that does not resolve to any row', async () => {
    const { em } = buildEm()

    await expect(deleteSessionApiKey(em as never, 'sess_never_issued')).resolves.toBeUndefined()
  })

  it('#7304: can delete a legacy plaintext-only row, self-healing it first', async () => {
    const { em, created } = buildEm()
    created.push({
      id: 'legacy-key-1',
      deletedAt: null,
      sessionToken: SESSION_TOKEN,
      sessionTokenHash: null,
      expiresAt: null,
    })

    await deleteSessionApiKey(em as never, SESSION_TOKEN)

    expect(created[0].deletedAt).not.toBeNull()
    expect(created[0].sessionTokenHash).toBe(sha256Hex(SESSION_TOKEN))
    expect(created[0].sessionToken).toBeNull()
  })
})
