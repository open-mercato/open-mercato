import { RawQueryFragment } from '@mikro-orm/core'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import {
  encryptWithAesGcm,
  generateDek,
  hashForLookup,
  lookupHashCandidates,
} from '@open-mercato/shared/lib/encryption/aes'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerCompanyProfile, CustomerEntity } from '../../data/entities'
import { findCompaniesByDomains, normalizeDomains } from '../findCompaniesByDomains'
import { MATCH_CANDIDATE_LIMIT } from '../findPeopleByAddresses'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
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

const find = jest.mocked(findWithDecryption)
const warn = jest.mocked(createLogger('customers').child({ component: 'blind-index-lookup' }).warn)
const getEncryptedFieldNames = jest.fn()
const em = {} as EntityManager
const scope = { tenantId: 't-company', organizationId: 'company-org' }
const match = () => findCompaniesByDomains(em, ['@www.example.com'], scope.tenantId, scope.organizationId)
const company = (id: string, domain: string | null) => ({ id: `profile-${id}`, entity: { id }, domain })

beforeEach(() => {
  find.mockReset()
  warn.mockClear()
  getEncryptedFieldNames.mockReset()
  jest.mocked(resolveTenantEncryptionService).mockReturnValue({
    getEncryptedFieldNames,
  } as unknown as TenantDataEncryptionService)
})

describe('normalizeDomains', () => {
  it('lowercases, trims, strips a leading @ and www., and dedupes in input order', () => {
    expect(normalizeDomains([' @WWW.Example.com ', 'example.com', 'b.example.com', 'WWW.www.example.com']))
      .toEqual(['example.com', 'b.example.com', 'www.example.com'])
  })

  it('drops invalid inputs and empty domains', () => {
    expect(normalizeDomains([
      null, 1, '', '@', 'site', 'example.', '.com', ' https://example.com ', 'example.com/path',
      'in valid.example', '@@example.com', 'someone@example.com',
    ])).toEqual([])
    expect(normalizeDomains('example.com')).toEqual([])
  })
})

