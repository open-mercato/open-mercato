import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { importFromAppRuntime } from '@open-mercato/core/helpers/integration/appRuntime'
import type { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { EventBus } from '@open-mercato/events/types'
import type { IngestPhoneCallInput } from '../../data/validators'
import type { IngestPhoneCallResult } from '../../commands/calls'

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
  /**
   * Written as plain text, unlike the ORM path which encrypts it. Only for asserting that a
   * surface does NOT return the column: anything that projects it would have to decrypt, and
   * this value is not ciphertext. Leave unset for every other fixture.
   */
  recordingUrl?: string | null
}

type PhoneCallFixtureScope = ReturnType<typeof getTokenScope>

export const phoneCallEntityType = 'phone_calls:phone_call'

export async function seedPhoneCalls(inputs: SeedPhoneCallInput[]): Promise<string[]> {
  if (!inputs.length) return []
  return withClient(async (client) => {
    const ids: string[] = []
    for (const input of inputs) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO phone_calls (
           organization_id, tenant_id, provider_key, external_call_id, external_conversation_id,
           direction, status, started_at, duration_seconds, ingest_status, recording_url,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
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
          input.recordingUrl ?? null,
        ],
      )
      ids.push(result.rows[0].id)
    }
    return ids
  })
}

async function createPhoneCallFixtureContainer() {
  const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || 'apps/mercato')
  const { bootstrapFromAppRoot } = await importFromAppRuntime<
    typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  >('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  const { createRequestContainer } = await importFromAppRuntime<
    typeof import('@open-mercato/shared/lib/di/container')
  >('@open-mercato/shared/lib/di/container')
  await bootstrapFromAppRoot(appRoot)
  return createRequestContainer()
}

export async function ingestPhoneCallFixture(
  scope: PhoneCallFixtureScope,
  input: Omit<IngestPhoneCallInput, 'tenantId' | 'organizationId'>,
): Promise<IngestPhoneCallResult> {
  const container = await createPhoneCallFixtureContainer()
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { tenantId, organizationId, userId } = scope
  const result = await commandBus.execute<IngestPhoneCallInput, IngestPhoneCallResult>('phone_calls.call.ingest', {
    input: { ...input, tenantId, organizationId },
    ctx: {
      container,
      auth: { sub: userId, tenantId, orgId: organizationId, isSuperAdmin: false },
      organizationScope: {
        selectedId: organizationId,
        filterIds: [organizationId],
        allowedIds: [organizationId],
        tenantId,
      },
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    },
  })
  return result.result
}

export async function deleteIngestedPhoneCallFixture(scope: PhoneCallFixtureScope, id: string | null): Promise<void> {
  if (!id) return
  const { tenantId, organizationId } = scope
  await withClient(async (client) => {
    await client.query('delete from phone_calls where id = $1 and tenant_id = $2 and organization_id = $3', [id, tenantId, organizationId])
  })

  const container = await createPhoneCallFixtureContainer()
  await container.resolve<EventBus>('eventBus').emitEvent('query_index.delete_one', {
    entityType: phoneCallEntityType, recordId: id, tenantId, organizationId, suppressCoverage: true,
  }, { rethrowHandlerErrors: true })
}

export async function deletePhoneCallsIfExist(ids: Array<string | null>): Promise<void> {
  const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!present.length) return
  await withClient(async (client) => {
    await client.query('DELETE FROM phone_calls WHERE id = ANY($1::uuid[])', [present])
  }).catch(() => undefined)
}
