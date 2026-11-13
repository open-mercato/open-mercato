import { readTenantBoundaryConfiguration, resolveTenantMaintenanceUrl, quoteBoundaryIdentifier } from '../config'
import { assertRuntimeRoleIdentity } from '../roles'
import { assertTenantOrmInventory, assertTenantTableInventory, loadTenantTableManifest, parseTenantTableManifest, type TenantCatalogTable } from '../manifest'
import { assertEffectiveTenantPolicies, canonicalTenantPolicyExpression, tenantPolicyName, type TenantPolicy } from '../policies'
import type { RuntimeRoleIdentity } from '../catalog'

const entry = {
  schema: 'public', table: 'customer_entities', owner: 'customers', classification: 'enforced',
  reason: 'Reviewed test canary', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false, policyVersion: 1,
}
const manifest = parseTenantTableManifest({ version: 1, tables: [entry] })
const table: TenantCatalogTable = {
  schema: 'public', table: 'customer_entities', oid: 42, kind: 'r', partitioned: false, inherited: false,
  row_security: true, force_row_security: true, tenant_type: 'uuid', tenant_not_null: true,
}
const policy: TenantPolicy = {
  table_oid: 42, name: tenantPolicyName, command: '*', permissive: true, roles: [0],
  using_expression: canonicalTenantPolicyExpression(), check_expression: canonicalTenantPolicyExpression(),
}
const role: RuntimeRoleIdentity = {
  current_role: 'runtime', session_role: 'runtime', role_id: 123, server_version: 160000,
  superuser: false, bypass: false, create_role: false, create_database: false, replication: false,
  login: true, memberships: false, owns_database: false, database_create: false, database_temp: false,
}

describe('activation and maintenance configuration', () => {
  it('keeps disabled behavior independent of enterprise topology or maintenance configuration', () => {
    expect(readTenantBoundaryConfiguration({})).toEqual({ enabled: false })
    expect(readTenantBoundaryConfiguration({ OM_TENANT_RLS: 'off', OM_TENANT_RLS_POOL_MODE: 'transaction' })).toEqual({ enabled: false })
  })

  it.each([undefined, '', 'transaction', 'unknown'])('rejects unsafe or undeclared active topology %s', (mode) => {
    expect(() => readTenantBoundaryConfiguration({ OM_TENANT_RLS: 'on', OM_TENANT_RLS_POOL_MODE: mode })).toThrow('direct or session')
  })

  it.each(['direct', 'session'])('accepts explicit supported %s topology', (mode) => {
    expect(readTenantBoundaryConfiguration({ OM_TENANT_RLS: 'on', OM_TENANT_RLS_POOL_MODE: mode })).toEqual({ enabled: true, poolMode: mode, schema: 'public' })
  })

  it('rejects misspelled activation and reserved or injected schemas', () => {
    expect(() => readTenantBoundaryConfiguration({ OM_TENANT_RLS: 'typo' })).toThrow('boolean')
    for (const schema of ['public;drop table users', 'pg_catalog', 'information_schema']) {
      expect(() => readTenantBoundaryConfiguration({ OM_TENANT_RLS: 'on', OM_TENANT_RLS_POOL_MODE: 'direct', OM_TENANT_RLS_SCHEMA: schema })).toThrow('identifier')
    }
    expect(() => quoteBoundaryIdentifier('public;drop')).toThrow('identifier')
  })

  it('requires a distinct maintenance role at the same database without echoing malformed URLs', () => {
    const runtime = 'postgresql://runtime@127.0.0.1/disposable'
    const maintenance = 'postgresql://maintenance@127.0.0.1/disposable'
    expect(resolveTenantMaintenanceUrl({ DATABASE_URL: runtime, OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: maintenance })).toBe(maintenance)
    expect(() => resolveTenantMaintenanceUrl({ DATABASE_URL: runtime, OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: runtime })).toThrow('distinct')
    expect(() => resolveTenantMaintenanceUrl({ DATABASE_URL: runtime, OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: maintenance.replace('disposable', 'other') })).toThrow('same database')
    expect(() => resolveTenantMaintenanceUrl({ DATABASE_URL: runtime, OM_TENANT_RLS_MAINTENANCE_DATABASE_URL: 'sensitive-invalid-marker' })).toThrow('[internal] Tenant boundary requires a PostgreSQL connection URL')
  })
})

