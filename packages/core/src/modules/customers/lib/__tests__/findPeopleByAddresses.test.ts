import { RawQueryFragment } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { encryptWithAesGcm, generateDek, hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { normalizeAddresses, findPeopleByAddresses, MATCH_CANDIDATE_LIMIT } from '../findPeopleByAddresses'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const warn = jest.fn()
  return {
    ...jest.requireActual('@open-mercato/shared/lib/logger'),
    createLogger: () => ({ child: () => ({ warn }) }),
  }
})

const findWithDecryptionMock = jest.mocked(findWithDecryption)
const warn = jest.mocked(createLogger('customers').child({ component: 'blind-index-lookup' }).warn)
const getEncryptedFieldNames = jest.fn()
const em = {} as EntityManager
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('normalizeAddresses', () => {
  it('lowercases, trims, dedupes', () => {
    const out = normalizeAddresses(['Alice@Example.com', ' alice@example.com ', 'BOB@x.io'])
    expect(out.sort()).toEqual(['alice@example.com', 'bob@x.io'])
  })
  it('filters out non-strings and obviously invalid shapes', () => {
    const out = normalizeAddresses([null, undefined, 'not-an-email', 'a@b'])
    expect(out).toEqual(['a@b'])
  })
  it('returns empty array for empty input', () => {
    expect(normalizeAddresses([])).toEqual([])
    expect(normalizeAddresses(undefined)).toEqual([])
  })
})

