import { randomUUID } from 'node:crypto'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * Direct-DB seed helpers for the TC-AGENT-PERF-* specs.
 *
 * Agent runs and proposals are produced by the agent runtime (an AI round-trip)
 * and are NOT creatable through any public API — the same constraint documented
 * in TC-AGENT-TRACE-002. Deterministic ordering/pagination/metrics assertions
 * additionally need explicit `created_at` values, which no ingest path offers.
 * Rows are therefore inserted directly via `pg`, mirroring the established
 * dbFixtures precedent (TC-CRM-072). Both tables reference other records by
 * plain uuid columns (no FK constraints — module decoupling), so seeds are
 * self-contained.
 *
 * CAVEAT (same as every dbFixtures consumer): `withClient` resolves
 * DATABASE_URL from the environment or `apps/mercato/.env`, so these helpers
 * target the STANDARD integration environment's database. Against an ephemeral
 * app with its own database, export DATABASE_URL to match the app under test.
 */

export type AgentRunSeed = {
  tenantId: string
  organizationId: string
  agentId: string
  status?: 'running' | 'ok' | 'error' | 'cancelled'
  createdAt: Date
}

export type AgentProposalSeed = {
  tenantId: string
  organizationId: string
  agentId: string
  runId: string
  disposition?: 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'
  confidence?: number | null
  processId?: string | null
  stepId?: string | null
  createdAt: Date
}

const SEED_PAYLOAD = JSON.stringify({ seededBy: 'TC-AGENT-PERF' })
const INSERT_CHUNK_SIZE = 50

/** Inserts agent_runs rows with explicit timestamps; returns the new ids (input order). */
export async function insertAgentRunFixtures(rows: AgentRunSeed[]): Promise<string[]> {
  const ids = rows.map(() => randomUUID())
  await withClient(async (client) => {
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE)
      const tuples: string[] = []
      const params: unknown[] = []
      chunk.forEach((row, index) => {
        const base = params.length
        tuples.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 7})`,
        )
        params.push(
          ids[start + index],
          row.tenantId,
          row.organizationId,
          row.agentId,
          row.status ?? 'ok',
          SEED_PAYLOAD,
          row.createdAt,
        )
      })
      await client.query(
        `insert into agent_runs (id, tenant_id, organization_id, agent_id, status, input, created_at, updated_at)
         values ${tuples.join(', ')}`,
        params,
      )
    }
  })
  return ids
}

/** Inserts agent_proposals rows with explicit timestamps; returns the new ids (input order). */
export async function insertAgentProposalFixtures(rows: AgentProposalSeed[]): Promise<string[]> {
  const ids = rows.map(() => randomUUID())
  await withClient(async (client) => {
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE)
      const tuples: string[] = []
      const params: unknown[] = []
      chunk.forEach((row, index) => {
        const base = params.length
        tuples.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 11})`,
        )
        params.push(
          ids[start + index],
          row.tenantId,
          row.organizationId,
          row.agentId,
          row.runId,
          SEED_PAYLOAD,
          row.confidence ?? null,
          row.disposition ?? 'pending',
          row.processId ?? null,
          row.stepId ?? null,
          row.createdAt,
        )
      })
      await client.query(
        `insert into agent_proposals (id, tenant_id, organization_id, agent_id, run_id, payload, confidence, disposition, process_id, step_id, created_at, updated_at)
         values ${tuples.join(', ')}`,
        params,
      )
    }
  })
  return ids
}

/** Hard-deletes seeded agent_runs rows by id (best-effort cleanup). */
export async function deleteAgentRunsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from agent_runs where id = any($1::uuid[])', [ids])
  })
}

/** Hard-deletes seeded agent_proposals rows by id (best-effort cleanup). */
export async function deleteAgentProposalsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from agent_proposals where id = any($1::uuid[])', [ids])
  })
}

/** Hard-deletes agent_eval_cases rows by id (cleanup for add-to-evals specs — no delete API exists). */
export async function deleteAgentEvalCasesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withClient(async (client) => {
    await client.query('delete from agent_eval_cases where id = any($1::uuid[])', [ids])
  })
}

/**
 * Hard-deletes every agent_runs/agent_proposals row of a throwaway
 * organization — the blanket cleanup for specs that own a fresh org.
 */
export async function deleteAgentOrchestratorRowsForOrganization(
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) return
  await withClient(async (client) => {
    await client.query('delete from agent_proposals where organization_id = $1', [organizationId])
    await client.query('delete from agent_runs where organization_id = $1', [organizationId])
  })
}
