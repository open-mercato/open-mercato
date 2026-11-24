import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { Kysely, PostgresDialect, sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine, clearColumnExistsCache } from '@open-mercato/shared/lib/query/engine'
import { compileTreeToWhere, makeRuleTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { tokenizeText } from '@open-mercato/shared/lib/search/tokenize'
import { resolveSearchConfig } from '@open-mercato/shared/lib/search/config'
import { clearSearchTokenPresenceCache } from '@open-mercato/shared/lib/search/availability'
import type { QueryEngine, QueryOptions } from '@open-mercato/shared/lib/query/types'
import { HybridQueryEngine, clearBaseTableExistsCache } from '../lib/engine'

const databaseUrl = process.env.OM_QUERY_NEGATION_PG_URL
const postgresSuite = databaseUrl ? describe : describe.skip
const schema = `query_negation_${randomUUID().replaceAll('-', '')}`
const tenantId = randomUUID()
const organizationId = randomUUID()
const otherTenantId = randomUUID()
const otherOrganizationId = randomUUID()
const entity = 'auth:user'
const ciphertext = 'QUFBQUFBQUFBQUFB:QUFB:QUFBQUFBQUFBQUFBQUFBQQ==:v1'
const identifiers = Object.fromEntries(['alpha', 'reverse', 'omega', 'literal', 'empty', 'null', 'unindexed', 'wrongTenant', 'wrongOrganization', 'wrongField', 'wrongEntity'].map((name) => [name, randomUUID()]))
const profileIds: Record<string, string> = Object.fromEntries(Object.keys(identifiers).map((key) => [key, randomUUID()]))
type Database = Record<string, Record<string, unknown>>

postgresSuite('negated text through real PostgreSQL query engines (#7996)', () => {
  let administrativeDb: Kysely<Database>
  let database: Kysely<Database>
  const executedSql: string[] = []

  beforeAll(async () => {
    administrativeDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: databaseUrl }) }) })
    await sql`create schema ${sql.id(schema)}`.execute(administrativeDb)
    database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` }) }), log: (event) => { if (event.level === 'query') executedSql.push(event.query.sql) } })
    const definitions = [
      'create table users (id uuid primary key, tenant_id uuid not null, organization_id uuid, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), display_name text, secret text)',
      'create table profiles (id uuid primary key, user_id uuid, tenant_id uuid, organization_id uuid, deleted_at timestamptz, secret text)',
      'create table search_tokens (entity_type text, entity_id text, field text, token_hash text, tenant_id uuid, organization_id uuid)',
      'create table entity_indexes (id uuid primary key, entity_type text, entity_id text, tenant_id uuid, organization_id uuid, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), doc jsonb)',
      'create table custom_entities_storage (entity_type text, entity_id text, tenant_id uuid, organization_id uuid, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), doc jsonb)',
      'create table custom_field_defs (entity_id text, key text, is_active boolean, kind text, config_json jsonb, tenant_id uuid, organization_id uuid, updated_at timestamptz default now(), deleted_at timestamptz)',
      'create table custom_field_values (id uuid, entity_id text, record_id text, field_key text, tenant_id uuid, organization_id uuid, value_text text, value_multiline text, value_int integer, value_float double precision, value_bool boolean)',
      'create table entity_index_coverage (entity_type text, tenant_id uuid, organization_id uuid, with_deleted boolean, base_count integer, indexed_count integer, vector_indexed_count integer, refreshed_at timestamptz)',
    ]
    for (const definition of definitions) await sql.raw(definition).execute(database)
    const names: Record<string, string | null> = { alpha: 'Daniel Harris', reverse: 'Harris Daniel', omega: 'Omega', literal: 'x%_\\suffix', empty: '', null: null, unindexed: 'Missing', wrongTenant: 'Wrong tenant', wrongOrganization: 'Wrong organization', wrongField: 'Wrong field', wrongEntity: 'Wrong entity' }
    for (const [key, id] of Object.entries(identifiers)) {
      await database.insertInto('users').values({ id, tenant_id: tenantId, organization_id: organizationId, display_name: names[key], secret: ciphertext }).execute()
      const labels = key === 'alpha' ? ['Daniel', 'Omega'] : key === 'omega' ? ['Omega'] : []
      const privateValues = ['alpha', 'omega', 'unindexed'].includes(key) ? key === 'unindexed' ? [ciphertext, 'Omega'] : [ciphertext] : []
      const document = JSON.stringify({ display_name: names[key], secret: ciphertext, 'cf:labels': labels, 'cf:private': privateValues })
      await database.insertInto('entity_indexes').values({ id: randomUUID(), entity_type: entity, entity_id: id, tenant_id: tenantId, organization_id: organizationId, doc: document }).execute()
      await database.insertInto('custom_entities_storage').values({ entity_type: entity, entity_id: id, tenant_id: tenantId, organization_id: organizationId, doc: document }).execute()
      for (const privateValue of privateValues) {
        await database.insertInto('custom_field_values').values({ id: randomUUID(), entity_id: entity, record_id: id, field_key: 'private', tenant_id: tenantId, organization_id: organizationId, value_text: privateValue }).execute()
      }
      for (const label of labels) {
        await database.insertInto('custom_field_values').values({ id: randomUUID(), entity_id: entity, record_id: id, field_key: 'labels', tenant_id: tenantId, organization_id: organizationId, value_text: label }).execute()
      }
    }
    await database.insertInto('custom_field_defs').values({ entity_id: entity, key: 'labels', is_active: true, kind: 'text', config_json: '{}', tenant_id: tenantId, organization_id: organizationId }).execute()
    await database.insertInto('custom_field_defs').values({ entity_id: entity, key: 'private', is_active: true, kind: 'text', config_json: '{"encrypted":true}', tenant_id: tenantId, organization_id: organizationId }).execute()
    for (const [key, term] of Object.entries({ alpha: 'Daniel', omega: 'Omega' })) {
      for (const hash of tokenizeText(term, resolveSearchConfig()).hashes) {
        await database.insertInto('search_tokens').values({ entity_type: entity, entity_id: identifiers[key], field: 'cf:private', token_hash: hash, tenant_id: tenantId, organization_id: organizationId }).execute()
      }
    }
    await database.insertInto('entity_index_coverage').values({ entity_type: entity, tenant_id: tenantId, organization_id: organizationId, with_deleted: false, base_count: Object.keys(identifiers).length, indexed_count: Object.keys(identifiers).length, vector_indexed_count: 0, refreshed_at: new Date() }).execute()
    for (const [key, text] of [['alpha', 'Daniel Harris'], ['reverse', 'Harris Daniel'], ['omega', 'Omega'], ['wrongTenant', 'Omega'], ['wrongOrganization', 'Omega'], ['wrongField', 'Omega'], ['wrongEntity', 'Omega']]) {
      for (const hash of tokenizeText(text, resolveSearchConfig()).hashes) {
        await database.insertInto('search_tokens').values({ entity_type: key === 'wrongEntity' ? 'auth:profile' : entity, entity_id: identifiers[key], field: key === 'wrongField' ? 'other' : 'secret', token_hash: hash, tenant_id: key === 'wrongTenant' ? otherTenantId : tenantId, organization_id: key === 'wrongOrganization' ? otherOrganizationId : organizationId }).execute()
      }
    }
    for (const [key, text] of Object.entries({ alpha: 'Daniel Harris', omega: 'Omega' })) {
      await database.insertInto('profiles').values({ id: profileIds[key as keyof typeof profileIds], user_id: identifiers[key], tenant_id: tenantId, organization_id: organizationId, secret: ciphertext }).execute()
      for (const hash of tokenizeText(text, resolveSearchConfig()).hashes) {
        await database.insertInto('search_tokens').values({ entity_type: 'auth:profile', entity_id: profileIds[key as keyof typeof profileIds], field: 'secret', token_hash: hash, tenant_id: tenantId, organization_id: organizationId }).execute()
      }
    }
    for (const key of ['unindexed', 'wrongTenant', 'wrongOrganization', 'wrongField', 'wrongEntity']) {
      await database.insertInto('profiles').values({ id: profileIds[key], user_id: identifiers[key], tenant_id: tenantId, organization_id: organizationId, secret: ciphertext }).execute()
    }
    for (let position = 0; position < 4; position += 1) {
      await database.insertInto('custom_field_defs').values({ entity_id: entity, key: `unrelated_${position}`, is_active: true, kind: 'text', config_json: '{}', tenant_id: tenantId, organization_id: organizationId }).execute()
    }
    await database.insertInto('custom_field_defs').values([
      { entity_id: 'auth:profile', key: 'secondary_private', is_active: true, kind: 'text', config_json: '{"encrypted":true}', tenant_id: tenantId, organization_id: organizationId },
      { entity_id: entity, key: 'shared', is_active: true, kind: 'text', config_json: '{}', tenant_id: tenantId, organization_id: organizationId },
      { entity_id: 'auth:profile', key: 'shared', is_active: true, kind: 'text', config_json: '{}', tenant_id: tenantId, organization_id: organizationId },
    ]).execute()
    for (const key of ['alpha', 'omega', 'unindexed', 'wrongTenant', 'wrongOrganization', 'wrongField', 'wrongEntity']) {
      const shared = key === 'alpha' ? 'Omega' : key === 'omega' ? 'Daniel' : null
      await database.insertInto('entity_indexes').values({ id: randomUUID(), entity_type: 'auth:profile', entity_id: profileIds[key], tenant_id: tenantId, organization_id: organizationId, doc: JSON.stringify({ 'cf:secondary_private': [ciphertext], 'cf:shared': shared }) }).execute()
      await database.insertInto('custom_field_values').values({ id: randomUUID(), entity_id: 'auth:profile', record_id: profileIds[key], field_key: 'secondary_private', tenant_id: tenantId, organization_id: organizationId, value_text: ciphertext }).execute()
      if (shared !== null) await database.insertInto('custom_field_values').values({ id: randomUUID(), entity_id: 'auth:profile', record_id: profileIds[key], field_key: 'shared', tenant_id: tenantId, organization_id: organizationId, value_text: shared }).execute()
      if (key === 'unindexed') continue
      for (const hash of tokenizeText(key === 'alpha' ? 'Daniel' : 'Omega', resolveSearchConfig()).hashes) {
        await database.insertInto('search_tokens').values({ entity_type: key === 'wrongEntity' ? entity : 'auth:profile', entity_id: profileIds[key], field: key === 'wrongField' ? 'cf:other' : 'cf:secondary_private', token_hash: hash, tenant_id: key === 'wrongTenant' ? otherTenantId : tenantId, organization_id: key === 'wrongOrganization' ? otherOrganizationId : organizationId }).execute()
      }
    }
    for (const key of ['alpha', 'omega']) {
      const shared = key === 'alpha' ? 'Daniel' : 'Omega'
      await database.insertInto('custom_field_values').values({ id: randomUUID(), entity_id: entity, record_id: identifiers[key], field_key: 'shared', tenant_id: tenantId, organization_id: organizationId, value_text: shared }).execute()
      await sql`update entity_indexes set doc = doc || ${JSON.stringify({ 'cf:shared': shared })}::jsonb where entity_type = ${entity} and entity_id = ${identifiers[key]}`.execute(database)
    }

  })

  afterAll(async () => {
    if (database) await database.destroy()
    if (administrativeDb) {
      await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(administrativeDb)
      await administrativeDb.destroy()
    }
  })

  beforeEach(() => {
    clearColumnExistsCache()
    clearBaseTableExistsCache()
    clearSearchTokenPresenceCache()
  })

  function engines(): Array<{ name: string; engine: QueryEngine; options?: QueryOptions }> {
    const manager = { getKysely: () => database, getMetadata: () => ({ find: (name: string) => name === 'User' ? { tableName: 'users' } : name === 'Profile' ? { tableName: 'profiles' } : undefined, getAll: () => [{ tableName: 'users' }, { tableName: 'profiles' }] }) } as unknown as EntityManager
    const resolver = () => ({ getEncryptedFieldNames: async () => ['secret'] })
    const basic = new BasicQueryEngine(manager, () => database, resolver)
    const hybrid = new HybridQueryEngine(manager, basic, undefined, undefined, resolver)
    return [{ name: 'basic', engine: basic }, { name: 'hybrid', engine: hybrid }, { name: 'custom storage', engine: hybrid, options: { forceCustomEntityStorage: true } }]
  }

  async function ids(engine: QueryEngine, filters: QueryOptions['filters'], options?: QueryOptions): Promise<string[]> {
    const result = await engine.query<{ id: string }>(entity, { tenantId, organizationId, fields: ['id'], decryptEncryptedFields: false, skipAutoReindex: true, filters, ...options })
    return result.items.map((row) => row.id).sort()
  }

  test.each(['%', '_', '\\', 'x', ''])('preserves compiler escaping and empty-term semantics for %j', async (term) => {
    const filters = compileTreeToWhere(makeRuleTree({ field: 'display_name', operator: 'does_not_contain', value: term }))
    const expected = Object.entries(identifiers).filter(([key]) => term === '' || (key !== 'literal' && key !== 'null')).map(([, id]) => id).sort()
    for (const current of engines()) expect(await ids(current.engine, filters ?? {}, current.options)).toEqual(expected)
  })

  test('does not escape wrapper wildcards or double-escape already emitted patterns', async () => {
    for (const current of engines()) {
      expect(await ids(current.engine, { display_name: { $not: { $ilike: '%' } } }, current.options)).toEqual([])
      const expected = Object.entries(identifiers).filter(([key]) => key !== 'empty' && key !== 'null').map(([, id]) => id).sort()
      expect(await ids(current.engine, { display_name: { $not: { $ilike: '' } } }, current.options)).toEqual(expected)
    }
  })

  test('requires correctly scoped encrypted token evidence and matches multiword tokens without order dependence', async () => {
    for (const current of engines()) {
      const result = await ids(current.engine, { secret: { $not: { $ilike: '%Harris Daniel%' } } }, current.options)
      expect(result).toEqual([identifiers.omega])
    }
  })

  test('rejects short encrypted base patterns and excludes unsearchable encrypted document values', async () => {
    for (const current of engines()) {
      const query = ids(current.engine, { secret: { $not: { $ilike: '%x%' } } }, current.options)
      if (current.options?.forceCustomEntityStorage) expect(await query).toEqual([])
      else await expect(query).rejects.toThrow(TypeError)
    }
  })

  test('preserves OR siblings while a negative encrypted branch requires its own scoped index evidence', async () => {
    for (const current of engines()) {
      const result = await ids(current.engine, { $or: [{ secret: { $not: { $ilike: '%Daniel%' } } }, { id: identifiers.alpha }] }, current.options)
      expect(result).toEqual([identifiers.alpha, identifiers.omega].sort())
    }
  })

  test('custom-field negation excludes a record when any sibling value matches', async () => {
    const filters = { 'cf:labels': { $not: { $ilike: '%Daniel%' } } }
    for (const current of engines()) expect({ engine: current.name, ids: await ids(current.engine, filters, current.options) }).toEqual({ engine: current.name, ids: [identifiers.omega] })
  })

  test('encrypted custom-field arrays require correctly scoped field-level evidence', async () => {
    for (const current of engines()) {
      expect(await ids(current.engine, { 'cf:private': { $not: { $ilike: '%Daniel%' } } }, current.options)).toEqual([identifiers.omega])
      expect(await ids(current.engine, { 'cf:private': { $not: { $ilike: '%x%' } } }, current.options)).toEqual([])
      expect(await ids(current.engine, { $or: [{ 'cf:private': { $not: { $ilike: '%Daniel%' } } }, { id: identifiers.alpha }] }, current.options)).toEqual([identifiers.alpha, identifiers.omega].sort())
    }
  })

  test('disabling search rejects encrypted base negation and never admits ciphertext documents', async () => {
    const previous = process.env.OM_SEARCH_ENABLED
    process.env.OM_SEARCH_ENABLED = 'false'
    clearSearchTokenPresenceCache()
    try {
      for (const current of engines()) {
        const query = ids(current.engine, { secret: { $not: { $ilike: '%Daniel%' } } }, current.options)
        if (current.options?.forceCustomEntityStorage) expect(await query).toEqual([])
        else await expect(query).rejects.toThrow(TypeError)
      }
    } finally {
      if (previous === undefined) delete process.env.OM_SEARCH_ENABLED
      else process.env.OM_SEARCH_ENABLED = previous
      clearSearchTokenPresenceCache()
    }
  })

  test('keeps joined encrypted negation inside its original OR disjunct', async () => {
    const joins = [{ alias: 'profile', entityId: 'auth:profile', from: { field: 'id' }, to: { field: 'user_id' } }]
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      expect(await ids(current.engine, { $or: [
        { 'profile.secret': { $not: { $ilike: '%Daniel%' } } }, { id: identifiers.alpha },
      ] }, { joins })).toEqual([identifiers.alpha, identifiers.omega].sort())
      expect(await ids(current.engine, { $or: [
        { $and: [{ 'profile.secret': { $not: { $ilike: '%Daniel%' } } }, { display_name: 'Omega' }] },
        { id: identifiers.unindexed },
      ] }, { joins })).toEqual([identifiers.omega, identifiers.unindexed].sort())
    }
  })

  test('base-qualified negative leaves retain their OR sibling', async () => {
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      expect(await ids(current.engine, { $or: [
        { 'base.secret': { $not: { $ilike: '%Daniel%' } } }, { id: identifiers.alpha },
      ] })).toEqual([identifiers.alpha, identifiers.omega].sort())
    }
  })

  test('supports direct normalized negative arrays while retaining OR metadata', async () => {
    for (const current of engines()) {
      expect(await ids(current.engine, [
        { field: 'secret', op: 'not_ilike', value: '%Daniel%', orGroup: 'negative' },
        { field: 'id', op: 'eq', value: identifiers.alpha, orGroup: 'id' },
      ], current.options)).toEqual([identifiers.alpha, identifiers.omega].sort())
    }
  })

  test('unresolved and ambiguous sources reject negative filters instead of dropping them', async () => {
    const sourceCases: QueryOptions[] = [
      { filters: { 'unknown.secret': { $not: { $ilike: '%Daniel%' } } } },
      { joins: [{ alias: 'profile', table: 'profiles', from: { field: 'id' }, to: { field: 'user_id' } }], filters: { 'profile.secret': { $not: { $ilike: '%Daniel%' } } } },
      { joins: [{ alias: 'profile', entityId: 'auth:profile', from: { field: 'id' }, to: { field: 'user_id' } }], filters: { 'profile.missing': { $not: { $ilike: '%Daniel%' } } } },
    ]
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      for (const options of sourceCases) await expect(ids(current.engine, options.filters, options)).rejects.toThrow(TypeError)
    }
  })

  test.each([true, false])('secondary custom-field sources preserve their entity/record scope (explicit alias %s)', async (explicitAlias) => {
    const customFieldSources = [{ entityId: 'auth:profile', table: 'profiles', ...(explicitAlias ? { alias: 'person_profile' } : {}), join: { fromField: 'id', toField: 'user_id' } }]
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      const result = await current.engine.query<{ id: string }>(entity, {
        tenantId, organizationId, fields: ['id'], decryptEncryptedFields: false, skipAutoReindex: true,
        customFieldSources, filters: { 'cf:secondary_private': { $not: { $ilike: '%Daniel%' } } },
      })
      expect({ engine: current.name, ids: result.items.map((row) => row.id).sort(), total: result.total }).toEqual({ engine: current.name, ids: [identifiers.omega], total: 1 })
    }
  })

  test('duplicate custom-field keys keep base-source precedence in both data and count shapes', async () => {
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      const result = await current.engine.query<{ id: string }>(entity, {
        tenantId, organizationId, fields: ['id'], decryptEncryptedFields: false, skipAutoReindex: true, includeCustomFields: true,
        customFieldSources: [{ entityId: 'auth:profile', table: 'profiles', alias: 'person_profile', join: { fromField: 'id', toField: 'user_id' } }],
        filters: { 'cf:shared': { $not: { $ilike: '%Daniel%' } } },
      })
      expect({ engine: current.name, ids: result.items.map((row) => row.id).sort(), total: result.total }).toEqual({ engine: current.name, ids: [identifiers.omega], total: 1 })
    }
  })

  test('filter-only source resolution does not expand unrelated custom-field projection or joins', async () => {
    const basic = engines()[0].engine
    executedSql.length = 0
    const result = await basic.query<{ id: string }>(entity, {
      tenantId, organizationId, fields: ['id'], includeCustomFields: false, decryptEncryptedFields: false,
      filters: { 'cf:private': { $not: { $ilike: '%Daniel%' } } },
    })
    expect(result.items.map((row) => row.id)).toEqual([identifiers.omega])
    expect(result.total).toBe(1)
    expect(executedSql.join('\n')).not.toContain('cfv_base_unrelated_')
    for (const row of result.items) expect(Object.keys(row).some((key) => key.includes('unrelated_'))).toBe(false)
  })

  test('filter-only source resolution retains explicitly requested additional custom fields', async () => {
    const basic = engines()[0].engine
    const options: QueryOptions = { tenantId, organizationId, fields: ['id'], includeCustomFields: ['labels'], decryptEncryptedFields: false }
    const negative = await basic.query<Record<string, unknown>>(entity, { ...options, filters: { 'cf:private': { $not: { $ilike: '%Daniel%' } } } })
    const control = await basic.query<Record<string, unknown>>(entity, { ...options, filters: { id: identifiers.omega } })
    expect(negative.items.map((row) => row.id)).toEqual([identifiers.omega])
    expect(control.items).toHaveLength(1)
    const projectedKeys = Object.keys(control.items[0]).filter((key) => key.includes('labels'))
    expect(projectedKeys.length).toBeGreaterThan(0)
    for (const key of projectedKeys) expect(negative.items[0][key]).toEqual(control.items[0][key])
  })

  test('joined encrypted fields use the joined record and entity identity', async () => {
    for (const current of engines().filter((entry) => !entry.options?.forceCustomEntityStorage)) {
      const result = await ids(current.engine, { 'profile.secret': { $not: { $ilike: '%Daniel%' } } }, {
        joins: [{ alias: 'profile', entityId: 'auth:profile', from: { field: 'id' }, to: { field: 'user_id' } }],
      })
      expect(result).toEqual([identifiers.omega])
    }
  })
})
