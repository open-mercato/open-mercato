import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

/**
 * Direct-Postgres fixtures for data_sync integration specs.
 *
 * Sync run status (`completed`/`failed`/`running`) is normally only reachable by
 * letting the queue worker process a run, which is non-deterministic in a test
 * (and, under AUTO_SPAWN_WORKERS, auto-completes real imports). These helpers
 * insert `sync_runs` rows directly so run status, ordering, and counts can be
 * asserted deterministically without going through the queue — the same
 * `pg`-based approach already used by the shared `dbFixtures` helpers.
 *
 * They talk to `DATABASE_URL`, so the spec MUST run under a coherent app+DB
 * stack (the `yarn test:integration` harness) where the app server and these
 * fixtures share the same database.
 */

function resolveAppRoot(): string {
  const fromEnv = process.env.OM_TEST_APP_ROOT?.trim()
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), 'apps/mercato')
}

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  const candidatePaths = [
    path.resolve(resolveAppRoot(), '.env'),
    path.resolve(process.cwd(), 'apps/mercato/.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8')
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
      if (match?.[1]) return match[1].trim()
    } catch {
      continue
    }
  }
  return undefined
}

function resolveDatabaseUrl(): string {
  const url = readEnvValue('DATABASE_URL')
  if (!url) throw new Error('[internal] DATABASE_URL is not configured for data_sync DB fixtures')
  return url
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export type SyncRunScope = {
  organizationId: string
  tenantId: string
}

export type SeedSyncRunInput = SyncRunScope & {
  id?: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  createdAt?: Date
  updatedAt?: Date
  lastError?: string | null
}

/**
 * Decodes the tenant/organization scope from an integration-test JWT so seeded
 * rows match the scope the API filters by (`auth.orgId` / `auth.tenantId`).
 */
export function decodeTokenScope(token: string): SyncRunScope {
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('[internal] malformed auth token')
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
    tenantId?: string
    orgId?: string | null
  }
  if (!payload.orgId || !payload.tenantId) {
    throw new Error('[internal] auth token is missing orgId/tenantId claims')
  }
  return { organizationId: payload.orgId, tenantId: payload.tenantId }
}

/**
 * Inserts `sync_runs` rows directly (bypassing the queue/worker) so run status
 * and ordering are deterministic. Returns the row ids in input order.
 */
export async function seedSyncRuns(rows: SeedSyncRunInput[]): Promise<string[]> {
  if (rows.length === 0) return []
  return withClient(async (client) => {
    const ids: string[] = []
    for (const row of rows) {
      const id = row.id ?? randomUUID()
      const createdAt = row.createdAt ?? new Date()
      const updatedAt = row.updatedAt ?? createdAt
      await client.query(
        `insert into sync_runs
           (id, integration_id, entity_type, direction, status,
            created_count, updated_count, skipped_count, failed_count, batches_completed,
            last_error, organization_id, tenant_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0, $6, $7, $8, $9, $10)`,
        [
          id,
          row.integrationId,
          row.entityType,
          row.direction,
          row.status,
          row.lastError ?? null,
          row.organizationId,
          row.tenantId,
          createdAt,
          updatedAt,
        ],
      )
      ids.push(id)
    }
    return ids
  })
}

/** Convenience wrapper to seed a single run and return its id. */
export async function seedSyncRun(row: SeedSyncRunInput): Promise<string> {
  const [id] = await seedSyncRuns([row])
  return id
}

/** Hard-deletes every `sync_runs` row for an integration (best-effort cleanup). */
export async function deleteSyncRunsByIntegration(integrationId: string): Promise<void> {
  if (!integrationId) return
  await withClient(async (client) => {
    await client.query('delete from sync_runs where integration_id = $1', [integrationId])
  })
}

/** Hard-deletes every `sync_schedules` row for an integration (best-effort cleanup). */
export async function deleteSyncSchedulesByIntegration(integrationId: string): Promise<void> {
  if (!integrationId) return
  await withClient(async (client) => {
    await client.query('delete from sync_schedules where integration_id = $1', [integrationId])
  })
}
