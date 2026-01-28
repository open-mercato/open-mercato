import { syncRlsPolicies, hasAnyRlsPolicies, type RlsSyncResult } from '../rls-sync'

/**
 * Build a mock Knex instance that dispatches `.raw()` results based on the SQL
 * string content.  The `overrides` map lets each test control what specific
 * queries return.  Any unmatched query returns `{ rows: [] }` by default.
 */
function createMockKnex(overrides: Record<string, { rows: unknown[] }> = {}) {
  const calls: Array<{ sql: string; bindings?: unknown[] }> = []

  const knex = {
    raw: jest.fn(async (sql: string, bindings?: unknown[]) => {
      calls.push({ sql, bindings })

      for (const [pattern, result] of Object.entries(overrides)) {
        if (sql.includes(pattern)) return result
      }
      return { rows: [] }
    }),
    /** Helper — all raw() calls recorded for assertions */
    _calls: calls,
  }

  return knex as unknown as import('knex').Knex & { _calls: typeof calls }
}

// ---------------------------------------------------------------------------
// hasAnyRlsPolicies
// ---------------------------------------------------------------------------
describe('hasAnyRlsPolicies', () => {
  test('returns true when matching policies exist', async () => {
    const knex = createMockKnex({
      pg_policies: { rows: [{ tablename: 'orders' }] },
    })
    const result = await hasAnyRlsPolicies(knex)
    expect(result).toBe(true)
  })

  test('returns false when no matching policies exist', async () => {
    const knex = createMockKnex({
      pg_policies: { rows: [] },
    })
    const result = await hasAnyRlsPolicies(knex)
    expect(result).toBe(false)
  })

  test('queries pg_policies with correct prefix filter', async () => {
    const knex = createMockKnex()
    await hasAnyRlsPolicies(knex)
    expect(knex.raw).toHaveBeenCalledTimes(1)
    const sql = knex._calls[0].sql
    expect(sql).toContain('pg_policies')
    expect(sql).toContain('rls_tenant_isolation_')
  })
})

