import {
  isIndexableEntityType,
  listNonIndexableEntityTypes,
  registerNonIndexableEntityTypes,
  resetNonIndexableEntityTypes,
} from '@open-mercato/shared/lib/entities/system-entities'
import { buildIndexDoc } from '../lib/indexer'
import { buildSearchTokenRows } from '../lib/search-tokens'
import { upsertIndexBatch, createEmptyUpsertIndexBatchResult } from '../lib/batch'
import { reindexEntity } from '../lib/reindexer'

const SESSION = 'auth:session'
const ORDINARY = 'customers:customer_person_profile'

/**
 * A session row as the reindexer would read it. `token` is blocklisted by field
 * name, so it produces no tokens of its own; `ip_address` and `user_agent` are
 * not, which is why a token-level fix alone would still make the row findable.
 */
const sessionRow = () => ({
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  token: 'bf712cbb88ee4b2c9f1d0e5a77c3b8e1aa04d6f39c2e15b7d8409ca6371e2f5d',
  user_id: '8d2f1a90-0000-0000-0000-0000000000ff',
  ip_address: '203.0.113.42',
  user_agent: 'Mozilla/5.0 Cartography',
  expires_at: '2026-09-27T10:00:00.000Z',
})

function createTrackingKysely() {
  const reads: string[] = []
  const writes: string[] = []
  const chain: any = {
    select: () => chain,
    selectAll: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    groupBy: () => chain,
    values: () => chain,
    set: () => chain,
    onConflict: () => chain,
    returning: () => chain,
    execute: async () => [],
    executeTakeFirst: async () => undefined,
  }
  const db: any = {
    selectFrom: (table: any) => { reads.push(String(table)); return chain },
    insertInto: (table: any) => { writes.push(String(table)); return chain },
    updateTable: (table: any) => { writes.push(String(table)); return chain },
    deleteFrom: (table: any) => { writes.push(String(table)); return chain },
    transaction: () => ({ execute: async (fn: any) => fn(db) }),
  }
  return { db, reads, writes }
}

function makeEm(metaByClass: Record<string, string>) {
  const { db, reads, writes } = createTrackingKysely()
  const all = Object.entries(metaByClass).map(([className, tableName]) => ({ className, tableName }))
  let kyselyCalls = 0
  const em: any = {
    getKysely: () => { kyselyCalls += 1; return db },
    getMetadata: () => ({
      find: (className: string) => {
        const tableName = metaByClass[className]
        return tableName ? { tableName } : undefined
      },
      getAll: () => all,
    }),
  }
  return { em, reads, writes, kyselyCalls: () => kyselyCalls }
}

afterEach(() => {
  resetNonIndexableEntityTypes()
})

describe('the non-indexable entity-type policy', () => {
  it.each([
    'auth:session',
    'auth:password_reset',
    'customer_accounts:customer_user_session',
    'customer_accounts:customer_user_password_reset',
    'customer_accounts:customer_user_email_verification',
    'customer_accounts:customer_user_invitation',
    'communication_channels:channel_thread_token',
    'messages:message_access_token',
    'query_index:search_token',
    'security:sudo_session',
    'security:mfa_challenge',
    'security:mfa_recovery_code',
  ])('refuses %s', (entityType) => {
    expect(isIndexableEntityType(entityType)).toBe(false)
  })

  it.each([
    // Ordinary entities. If the list ever swallows one of these, search silently
    // loses a whole entity type.
    'auth:user',
    'customers:customer_person_profile',
    'directory:organization',
    // Deliberate exclusions: each holds a secret column but also backs a list
    // screen with display-worthy fields, so the field-level blocklist is what
    // protects them. Flipping one of these to `false` breaks its list view, not
    // just its search.
    'api_keys:api_key',
    'integrations:integration_credentials',
    'sso:sso_config',
    'sso:scim_token',
    'security:user_mfa_method',
    'inbox_ops:inbox_settings',
    'webhooks:webhook_entity',
    'onboarding:onboarding_request',
    'devices:user_device',
  ])('keeps %s indexable', (entityType) => {
    expect(isIndexableEntityType(entityType)).toBe(true)
  })

  it('treats an empty or whitespace-only entity type as indexable', () => {
    // Not a security decision: an unnamed entity type never reaches a write with
    // a table behind it, and failing closed here would refuse every caller that
    // passes an id it has not resolved yet.
    expect(isIndexableEntityType('')).toBe(true)
    expect(isIndexableEntityType(undefined as unknown as string)).toBe(true)
  })

  it('matches a padded entity type, so a stray space cannot re-open the hole', () => {
    expect(isIndexableEntityType('  auth:session  ')).toBe(false)
  })

  it('lets a module widen the refusal, and reports it', () => {
    expect(isIndexableEntityType('billing:portal_magic_link')).toBe(true)
    registerNonIndexableEntityTypes('billing:portal_magic_link')
    expect(isIndexableEntityType('billing:portal_magic_link')).toBe(false)
    expect(listNonIndexableEntityTypes()).toContain('billing:portal_magic_link')
  })

  it('restores the built-in entries on reset and drops registrations', () => {
    registerNonIndexableEntityTypes('billing:portal_magic_link')
    resetNonIndexableEntityTypes()
    expect(isIndexableEntityType('billing:portal_magic_link')).toBe(true)
    expect(isIndexableEntityType('auth:session')).toBe(false)
  })

  it('ignores a blank registration rather than refusing every entity type', () => {
    registerNonIndexableEntityTypes('', '   ')
    expect(isIndexableEntityType('customers:customer_person_profile')).toBe(true)
  })
})

