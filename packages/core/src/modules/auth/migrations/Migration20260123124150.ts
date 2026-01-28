import { Migration } from '@mikro-orm/migrations'

/**
 * Enable Row-Level Security (RLS) for tenant isolation.
 *
 * This migration:
 * 1. Discovers all tables with a `tenant_id` column
 * 2. Enables RLS on each table
 * 3. Creates a tenant isolation policy that filters rows by the session variable
 *
 * The session variable `app.current_tenant_id` must be set before queries execute.
 * When RLS_ENABLED=true, the application sets this variable in the request context.
 *
 * RLS acts as defense-in-depth: even if application code forgets tenant filters,
 * the database will enforce isolation automatically.
 *
 * Policy behavior:
 * - If `app.current_tenant_id` is set: only rows matching that tenant are visible
 * - If `app.current_tenant_id` is not set or empty: no rows are visible (secure by default)
 * - Tables with nullable `tenant_id`: NULL tenant_id rows are visible to all (system data)
 */
export class Migration20260123124150 extends Migration {
  override async up(): Promise<void> {
    // Find all tables with tenant_id column
    const tablesResult = await this.execute(`
      SELECT DISTINCT c.table_name, c.is_nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
      WHERE c.column_name = 'tenant_id'
        AND c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `)

    const tables = tablesResult as Array<{ table_name: string; is_nullable: string }>

    for (const { table_name, is_nullable } of tables) {
      const tableName = table_name
      const policyName = `rls_tenant_isolation_${tableName}`
      const isNullable = is_nullable === 'YES'

      // Enable RLS on the table
      this.addSql(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`)

      // Force RLS for table owner too (important for security)
      this.addSql(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;`)

      // Create tenant isolation policy
      // For nullable tenant_id: allow NULL tenant_id rows (system data) to be visible
      // For non-nullable: strict tenant matching only
      if (isNullable) {
        this.addSql(`
          CREATE POLICY "${policyName}" ON "${tableName}"
            FOR ALL
            USING (
              tenant_id IS NULL
              OR (
                NULLIF(current_setting('app.current_tenant_id', true), '') IS NOT NULL
                AND tenant_id = current_setting('app.current_tenant_id', true)::UUID
              )
            )
            WITH CHECK (
              tenant_id IS NULL
              OR (
                NULLIF(current_setting('app.current_tenant_id', true), '') IS NOT NULL
                AND tenant_id = current_setting('app.current_tenant_id', true)::UUID
              )
            );
        `)
      } else {
        this.addSql(`
          CREATE POLICY "${policyName}" ON "${tableName}"
            FOR ALL
            USING (
              NULLIF(current_setting('app.current_tenant_id', true), '') IS NOT NULL
              AND tenant_id = current_setting('app.current_tenant_id', true)::UUID
            )
            WITH CHECK (
              NULLIF(current_setting('app.current_tenant_id', true), '') IS NOT NULL
              AND tenant_id = current_setting('app.current_tenant_id', true)::UUID
            );
        `)
      }
    }
  }

  override async down(): Promise<void> {
    // Find all tables with tenant_id column and drop their RLS policies
    const tablesResult = await this.execute(`
      SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
      WHERE c.column_name = 'tenant_id'
        AND c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `)

    const tables = tablesResult as Array<{ table_name: string }>

    for (const { table_name } of tables) {
      const tableName = table_name
      const policyName = `rls_tenant_isolation_${tableName}`

      // Drop the policy (IF EXISTS for safety)
      this.addSql(`DROP POLICY IF EXISTS "${policyName}" ON "${tableName}";`)

      // Disable RLS on the table
      this.addSql(`ALTER TABLE "${tableName}" NO FORCE ROW LEVEL SECURITY;`)
      this.addSql(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY;`)
    }
  }
}