// ---------------------------------------------------------------------------
// syncRlsPolicies
// ---------------------------------------------------------------------------
describe('syncRlsPolicies', () => {
  /**
   * Helper that builds a mock knex with canned responses for the two
   * discovery queries plus optional per-table DDL behaviour.
   */
  function createSyncMockKnex(options: {
    tenantTables?: Array<{ table_name: string; is_nullable: string }>
    coveredTables?: string[]
    failingTables?: string[]
  }) {
    const { tenantTables = [], coveredTables = [], failingTables = [] } = options

    const coveredRows = coveredTables.map((t) => ({ tablename: t }))

    return createMockKnex({
      // First discovery: tables with tenant_id
      'information_schema.columns': { rows: tenantTables },
      // Second discovery: existing policies
      pg_policies: { rows: coveredRows },
      // For failing tables, the override matches the ENABLE statement
      ...Object.fromEntries(
        failingTables.map((t) => [
          `ENABLE ROW LEVEL SECURITY`,
          {
            rows: [],
            // We simulate failure by making the mock throw for ENABLE statements
            // on specific tables.  Since the pattern match is global, we use a
            // different approach: we inject an error-throwing mock below.
          },
        ]),
      ),
    })
  }

  test('returns empty result when no tenant tables exist', async () => {
    const knex = createSyncMockKnex({ tenantTables: [] })
    const result = await syncRlsPolicies(knex, { quiet: true })

    expect(result).toEqual<RlsSyncResult>({
      tablesChecked: 0,
      alreadyCovered: [],
      policiesCreated: [],
      failed: [],
    })
  })

  test('marks already-covered tables correctly', async () => {
    const knex = createSyncMockKnex({
      tenantTables: [
        { table_name: 'orders', is_nullable: 'NO' },
        { table_name: 'users', is_nullable: 'YES' },
      ],
      coveredTables: ['orders', 'users'],
    })

    const result = await syncRlsPolicies(knex, { quiet: true })

    expect(result.tablesChecked).toBe(2)
    expect(result.alreadyCovered).toEqual(['orders', 'users'])
    expect(result.policiesCreated).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  test('creates policies for uncovered tables', async () => {
    const knex = createSyncMockKnex({
      tenantTables: [
        { table_name: 'orders', is_nullable: 'NO' },
        { table_name: 'new_table', is_nullable: 'NO' },
      ],
      coveredTables: ['orders'],
    })

    const result = await syncRlsPolicies(knex, { quiet: true })

    expect(result.tablesChecked).toBe(2)
    expect(result.alreadyCovered).toEqual(['orders'])
    expect(result.policiesCreated).toEqual(['new_table'])
    expect(result.failed).toHaveLength(0)

    // Verify DDL was executed: ENABLE + FORCE + CREATE POLICY = 3 raw calls
    // Plus the 2 discovery queries = 5 total
    const ddlCalls = knex._calls.filter(
      (c) =>
        c.sql.includes('ENABLE ROW LEVEL') ||
        c.sql.includes('FORCE ROW LEVEL') ||
        c.sql.includes('CREATE POLICY'),
    )
    expect(ddlCalls).toHaveLength(3)
  })

  test('handles nullable tenant_id correctly', async () => {
    const knex = createSyncMockKnex({
      tenantTables: [{ table_name: 'roles', is_nullable: 'YES' }],
      coveredTables: [],
    })

    const result = await syncRlsPolicies(knex, { quiet: true })

    expect(result.policiesCreated).toEqual(['roles'])

    // The CREATE POLICY call should include nullable-aware clause
    const createPolicyCall = knex._calls.find((c) => c.sql.includes('CREATE POLICY'))
    expect(createPolicyCall).toBeDefined()
    expect(createPolicyCall!.sql).toContain('tenant_id IS NULL OR')
  })

  test('dry-run reports uncovered tables without executing DDL', async () => {
    const knex = createSyncMockKnex({
      tenantTables: [
        { table_name: 'orders', is_nullable: 'NO' },
        { table_name: 'new_table', is_nullable: 'NO' },
      ],
      coveredTables: ['orders'],
    })

    const result = await syncRlsPolicies(knex, { quiet: true, dryRun: true })

    expect(result.policiesCreated).toEqual(['new_table'])
    expect(result.alreadyCovered).toEqual(['orders'])

    // Only the 2 discovery queries should have run — no DDL
    expect(knex.raw).toHaveBeenCalledTimes(2)
  })

  test('records failures and continues to next table', async () => {
    const calls: Array<{ sql: string }> = []

    // Custom mock that fails specifically for the ENABLE statement on bad_table
    const knex = {
      raw: jest.fn(async (sql: string) => {
        calls.push({ sql })

        if (sql.includes('information_schema.columns')) {
          return {
            rows: [
              { table_name: 'good_table', is_nullable: 'NO' },
              { table_name: 'bad_table', is_nullable: 'NO' },
            ],
          }
        }
        if (sql.includes('pg_policies')) {
          return { rows: [] }
        }
        // Fail ENABLE on bad_table
        if (sql.includes('ENABLE') && sql.includes('bad_table')) {
          throw new Error('permission denied for table bad_table')
        }
        return { rows: [] }
      }),
    } as unknown as import('knex').Knex

    const result = await syncRlsPolicies(knex, { quiet: true })

    expect(result.policiesCreated).toEqual(['good_table'])
    expect(result.failed).toEqual([
      { table: 'bad_table', error: 'permission denied for table bad_table' },
    ])
  })

  test('quiet mode suppresses console output', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    const knex = createSyncMockKnex({
      tenantTables: [{ table_name: 'new_table', is_nullable: 'NO' }],
      coveredTables: [],
    })

    await syncRlsPolicies(knex, { quiet: true })

    expect(consoleSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('non-quiet mode logs created policies', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

    const knex = createSyncMockKnex({
      tenantTables: [{ table_name: 'new_table', is_nullable: 'NO' }],
      coveredTables: [],
    })

    await syncRlsPolicies(knex, { quiet: false })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('new_table'),
    )

    consoleSpy.mockRestore()
  })
})
