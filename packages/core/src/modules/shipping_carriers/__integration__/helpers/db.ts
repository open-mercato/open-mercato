import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

/**
 * Direct-Postgres fixtures for shipping_carriers integration specs.
 *
 * Some shipment states (e.g. `in_transit`, `delivered`) are only reachable
 * through asynchronous carrier webhooks/pollers, which are non-deterministic in
 * a test. These helpers set/read `carrier_shipments` rows directly so status
 * transition boundaries and persistence can be asserted deterministically — the
 * same `pg`-based approach already used by the shared `dbFixtures` helpers.
 *
 * They talk to `DATABASE_URL`, so the spec MUST run under a coherent app+DB
 * stack (the `yarn test:integration` / `yarn test:integration:ephemeral`
 * harness) where the app server and these fixtures share the same database.
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
  if (!url) throw new Error('[internal] DATABASE_URL is not configured for shipping_carriers DB fixtures')
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

export type CarrierShipmentRow = {
  unifiedStatus: string
  trackingNumber: string
  labelUrl: string | null
  organizationId: string
  tenantId: string
}

/** Forces a shipment's `unified_status` to a specific value (e.g. `in_transit`). */
export async function setCarrierShipmentStatusInDb(shipmentId: string, status: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      'update carrier_shipments set unified_status = $2, updated_at = now() where id = $1',
      [shipmentId, status],
    )
  })
}

/** Reads the persisted shipment row, or `null` when it does not exist. */
export async function getCarrierShipmentRowFromDb(shipmentId: string): Promise<CarrierShipmentRow | null> {
  return withClient(async (client) => {
    const result = await client.query<{
      unified_status: string
      tracking_number: string
      label_url: string | null
      organization_id: string
      tenant_id: string
    }>(
      `select unified_status, tracking_number, label_url, organization_id, tenant_id
         from carrier_shipments
        where id = $1
        limit 1`,
      [shipmentId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      unifiedStatus: row.unified_status,
      trackingNumber: row.tracking_number,
      labelUrl: row.label_url,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
    }
  })
}

/** Hard-deletes a shipment row (best-effort test cleanup). */
export async function deleteCarrierShipmentInDb(shipmentId: string | null): Promise<void> {
  if (!shipmentId) return
  await withClient(async (client) => {
    await client.query('delete from carrier_shipments where id = $1', [shipmentId])
  })
}
