import type { EntityManager } from '@mikro-orm/postgresql'
import { createInboundEmailContactLookup, findPeopleByAddresses, normalizeAddresses } from '../findPeopleByAddresses'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDek } from '@open-mercato/shared/lib/encryption/kms'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const findWithDecryptionMock = findWithDecryption as unknown as jest.Mock

describe('normalizeAddresses', () => {
  it('lowercases, trims, dedupes', () => {
    const out = normalizeAddresses(['Alice@Example.com', ' alice@example.com ', 'BOB@x.io'])
    expect(out.sort()).toEqual(['alice@example.com', 'bob@x.io'])
  })
  it('filters out non-strings and obviously invalid shapes', () => {
    const out = normalizeAddresses([null as any, undefined as any, 'not-an-email', 'a@b'])
    expect(out).toEqual(['a@b'])
  })
  it('returns empty array for empty input', () => {
    expect(normalizeAddresses([])).toEqual([])
    expect(normalizeAddresses(undefined as any)).toEqual([])
  })
})

describe('findPeopleByAddresses', () => {
  type Row = { id: string; primaryEmail: string | null; tenantId: string; organizationId: string }

  /**
   * Mock `findWithDecryption` to model both encryption modes:
   * - `encryptionOn: true` — a direct `WHERE primary_email = ?` ($in) filter returns
   *   NOTHING (random-IV ciphertext never equals the plaintext probe), exactly as it
   *   behaves in production with `TENANT_DATA_ENCRYPTION=yes`. The in-memory candidate
   *   scan (no `primaryEmail` filter) returns the decrypted rows.
   * - `encryptionOn: false` — the direct filter matches on plaintext.
   */
  function mockFind(rows: Row[], encryptionOn: boolean) {
    findWithDecryptionMock.mockImplementation(async (_em: unknown, _entity: unknown, where: any) => {
      if (String(where.kind ?? '') !== 'person') return []
      const scoped = rows.filter(
        (r) => r.tenantId === where.tenantId && r.organizationId === where.organizationId,
      )
      const emailFilter = where.primaryEmail
      if (emailFilter && typeof emailFilter === 'object' && Array.isArray(emailFilter.$in)) {
        if (encryptionOn) return []
        const wanted = new Set(emailFilter.$in as string[])
        return scoped.filter((r) => r.primaryEmail && wanted.has(r.primaryEmail))
      }
      return scoped
    })
  }

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('returns empty array when address list is empty', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], false)
    const out = await findPeopleByAddresses({} as any, [], 'tenant-1', 'org-1')
    expect(out).toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('matches one row when caller uses upper-case (encryption off)', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], false)
    const out = await findPeopleByAddresses({} as any, ['ALICE@EXAMPLE.COM'], 'tenant-1', 'org-1')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: 'p1', email: 'alice@example.com' })
  })

  it('REGRESSION: matches via decrypt-and-compare fallback when encryption is on', async () => {
    // The direct primary_email filter returns nothing (ciphertext != plaintext);
    // the match must still resolve through the candidate scan. The previous
    // implementation returned [] here, silently breaking inbound auto-linking.
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses({} as any, ['Alice@Example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([{ id: 'p1', email: 'alice@example.com' }])
    // First call is the (empty) direct probe; the second is the in-memory scan.
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
  })

  it('returns one row per matching person when multiple addresses match different people', async () => {
    mockFind(
      [
        { id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' },
        { id: 'p2', primaryEmail: 'bob@example.com', tenantId: 'tenant-1', organizationId: 'org-1' },
      ],
      true,
    )
    const out = await findPeopleByAddresses({} as any, ['alice@example.com', 'bob@example.com'], 'tenant-1', 'org-1')
    expect(out.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('dedupes when same Person matches via duplicate addresses (defensive)', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses({} as any, ['alice@example.com', 'Alice@Example.com'], 'tenant-1', 'org-1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p1')
  })

  it('passes the tenantId, organizationId, and kind through to the filter', async () => {
    mockFind([], true)
    await findPeopleByAddresses({} as any, ['x@y.io'], 'tenant-42', 'org-42')
    const where = (findWithDecryptionMock.mock.calls[0] as any[])[2]
    expect(where.tenantId).toBe('tenant-42')
    expect(where.organizationId).toBe('org-42')
    expect(where.kind).toBe('person')
  })

  it('returns empty when no person matches in the given tenant', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-other', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses({} as any, ['alice@example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([])
  })

  it('returns empty when the email only matches another organization', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-other' }], true)
    const out = await findPeopleByAddresses({} as any, ['alice@example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([])
  })

  it('fails closed without an organization scope', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses({} as any, ['alice@example.com'], 'tenant-1', null)
    expect(out).toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })
})

describe('createInboundEmailContactLookup', () => {
  const em = {} as EntityManager
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
  const unreadableEmail = [Buffer.alloc(12), Buffer.alloc(10), Buffer.alloc(16), 'v1']
    .map((part) => typeof part === 'string' ? part : part.toString('base64'))
    .join(':')

  function mockEncryption() {
    return {
      isEnabled: jest.fn(() => true),
      getEncryptedFieldNames: jest.fn(async () => ['primary_email']),
      getDek: jest.fn(async (tenantId: string): Promise<TenantDek | null> => ({
        tenantId,
        key: Buffer.alloc(32).toString('base64'),
        fetchedAt: Date.now(),
      })),
    }
  }

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('finds normalized email addresses beyond the interactive lookup cap with one scan per scope', async () => {
    const people = Array.from({ length: 501 }, (_, index) => ({
      id: `person-${String(index).padStart(3, '0')}`,
      primaryEmail: `contact-${index}@example.com`,
    }))
    findWithDecryptionMock.mockImplementation(async (
      _em: unknown,
      _entity: unknown,
      where: { id?: { $gt: string } },
      options: { limit: number },
    ) => people.filter(({ id }) => !where.id || id > where.id.$gt).slice(0, options.limit))

    const lookup = createInboundEmailContactLookup(em)
    await expect(Promise.all([
      lookup(' CONTACT-500@example.com ', scope),
      lookup('contact-0@example.com', scope),
      lookup('unknown@example.com', scope),
    ])).resolves.toEqual(['person-500', 'person-000', undefined])

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(6)
    expect(findWithDecryptionMock).toHaveBeenLastCalledWith(
      em,
      expect.any(Function),
      {
        ...scope,
        kind: 'person',
        deletedAt: null,
        primaryEmail: { $ne: null },
        id: { $gt: 'person-499' },
      },
      {
        fields: ['id', 'tenantId', 'organizationId', 'primaryEmail'],
        orderBy: { id: 'ASC' },
        limit: 100,
        disableIdentityMap: true,
      },
      scope,
    )
  })

  it('isolates positive and negative results by tenant and organization', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([{ id: 'person-1', primaryEmail: 'ALICE@example.com' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const lookup = createInboundEmailContactLookup(em)

    await expect(lookup('alice@example.com', scope)).resolves.toBe('person-1')
    await expect(lookup('alice@example.com', { ...scope, organizationId: 'org-2' })).resolves.toBeUndefined()
    await expect(lookup('alice@example.com', { ...scope, tenantId: 'tenant-2' })).resolves.toBeUndefined()
    await expect(lookup('alice@example.com', scope)).resolves.toBe('person-1')
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(3)
  })

  it('requires a valid address and an organization before reading contact records', async () => {
    const lookup = createInboundEmailContactLookup(em)

    await expect(lookup('not-an-email', scope)).resolves.toBeUndefined()
    await expect(lookup('alice@example.com', { ...scope, organizationId: null })).resolves.toBeUndefined()
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('propagates a database failure and retries the scan on a later lookup', async () => {
    const readError = new Error('database unavailable')
    findWithDecryptionMock
      .mockRejectedValueOnce(readError)
      .mockResolvedValueOnce([{ id: 'person-1', primaryEmail: 'alice@example.com' }])
    const lookup = createInboundEmailContactLookup(em)

    await expect(lookup('alice@example.com', scope)).rejects.toBe(readError)
    await expect(lookup('alice@example.com', scope)).resolves.toBe('person-1')
  })

  it('continues matching readable contacts when individual rows cannot decrypt', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'person-1', primaryEmail: unreadableEmail },
      { id: 'person-2', primaryEmail: unreadableEmail },
      { id: 'person-3', primaryEmail: 'alice@example.com' },
    ])
    const encryption = mockEncryption()
    const lookup = createInboundEmailContactLookup(em, encryption)

    await expect(lookup('alice@example.com', scope)).resolves.toBe('person-3')
    await expect(lookup('unknown@example.com', scope)).resolves.toBeUndefined()
    expect(encryption.getDek).toHaveBeenCalledTimes(1)
    expect(encryption.getDek).toHaveBeenCalledWith(scope.tenantId)
  })

  it('retries the lookup after the tenant key becomes available', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([{ id: 'person-1', primaryEmail: unreadableEmail }])
      .mockResolvedValueOnce([{ id: 'person-1', primaryEmail: 'alice@example.com' }])
    const encryption = mockEncryption()
    encryption.getDek.mockImplementationOnce(async () => null)
    const lookup = createInboundEmailContactLookup(em, encryption)

    await expect(lookup('alice@example.com', scope)).rejects.toThrow('CRM contact email decryption is unavailable')
    await expect(lookup('alice@example.com', scope)).resolves.toBe('person-1')
  })

  it('keeps unresolved ciphertext retryable when the email decryption policy is missing', async () => {
    findWithDecryptionMock.mockResolvedValue([{ id: 'person-1', primaryEmail: unreadableEmail }])
    const encryption = mockEncryption()
    encryption.getEncryptedFieldNames.mockResolvedValueOnce(['display_name'])
    const lookup = createInboundEmailContactLookup(em, encryption)

    await expect(lookup('alice@example.com', scope)).rejects.toThrow('CRM contact email decryption is unavailable')
    expect(encryption.getDek).not.toHaveBeenCalled()
  })
})
