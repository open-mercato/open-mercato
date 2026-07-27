import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import { buildLegacyCheckoutRepairSql } from '../../migrations/Migration20260715120000'
import { buildRetireSeededCheckoutDemoSql } from '../../migrations/Migration20260716120000'

/**
 * Direct-Postgres fixtures for the checkout-demo repair migration
 * (`Migration20260715120000`, issue #4179).
 *
 * The migration is pure jsonb surgery: its whole risk lives in the SQL, not in
 * the rendered string. These helpers seed a legacy-shaped `workflow_definitions`
 * row (plus control rows that MUST stay untouched), run the migration's exact
 * exported SQL, and read the resulting `definition` back so the transformation
 * itself is asserted against a real database.
 *
 * They talk to `DATABASE_URL`, so the spec MUST run under a coherent app+DB
 * stack (the `yarn test:integration` harness) where the app server and these
 * fixtures share the same database.
 */

export type SeedWorkflowDefinitionInput = {
  workflowId?: string
  workflowName?: string
  version?: number
  codeWorkflowId?: string | null
  softDeleted?: boolean
  definition: Record<string, unknown>
}

export type SeededWorkflowDefinition = {
  id: string
  tenantId: string
  organizationId: string
}

/** Inserts one `workflow_definitions` row in an isolated synthetic tenant. */
export async function seedWorkflowDefinition(
  input: SeedWorkflowDefinitionInput,
): Promise<SeededWorkflowDefinition> {
  const id = randomUUID()
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  await withClient(async (client) => {
    await client.query(
      `insert into workflow_definitions (
         id, workflow_id, code_workflow_id, workflow_name, version,
         definition, enabled, tenant_id, organization_id,
         created_at, updated_at, deleted_at
       ) values (
         $1, $2, $3, $4, $5,
         $6::jsonb, true, $7, $8,
         now(), now(), $9
       )`,
      [
        id,
        input.workflowId ?? 'workflows.checkout-demo',
        input.codeWorkflowId ?? null,
        input.workflowName ?? 'Checkout with Payment Webhook',
        input.version ?? 1,
        JSON.stringify(input.definition),
        tenantId,
        organizationId,
        input.softDeleted ? new Date().toISOString() : null,
      ],
    )
  })
  return { id, tenantId, organizationId }
}

/** Reads back the persisted jsonb `definition` for a seeded row. */
export async function getWorkflowDefinition(id: string): Promise<Record<string, unknown> | null> {
  return withClient(async (client) => {
    const result = await client.query<{ definition: Record<string, unknown> }>(
      'select definition from workflow_definitions where id = $1',
      [id],
    )
    return result.rows[0]?.definition ?? null
  })
}

/** Reads whether a seeded row has been soft-deleted. */
export async function isWorkflowDefinitionSoftDeleted(id: string): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from workflow_definitions where id = $1',
      [id],
    )
    return result.rows[0]?.deleted_at != null
  })
}

/** Runs the migration's exact repair SQL. */
export async function runLegacyCheckoutRepair(): Promise<void> {
  await withClient(async (client) => {
    await client.query(buildLegacyCheckoutRepairSql())
  })
}

/** Runs the exact SQL that retires the seeded checkout-demo rows so the code definition is used (#4211). */
export async function runRetireSeededCheckoutDemo(): Promise<void> {
  await withClient(async (client) => {
    await client.query(buildRetireSeededCheckoutDemoSql())
  })
}

/** Best-effort cleanup of seeded rows. */
export async function deleteWorkflowDefinitions(ids: Array<string | null | undefined>): Promise<void> {
  const targets = ids.filter((value): value is string => Boolean(value))
  if (!targets.length) return
  await withClient(async (client) => {
    await client.query('delete from workflow_definitions where id = any($1::uuid[])', [targets])
  })
}