describe('restricted runtime role', () => {
  it.each([160000, 170000, 180000])('accepts the supported server catalog major %s', (version) => {
    expect(() => assertRuntimeRoleIdentity({ ...role, server_version: version })).not.toThrow()
  })

  it.each(['superuser', 'bypass', 'create_role', 'create_database', 'replication', 'memberships', 'owns_database', 'database_create', 'database_temp'] as const)(
    'rejects effective privilege %s', (privilege) => {
      expect(() => assertRuntimeRoleIdentity({ ...role, [privilege]: true })).toThrow('unsafe')
    },
  )

  it('rejects unknown server versions, SET ROLE sessions and non-login identities', () => {
    expect(() => assertRuntimeRoleIdentity({ ...role, server_version: 150000 })).toThrow('16 through 18')
    expect(() => assertRuntimeRoleIdentity({ ...role, server_version: 190000 })).toThrow('16 through 18')
    expect(() => assertRuntimeRoleIdentity({ ...role, current_role: 'assumed' })).toThrow('unsafe')
    expect(() => assertRuntimeRoleIdentity({ ...role, login: false })).toThrow('unsafe')
  })
})

describe('reviewed table inventory', () => {
  it('enrolls only the explicit customer canary and resolves the configured schema', async () => {
    const loaded = await loadTenantTableManifest({ schema: 'application' })
    expect(loaded.tables.filter((entry) => entry.classification === 'enforced').map((entry) => [entry.schema, entry.table])).toEqual([['application', 'customer_entities']])
    expect(loaded.tables.every((entry) => entry.reason.length > 0 && entry.owner.length > 0)).toBe(true)
  })

  it('rejects duplicate identities, unsupported policy versions and nullable canaries', () => {
    expect(() => parseTenantTableManifest({ version: 1, tables: [entry, entry] })).toThrow('unique')
    expect(() => parseTenantTableManifest({ version: 1, tables: [{ ...entry, policyVersion: 2 }] })).toThrow('manifest')
    expect(() => parseTenantTableManifest({ version: 1, tables: [{ ...entry, tenantNullable: true }] })).toThrow('manifest')
    expect(() => parseTenantTableManifest({ version: 1, tables: [{ ...entry, classification: 'deferred', policyVersion: null }] })).toThrow('explicit enforced')
  })

  it('allows preflight before table creation but refuses runtime readiness before migration', () => {
    expect(() => assertTenantTableInventory(manifest, [], 'preflight')).not.toThrow()
    expect(() => assertTenantTableInventory(manifest, [], 'runtime')).toThrow('missing')
  })

  it('rejects an unclassified SQL table or newly discovered ORM entity', () => {
    expect(() => assertTenantTableInventory(manifest, [table, { ...table, table: 'unreviewed', oid: 43 }], 'runtime')).toThrow('unclassified')
    expect(() => assertTenantOrmInventory(manifest, [{ schema: 'public', table: 'unreviewed', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false }])).toThrow('unclassified')
  })

  it('cannot claim canary protection for an unused schema or mismatched column definition', () => {
    expect(() => assertTenantOrmInventory(manifest, [{ schema: 'unused', table: 'customer_entities', tenantColumn: null, tenantType: null, tenantNullable: null }])).toThrow('active ORM')
    expect(() => assertTenantTableInventory(manifest, [{ ...table, tenant_not_null: false }], 'runtime')).toThrow('differs')
    expect(() => assertTenantOrmInventory(manifest, [{ schema: 'public', table: 'customer_entities', tenantColumn: 'tenant_id', tenantType: 'text', tenantNullable: false }])).toThrow('differs')
  })

  it.each([{ partitioned: true }, { inherited: true }, { kind: 'f' }])('rejects unsupported canary topology %j', (change) => {
    expect(() => assertTenantTableInventory(manifest, [{ ...table, ...change }], 'runtime')).toThrow('does not support')
  })
})

describe('effective policy tuple', () => {
  it('requires FORCE/ENABLE and exactly the canonical all-command PUBLIC read/write predicate', () => {
    expect(() => assertEffectiveTenantPolicies(manifest, [table], [policy])).not.toThrow()
    expect(() => assertEffectiveTenantPolicies(manifest, [{ ...table, force_row_security: false }], [policy])).toThrow('forced')
    expect(() => assertEffectiveTenantPolicies(manifest, [table], [])).toThrow('missing or additional')
    expect(() => assertEffectiveTenantPolicies(manifest, [table], [policy, { ...policy, name: 'widening' }])).toThrow('additional')
  })

  it.each([
    { name: 'unowned' }, { command: 'r' }, { permissive: false }, { roles: [123] }, { roles: [0, 123] },
    { using_expression: 'true' }, { check_expression: 'true' }, { check_expression: null },
  ])('rejects policy drift %j', (change) => {
    expect(() => assertEffectiveTenantPolicies(manifest, [table], [{ ...policy, ...change }])).toThrow('canonical')
  })
})
