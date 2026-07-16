import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Direct-DB seed helpers for the TC-AGENT-UX-P0-* specs.
 *
 * `agent_processes` is a projection maintained by event subscribers — there is
 * deliberately no create API, so process-detail UI assertions seed the row
 * directly (same dbFixtures precedent as agentPerfFixtures.ts, incl. its
 * DATABASE_URL caveat). `subject_title` stays null so the tenant-encryption
 * flush hook is never involved.
 */

export type AgentProcessSeed = {
  tenantId: string
  organizationId: string
  processId?: string
  status?: string
  subjectType?: string | null
  subjectLabel?: string | null
}

/** Inserts one agent_processes projection row; returns its process id. */
export async function insertAgentProcessFixture(seed: AgentProcessSeed): Promise<string> {
  const id = randomUUID()
  const processId = seed.processId ?? randomUUID()
  const now = new Date()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_processes (
         id, tenant_id, organization_id, process_id, status, subject_type, subject_label,
         run_count, pending_proposal_count, opened_at, last_activity_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, 1, 0, $8, $8, $8, $8)`,
      [
        id,
        seed.tenantId,
        seed.organizationId,
        processId,
        seed.status ?? 'running',
        seed.subjectType ?? 'deal',
        seed.subjectLabel ?? 'TC-AGENT-UX',
        now,
      ],
    )
  })
  return processId
}

export async function deleteAgentProcessesForOrganization(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    await client.query('delete from agent_processes where organization_id = $1', [organizationId])
  })
}

export type AgentGuardrailCheckSeed = {
  tenantId: string
  organizationId: string
  agentRunId: string
  proposalId?: string | null
  phase?: 'input' | 'output'
  kind?: string
  result?: 'pass' | 'warn' | 'block'
  capability?: string
  guardrailSetVersion?: string
}

/** Inserts guardrail-check rows for a run (feeds the trace inspector's Guardrails card); returns ids. */
export async function insertAgentGuardrailCheckFixtures(rows: AgentGuardrailCheckSeed[]): Promise<string[]> {
  const ids: string[] = []
  await withClient(async (client) => {
    for (const row of rows) {
      const id = randomUUID()
      ids.push(id)
      await client.query(
        `insert into agent_guardrail_checks (
           id, tenant_id, organization_id, agent_run_id, proposal_id,
           guardrail_set_version, capability, phase, kind, result, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          id,
          row.tenantId,
          row.organizationId,
          row.agentRunId,
          row.proposalId ?? null,
          row.guardrailSetVersion ?? 'tc-uxc-006',
          row.capability ?? 'tc.smoke',
          row.phase ?? 'output',
          row.kind ?? 'pii',
          row.result ?? 'warn',
        ],
      )
    }
  })
  return ids
}

export async function deleteAgentGuardrailChecksByIds(ids: string[]): Promise<void> {
  if (!ids.length) return
  await withClient(async (client) => {
    await client.query('delete from agent_guardrail_checks where id = any($1::uuid[])', [ids])
  })
}
