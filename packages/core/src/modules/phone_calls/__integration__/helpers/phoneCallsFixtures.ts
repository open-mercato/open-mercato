import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

/**
 * Seeds phone calls straight into Postgres.
 *
 * The hub is ingest-only by design: calls are facts received from a provider, so
 * there is no create API to build fixtures with and adding one purely for tests
 * would put a permanent contract surface into the OSS package. Raw SQL follows the
 * precedent already set by `@open-mercato/core/helpers/integration/dbFixtures`.
 *
 * Only unencrypted columns are written. `raw_snapshot`, `provider_facts` and
 * `recording_url` are encrypted by `TenantEncryptionSubscriber` on the ORM write
 * path, which a direct INSERT bypasses; all three are nullable, so leaving them
 * NULL keeps the row readable through QueryEngine's decrypting list path.
 *
 * Query seeded rows through a run-unique filter: an INSERT bypasses the cache invalidation
 * the ingest command triggers, so a repeating query key is served an earlier run's payload.
 */

type EphemeralState = { databaseUrl?: string; baseUrl?: string }

function readEphemeralState(): EphemeralState | null {
  try {
    const statePath = path.resolve(process.cwd(), '.ai/qa/ephemeral-env.json')
    return JSON.parse(readFileSync(statePath, 'utf8')) as EphemeralState
  } catch {
    return null
  }
}

/**
 * Prefers the ephemeral environment's database over anything in the ambient env.
 * The ephemeral Postgres runs on a random port that never reaches
 * `apps/mercato/.env`, so resolving via env first would silently seed the
 * developer's own dev database instead of the throwaway one.
 */
function resolveDatabaseUrl(): string {
  const fromState = readEphemeralState()?.databaseUrl
  if (fromState) return fromState
  const fromEnv = process.env.DATABASE_URL?.trim()
  if (fromEnv) return fromEnv
  throw new Error('[internal] No databaseUrl in .ai/qa/ephemeral-env.json and no DATABASE_URL set')
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

export type SeedPhoneCallInput = {
  organizationId: string
  tenantId: string
  externalCallId: string
  direction: 'inbound' | 'outbound' | 'internal' | 'unknown'
  status: 'new' | 'ringing' | 'answered' | 'missed' | 'failed' | 'completed' | 'unknown'
  providerKey?: string
  externalConversationId?: string | null
  startedAt?: Date | null
  durationSeconds?: number | null
  ingestStatus?: string
}

export async function seedPhoneCalls(inputs: SeedPhoneCallInput[]): Promise<string[]> {
  if (!inputs.length) return []
  return withClient(async (client) => {
    const ids: string[] = []
    for (const input of inputs) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO phone_calls (
           organization_id, tenant_id, provider_key, external_call_id, external_conversation_id,
           direction, status, started_at, duration_seconds, ingest_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         RETURNING id`,
        [
          input.organizationId,
          input.tenantId,
          input.providerKey ?? 'tillio',
          input.externalCallId,
          input.externalConversationId ?? null,
          input.direction,
          input.status,
          input.startedAt ?? null,
          input.durationSeconds ?? null,
          input.ingestStatus ?? 'ingested',
        ],
      )
      ids.push(result.rows[0].id)
    }
    return ids
  })
}

export async function deletePhoneCallsIfExist(ids: Array<string | null>): Promise<void> {
  const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!present.length) return
  await withClient(async (client) => {
    await client.query('DELETE FROM phone_calls WHERE id = ANY($1::uuid[])', [present])
  }).catch(() => undefined)
}