describe('findPeopleByAddresses', () => {
  type Row = {
    id: string
    primaryEmail: string | null
    primaryEmailHash?: string
    tenantId: string
    organizationId: string
  }

  function mockFind(rows: Row[], encryptionOn: boolean) {
    findWithDecryptionMock.mockImplementation(async (_em, _entity, filter, options) => {
      const where = filter as {
        kind?: string
        tenantId?: string
        organizationId?: string
        primaryEmailHash?: { $in: string[] }
        [fragment: symbol]: { $in: string[] }
      }
      if (where.kind !== 'person') return []
      const scoped = rows.filter(
        (row) => row.tenantId === where.tenantId && row.organizationId === where.organizationId,
      )
      const hashFilter = where.primaryEmailHash
      if (hashFilter) return scoped.filter((row) => row.primaryEmailHash && hashFilter.$in.includes(row.primaryEmailHash))
      const emailKey = Object.getOwnPropertySymbols(where).find((key) =>
        RawQueryFragment.getKnownFragment(key)?.sql.includes('lower(btrim('),
      )
      if (emailKey !== undefined) {
        if (encryptionOn) return []
        return scoped.filter((row) => row.primaryEmail && where[emailKey].$in.includes(row.primaryEmail.trim().toLowerCase()))
      }
      return scoped.slice(0, options?.limit)
    })
  }

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    warn.mockClear()
    getEncryptedFieldNames.mockReset()
    jest.mocked(resolveTenantEncryptionService).mockReturnValue({
      getEncryptedFieldNames,
    } as unknown as TenantDataEncryptionService)
  })

  it('returns empty array when address list is empty', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], false)
    const out = await findPeopleByAddresses(em, [], 'tenant-1', 'org-1')
    expect(out).toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('matches one row when caller uses upper-case (encryption off)', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], false)
    const out = await findPeopleByAddresses(em, ['ALICE@EXAMPLE.COM'], 'tenant-1', 'org-1')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: 'p1', email: 'alice@example.com' })
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
  })

  it('finds an older mixed-case plaintext address without the bounded scan', async () => {
    const filler = Array.from({ length: MATCH_CANDIDATE_LIMIT }, (_, index) => ({
      id: `newer-${index}`, primaryEmail: null, ...scope,
    }))
    mockFind([...filler, { id: 'older', primaryEmail: '\t Alice@EXAMPLE.COM \n', ...scope }], false)
    await expect(findPeopleByAddresses(em, ['alice@example.com'], scope.tenantId, scope.organizationId))
      .resolves.toEqual([{ id: 'older', email: 'alice@example.com' }])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
  })

  it('REGRESSION: matches via decrypt-and-compare fallback when encryption is on', async () => {
    // The direct primary_email filter returns nothing (ciphertext != plaintext);
    // the match must still resolve through the candidate scan. The previous
    // implementation returned [] here, silently breaking inbound auto-linking.
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses(em, ['Alice@Example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([{ id: 'p1', email: 'alice@example.com' }])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(3)
  })

  it('returns one row per matching person when multiple addresses match different people', async () => {
    mockFind(
      [
        { id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' },
        { id: 'p2', primaryEmail: 'bob@example.com', tenantId: 'tenant-1', organizationId: 'org-1' },
      ],
      true,
    )
    const out = await findPeopleByAddresses(em, ['alice@example.com', 'bob@example.com'], 'tenant-1', 'org-1')
    expect(out.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('dedupes when same Person matches via duplicate addresses (defensive)', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses(em, ['alice@example.com', 'Alice@Example.com'], 'tenant-1', 'org-1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p1')
  })

  it('passes the tenantId, organizationId, and kind through to the filter', async () => {
    mockFind([], true)
    await findPeopleByAddresses(em, ['x@y.io'], 'tenant-42', 'org-42')
    for (const call of findWithDecryptionMock.mock.calls) {
      expect(call[2]).toMatchObject({ tenantId: 'tenant-42', organizationId: 'org-42', kind: 'person', deletedAt: null })
      expect(call[4]).toEqual({ tenantId: 'tenant-42', organizationId: 'org-42' })
    }
  })

  it('returns empty when no person matches in the given tenant', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-other', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses(em, ['alice@example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([])
  })

  it('returns empty when the email only matches another organization', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-other' }], true)
    const out = await findPeopleByAddresses(em, ['alice@example.com'], 'tenant-1', 'org-1')
    expect(out).toEqual([])
  })

  it('fails closed without an organization scope', async () => {
    mockFind([{ id: 'p1', primaryEmail: 'alice@example.com', tenantId: 'tenant-1', organizationId: 'org-1' }], true)
    const out = await findPeopleByAddresses(em, ['alice@example.com'], 'tenant-1', null)
    expect(out).toEqual([])
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('returns a verified digest match without querying plaintext or the scan', async () => {
    const email = 'alice@example.com'
    mockFind([
      { id: 'stale', primaryEmail: null, primaryEmailHash: hashForLookup(email), ...scope },
      { id: 'correct', primaryEmail: ' ALICE@EXAMPLE.COM ', primaryEmailHash: hashForLookup(email), ...scope },
      { id: 'duplicate', primaryEmail: email, primaryEmailHash: hashForLookup(email), ...scope },
    ], true)
    await expect(findPeopleByAddresses(em, [email], scope.tenantId, scope.organizationId))
      .resolves.toEqual([{ id: 'correct', email }])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0]?.[2]).toMatchObject({
      ...scope,
      primaryEmailHash: { $in: lookupHashCandidates(email) },
    })
  })

  it('logs a fallback match once within the warning interval when the map protects email', async () => {
    const email = 'alice@example.com'
    getEncryptedFieldNames.mockResolvedValue(['primary_email'])
    mockFind([{ id: 'recovered', primaryEmail: email, ...scope }], true)
    for (const probe of [email, email.toUpperCase()]) {
      await expect(findPeopleByAddresses(em, [probe], scope.tenantId, scope.organizationId))
        .resolves.toEqual([{ id: 'recovered', email }])
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lookup-hashes:backfill'), {
      ...scope, entityId: 'customers:customer_entity', column: 'primary_email', reason: 'fallbackMatch', count: 1,
    })
  })

  it('warns about exhaustion of the bounded scan for unresolved encrypted inputs', async () => {
    getEncryptedFieldNames.mockResolvedValue(['primary_email'])
    const rows = Array.from({ length: MATCH_CANDIDATE_LIMIT }, (_, index) => ({
      id: `person-${index}`,
      primaryEmail: null,
      ...scope,
    }))
    mockFind(rows, true)
    await expect(findPeopleByAddresses(em, ['alice@example.com'], scope.tenantId, scope.organizationId))
      .resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exhausted'), {
      ...scope, entityId: 'customers:customer_entity', column: 'primary_email', reason: 'fallbackLimit', count: 1,
    })
  })

  it('dedupes and warns about undecryptable candidates without emitting the stored value', async () => {
    const email = 'alice@example.com'
    mockFind([{
      id: 'ciphertext', primaryEmail: encryptWithAesGcm(email, generateDek()).value,
      primaryEmailHash: hashForLookup(email), ...scope,
    }], true)
    await expect(findPeopleByAddresses(em, [email], scope.tenantId, scope.organizationId)).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be decrypted'), {
      ...scope, entityId: 'customers:customer_entity', column: 'primary_email', reason: 'undecryptable', count: 1,
    })
  })
})