describe('buildIndexDoc refuses a credential-bearing entity type', () => {
  it('returns null without reading the source table', async () => {
    const { em, kyselyCalls } = makeEm({ Session: 'sessions' })

    const doc = await buildIndexDoc(em, { entityType: SESSION, recordId: 'a1', tenantId: 't1', organizationId: 'o1' })

    // Null rather than a throw: `upsertIndexRow` deletes the projection row and
    // its tokens on a null document, so an index polluted before this release
    // cleans itself up as records are touched.
    expect(doc).toBeNull()
    expect(kyselyCalls()).toBe(0)
  })
})

describe('buildSearchTokenRows refuses a credential-bearing entity type', () => {
  it('produces no tokens for a session row', () => {
    const rows = buildSearchTokenRows({
      entityType: SESSION,
      recordId: 'a1',
      organizationId: 'o1',
      tenantId: 't1',
      doc: sessionRow(),
    })
    expect(rows).toEqual([])
  })

  it('still tokenises the same fields on an ordinary entity type', () => {
    // Negative control. Without it the suite would pass just as happily against
    // a change that disabled token indexing outright.
    const rows = buildSearchTokenRows({
      entityType: ORDINARY,
      recordId: 'a1',
      organizationId: 'o1',
      tenantId: 't1',
      doc: sessionRow(),
    })
    expect(rows.length).toBeGreaterThan(0)
    // And it shows what a token-level fix alone would leave behind: the session's
    // IP and user agent are not blocklisted by field name.
    expect(rows.map((row) => row.field)).toEqual(expect.arrayContaining(['ip_address', 'user_agent']))
  })
})

describe('upsertIndexBatch refuses a credential-bearing entity type', () => {
  it('writes nothing and reports an empty batch', async () => {
    const { db, writes } = createTrackingKysely()

    const result = await upsertIndexBatch(db, SESSION, [sessionRow()], { tenantId: 't1', orgId: 'o1' })

    // Empty rather than a throw: `mercato query_index rebuild-all` calls this
    // directly for every generated entity id and asserts the writes landed, so a
    // refused entity type must read as 0 of 0 rather than as a lost batch.
    expect(result).toEqual(createEmptyUpsertIndexBatchResult())
    expect(writes).toEqual([])
  })

  it('attempts the write for an ordinary entity type', async () => {
    const { db, writes } = createTrackingKysely()

    const result = await upsertIndexBatch(db, ORDINARY, [sessionRow()], { tenantId: 't1', orgId: 'o1' })

    expect(result.attempted).toBe(1)
    expect(writes.length).toBeGreaterThan(0)
  })
})

describe('reindexEntity refuses a credential-bearing entity type', () => {
  it('returns an empty result before touching the table', async () => {
    const { em, reads, writes } = makeEm({ Session: 'sessions' })

    const result = await reindexEntity(em, { entityType: SESSION, tenantId: 't1', organizationId: 'o1' })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
    // The refusal has to land here as well as in `upsertIndexBatch`: getting past
    // this point prepares a job, resets coverage and purges rows for an entity
    // type that must not be in the index at all.
    expect(reads).toEqual([])
    expect(writes).toEqual([])
  })

  it('keeps refusing the search-token table it refused by name before', async () => {
    const { em, reads } = makeEm({ SearchToken: 'search_tokens' })

    const result = await reindexEntity(em, { entityType: 'query_index:search_token', tenantId: 't1', organizationId: 'o1' })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
    expect(reads).toEqual([])
  })

  it('reads the source table for an entity type that is still indexable', async () => {
    // Negative control for the guard's placement: an ordinary entity type must
    // get past it and reach the table.
    const { em, reads } = makeEm({ CustomerPersonProfile: 'customer_person_profiles' })

    await reindexEntity(em, { entityType: ORDINARY, tenantId: 't1', organizationId: 'o1' })

    expect(reads.length).toBeGreaterThan(0)
  })
})
