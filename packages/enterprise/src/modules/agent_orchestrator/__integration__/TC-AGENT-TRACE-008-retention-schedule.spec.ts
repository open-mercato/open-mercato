import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { resolveIntegrationDatabaseUrl, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-TRACE-008: `mercato agent_orchestrator trace-retention:schedule`
 * registers the daily trace content retention schedule for an organization that
 * has none (#9648, C-4).
 *
 * Setup registers the schedule only for new tenants and organizations, so an
 * organization that existed before the worker shipped has no row. The test
 * reproduces that state by hard-deleting the fixture organization's schedule
 * row (whatever the organization-created hook registered), runs the real CLI
 * against the real database, and checks the row through SQL:
 *
 * - it exists again under the stable per-organization id, scoped to that
 *   organization, targeting the retention queue with the organization scope;
 * - a second run is an idempotent upsert (still exactly one row);
 * - narrowing with `--org` leaves other organizations untouched.
 *
 * The sweep itself is not driven here: the ephemeral environment runs no
 * scheduler poller and manual triggers need `QUEUE_STRATEGY=async`, and deletes
 * need a storage integration. Its cursor behaviour is covered by
 * `__tests__/trace-content-retention.test.ts`.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
const appDir = path.join(repoRoot, 'apps', 'mercato')
const AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE = 'agent-orchestrator-trace-content-retention'

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

type ScheduleRow = {
  id: string
  tenant_id: string | null
  organization_id: string | null
  scope_type: string
  target_queue: string | null
  target_payload: unknown
  schedule_value: string
  source_module: string | null
  is_enabled: boolean
}

function runScheduleCli(args: string[]): string {
  return execFileSync(process.execPath, [cliBin, 'agent_orchestrator', 'trace-retention:schedule', ...args], {
    cwd: appDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: resolveIntegrationDatabaseUrl(),
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })
}

async function readRetentionSchedules(organizationId: string): Promise<ScheduleRow[]> {
  return withClient(async (client) => {
    const result = await client.query<ScheduleRow>(
      `select id, tenant_id, organization_id, scope_type, target_queue, target_payload, schedule_value, source_module, is_enabled
         from scheduled_jobs
        where organization_id = $1 and target_queue = $2 and deleted_at is null`,
      [organizationId, AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE],
    )
    return result.rows
  })
}

async function deleteRetentionSchedules(organizationId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`delete from scheduled_jobs where organization_id = $1 and target_queue = $2`, [
      organizationId,
      AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
    ])
  })
}

test.describe('TC-AGENT-TRACE-008: trace content retention schedule CLI', () => {
  test('registers the missing per-organization schedule, idempotently and only for the selected organization', async ({
    request,
  }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(token)
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

    const stamp = Date.now()
    const targetOrgId = await createOrganizationFixture(request, token, { name: `TC-AGENT-TRACE-008 ${stamp}`, tenantId })
    const otherOrgId = await createOrganizationFixture(request, token, {
      name: `TC-AGENT-TRACE-008 other ${stamp}`,
      tenantId,
    })

    try {
      await deleteRetentionSchedules(targetOrgId)
      await deleteRetentionSchedules(otherOrgId)
      expect(await readRetentionSchedules(targetOrgId), 'the organization starts without a schedule').toHaveLength(0)

      const firstRun = runScheduleCli(['--tenant', tenantId, '--org', targetOrgId])
      expect(firstRun).toContain(`tenant=${tenantId} org=${targetOrgId}: registered`)
      expect(firstRun).toContain('Done. 1 organization(s): 1 registered, 0 failed.')

      const registered = await readRetentionSchedules(targetOrgId)
      expect(registered).toHaveLength(1)
      expect(registered[0]).toMatchObject({
        id: stableScheduleUuid(`agent_orchestrator:trace-content-retention:${targetOrgId}`),
        tenant_id: tenantId,
        organization_id: targetOrgId,
        scope_type: 'organization',
        target_queue: AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
        schedule_value: '86400s',
        source_module: 'agent_orchestrator',
        is_enabled: true,
      })
      expect(registered[0].target_payload).toEqual({ scope: { tenantId, organizationId: targetOrgId } })

      runScheduleCli(['--tenant', tenantId, '--org', targetOrgId])
      expect(await readRetentionSchedules(targetOrgId), 'a re-run upserts the same row').toHaveLength(1)

      expect(
        await readRetentionSchedules(otherOrgId),
        '--org narrows the run to the selected organization',
      ).toHaveLength(0)
    } finally {
      await deleteRetentionSchedules(targetOrgId).catch(() => undefined)
      await deleteRetentionSchedules(otherOrgId).catch(() => undefined)
      await deleteOrganizationIfExists(request, token, targetOrgId)
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })
})