describe('findCompaniesByDomains', () => {
  it('fails closed without an organization or effective inputs', async () => {
    await expect(findCompaniesByDomains(em, ['example.com'], scope.tenantId, null)).resolves.toEqual([])
    await expect(findCompaniesByDomains(em, ['https://example.com'], scope.tenantId, scope.organizationId))
      .resolves.toEqual([])
    expect(find).not.toHaveBeenCalled()
  })

  it.each(['example.com', 'www.example.com', '@example.com', '@www.example.com'])(
    'finds a hashed domain stored as %s and returns the owning entity ID',
    async (stored) => {
      const digest = hashForLookup(stored)
      find.mockImplementation(async (_em, _entity, where) => {
        const predicate = where as { domainHash?: { $in: string[] } }
        return predicate.domainHash?.$in.includes(digest)
          ? [company('owner', ` ${stored.toUpperCase()} `)]
          : []
      })
      await expect(match()).resolves.toEqual([{ id: 'owner', domain: 'example.com' }])
      expect(find).toHaveBeenCalledTimes(1)
      expect(find).toHaveBeenCalledWith(em, CustomerCompanyProfile, {
        ...scope,
        entity: { ...scope, kind: 'company', deletedAt: null },
        domainHash: { $in: expect.arrayContaining(lookupHashCandidates(stored)) },
      }, undefined, scope)
    },
  )

  it('uses a scoped plaintext equality query only for outstanding domains', async () => {
    find
      .mockResolvedValueOnce([company('hash-owner', 'a.example.com')])
      .mockResolvedValueOnce([company('plain-owner', '@www.b.example.com')])
    await expect(findCompaniesByDomains(em, ['b.example.com', 'a.example.com'], scope.tenantId, scope.organizationId))
      .resolves.toEqual([
        { id: 'plain-owner', domain: 'b.example.com' },
        { id: 'hash-owner', domain: 'a.example.com' },
      ])
    expect(find).toHaveBeenCalledTimes(2)
    const [manager, entity, filter, options, decryptScope] = find.mock.calls[1]!
    expect(manager).toBe(em)
    expect(entity).toBe(CustomerCompanyProfile)
    expect(filter).toMatchObject({ ...scope, entity: { ...scope, kind: 'company', deletedAt: null } })
    expect(options).toBeUndefined()
    expect(decryptScope).toEqual(scope)
    const where = filter as Record<symbol, { $in: string[] }>
    const plaintextKey = Object.getOwnPropertySymbols(where)[0]!
    expect(RawQueryFragment.getKnownFragment(plaintextKey)?.sql).toContain('lower(btrim(')
    expect(where[plaintextKey]).toEqual({
      $in: ['b.example.com', 'www.b.example.com', '@b.example.com', '@www.b.example.com'],
    })
  })

  it('removes stale hashes, digest collisions and duplicates through candidate verification', async () => {
    find.mockResolvedValueOnce([
      company('cleared', null),
      company('wrong', 'other.example.com'),
      company('first', '@EXAMPLE.COM'),
      company('duplicate', 'example.com'),
    ])
    await expect(match()).resolves.toEqual([{ id: 'first', domain: 'example.com' }])
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('applies the parent soft-delete and scope predicates on all three reads', async () => {
    find.mockResolvedValue([])
    await expect(match()).resolves.toEqual([])
    expect(find).toHaveBeenCalledTimes(3)
    for (const call of find.mock.calls) {
      expect(call[2]).toMatchObject({
        ...scope,
        entity: { ...scope, kind: 'company', deletedAt: null },
      })
      expect(call[4]).toEqual(scope)
    }
    expect(find.mock.calls[2]?.[3]).toEqual({ limit: MATCH_CANDIDATE_LIMIT, orderBy: { createdAt: 'DESC' } })
  })

  it('compiles scoped parent joins for both indexed and plaintext queries', async () => {
    const orm = await MikroORM.init({ entities: [CustomerCompanyProfile, CustomerEntity], dbName: 'test' })
    try {
      const queries: string[] = []
      const params: Array<readonly unknown[]> = []
      const older = company('older', '\t @WWW.Example.COM \n')
      find.mockImplementation(async (_em, _entity, where) => {
        const query = orm.em.fork().createQueryBuilder(CustomerCompanyProfile).select('*')
          .where(where as {
            tenantId: string
            organizationId: string
            entity: { tenantId: string; organizationId: string; kind: 'company'; deletedAt: null }
          })
        queries.push(query.getQuery())
        params.push(query.getParams())
        return query.getQuery().includes('lower(btrim(') ? [older] : []
      })
      await expect(match()).resolves.toEqual([{ id: 'older', domain: 'example.com' }])
      expect(queries).toHaveLength(2)
      expect(queries[0]).toContain('"c0"."domain_hash" in')
      expect(queries[1]).toContain('lower(btrim(c0."domain",')
      expect(queries[1]).toContain(' in (?, ?, ?, ?)')
      expect(params[1]).toEqual(expect.arrayContaining(['example.com', '@www.example.com']))
      for (const query of queries) {
        expect(query).toContain('join "customer_entities" as "c1" on "c0"."entity_id" = "c1"."id"')
        expect(query).toContain('"c0"."tenant_id" = ?')
        expect(query).toContain('"c0"."organization_id" = ?')
        expect(query).toContain('"c1"."tenant_id" = ?')
        expect(query).toContain('"c1"."organization_id" = ?')
        expect(query).toContain('"c1"."kind" = ?')
        expect(query).toContain('"c1"."deleted_at" is null')
      }
    } finally {
      await orm.close(true)
    }
  })

  it('verifies domains recovered from the bounded fallback scan', async () => {
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([company('recovered', ' WWW.EXAMPLE.COM ')])
    await expect(match()).resolves.toEqual([{ id: 'recovered', domain: 'example.com' }])
    expect(find).toHaveBeenCalledTimes(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('never matches a candidate still holding ciphertext', async () => {
    const ciphertext = encryptWithAesGcm('example.com', generateDek()).value
    find.mockResolvedValueOnce([company('unreadable', ciphertext)]).mockResolvedValue([])
    await expect(match()).resolves.toEqual([])
    expect(find).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be decrypted'), {
      ...scope, entityId: 'customers:customer_company_profile', column: 'domain', reason: 'undecryptable', count: 1,
    })
  })
})
