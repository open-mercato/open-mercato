import { expect, test } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['configs'] }

/**
 * TC-CONF-011: `mercato configs upgrade-actions list|up|down`
 * Spec: .ai/specs/2026-11-23-module-owned-upgrade-actions.md (Phase 2)
 *
 * Runs the installed CLI entry point against the same database as the app, in a
 * fixture tenant with two fixture organizations, so every effect — including the
 * tenant-wide schedule registrations — stays inside that tenant. The CLI process
 * enables upgrade actions and the configs test-only reversible action through its
 * own environment; the app server's configuration is untouched. Cleanup removes
 * every row of the fixture tenant in `afterAll`.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..')
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js')
const appDir = path.join(repoRoot, 'apps', 'mercato')

const FIXTURE_ACTION = 'configs.test-reversible-fixture'
const FIXTURE_VERSION = '0.0.1'
const FIXTURE_TARGET = ['--action', FIXTURE_ACTION, '--version', FIXTURE_VERSION]
const CLI_ENV = {
  UPGRADE_ACTIONS_ENABLED: 'true',
  OM_UPGRADE_ACTION_TEST_FIXTURES: '1',
  FORCE_COLOR: '0',
  NODE_NO_WARNINGS: '1',
}

type CliResult = { status: number | null; stdout: string; stderr: string }
type ListedState = { module: string; id: string; version: string; state: 'applied' | 'pending'; scope: string; detail: string }

function cliArgs(args: string[]): string[] {
  return [cliBin, 'configs', 'upgrade-actions', ...args]
}

function runCli(args: string[], extraEnv: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, cliArgs(args), {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, ...CLI_ENV, ...extraEnv },
    timeout: 180_000,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function runCliAsync(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, cliArgs(args), { cwd: appDir, env: { ...process.env, ...CLI_ENV } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function scope(tenantId: string, organizationId: string): string[] {
  return ['--tenant', tenantId, '--organization', organizationId]
}

const LIST_LINE = /^ (\S+): (\S+)@(\S+) (applied|pending) \(([^,]+), ([^)]+)\)$/

function parseList(stdout: string): ListedState[] {
  return stdout
    .split('\n')
    .map((line) => LIST_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, module, id, version, state, scopeLabel, detail]) => ({
      module,
      id,
      version,
      state: state as ListedState['state'],
      scope: scopeLabel,
      detail,
    }))
}

async function ledger(tenantId: string, organizationId?: string): Promise<Array<{ action_id: string; version: string; organization_id: string }>> {
  return withClient(async (client) => {
    const result = await client.query<{ action_id: string; version: string; organization_id: string }>(
      `select action_id, version, organization_id from upgrade_action_runs
        where tenant_id = $1 and ($2::uuid is null or organization_id = $2::uuid)
        order by version, action_id`,
      [tenantId, organizationId ?? null],
    )
    return result.rows
  })
}

async function fixtureConfigRows(tenantId: string, organizationId: string): Promise<Array<{ value_json: unknown }>> {
  return withClient(async (client) => {
    const result = await client.query<{ value_json: unknown }>(
      `select value_json from module_configs
        where module_id = 'configs' and name = $3 and tenant_id = $1 and organization_id = $2`,
      [tenantId, organizationId, `upgrade_action_test_fixture:${organizationId}`],
    )
    return result.rows
  })
}

async function createTenantInDb(): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into tenants (id, name, is_active, created_at, updated_at)
       values (gen_random_uuid(), $1, true, now(), now()) returning id`,
      [`QA upgrade actions CLI ${Date.now()}`],
    )
    return result.rows[0].id
  })
}

async function deleteTenantEverywhere(tenantId: string | null): Promise<void> {
  if (!tenantId) return
  await withClient(async (client) => {
    const tables = await client.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
        where table_schema = current_schema() and column_name = 'tenant_id'
          and table_name not in ('organizations', 'tenants')`,
    )
    for (let pass = 0; pass < 5; pass += 1) {
      let blocked = false
      for (const { table_name: table } of tables.rows) {
        try {
          await client.query(`delete from "${table}" where tenant_id = $1`, [tenantId])
        } catch {
          blocked = true
        }
      }
      if (!blocked) break
    }
    await client.query('delete from organizations where tenant_id = $1', [tenantId])
    await client.query('delete from tenants where id = $1', [tenantId])
  })
}

test.describe.serial('TC-CONF-011: configs upgrade-actions CLI', () => {
  test.describe.configure({ timeout: 300_000 })

  let tenantId: string | null = null
  let organizationA = ''
  let organizationB = ''
  let foreignOrganizationId = ''

  test.beforeAll(async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    foreignOrganizationId = getTokenContext(token).organizationId
    tenantId = await createTenantInDb()
    organizationA = await createOrganizationInDb({ name: 'QA upgrade CLI A', tenantId })
    organizationB = await createOrganizationInDb({ name: 'QA upgrade CLI B', tenantId })
  })

  test.afterAll(async () => {
    await deleteTenantEverywhere(tenantId)
  })

  test('prints help without a scope', () => {
    const result = runCli(['--help'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Usage: yarn mercato configs upgrade-actions')
  })

  test('refuses a malformed, unknown, foreign or inactive scope before any write', async () => {
    const tenant = tenantId as string
    const before = await ledger(tenant)

    const malformed = runCli(['list', '--tenant', 'not-a-uuid', '--organization', organizationA])
    expect(malformed.status).toBe(1)
    expect(malformed.stderr).toContain('Invalid --tenant')

    for (const organizationId of [randomUUID(), foreignOrganizationId]) {
      const result = runCli(['up', ...scope(tenant, organizationId)])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('not an active organization of an active tenant')
    }

    const inactive = await createOrganizationInDb({ name: 'QA upgrade CLI inactive', tenantId: tenant })
    await withClient((client) => client.query('update organizations set is_active = false where id = $1', [inactive]))
    const inactiveResult = runCli(['up', ...scope(tenant, inactive)])
    expect(inactiveResult.status).toBe(1)
    expect(await ledger(tenant)).toEqual(before)
  })

  test('applies, no-ops, reverts and reapplies the reversible fixture through one ledger', async () => {
    const tenant = tenantId as string
    const pending = parseList(runCli(['list', ...scope(tenant, organizationA)]).stdout)
    expect(pending.find((entry) => entry.id === FIXTURE_ACTION)).toMatchObject({
      module: 'configs',
      state: 'pending',
      scope: 'organization',
      detail: 'reversible',
    })

    const applied = runCli(['up', ...scope(tenant, organizationA), ...FIXTURE_TARGET])
    expect(applied.status, applied.stderr).toBe(0)
    expect(applied.stdout).toContain(' configs: 1 upgrade action applied')
    expect(await fixtureConfigRows(tenant, organizationA)).toHaveLength(1)
    expect((await ledger(tenant, organizationA)).filter((row) => row.action_id === FIXTURE_ACTION)).toHaveLength(1)

    const again = runCli(['up', ...scope(tenant, organizationA), ...FIXTURE_TARGET])
    expect(again.status, again.stderr).toBe(0)
    expect(again.stdout).toContain(' configs: no pending upgrade actions')

    const listed = parseList(runCli(['list', ...scope(tenant, organizationA)]).stdout)
    expect(listed.find((entry) => entry.id === FIXTURE_ACTION)?.state).toBe('applied')

    const reverted = runCli(['down', ...scope(tenant, organizationA), ...FIXTURE_TARGET])
    expect(reverted.status, reverted.stderr).toBe(0)
    expect(reverted.stdout).toContain(' configs: 1 upgrade action reverted')
    expect(await fixtureConfigRows(tenant, organizationA)).toHaveLength(0)
    expect((await ledger(tenant, organizationA)).filter((row) => row.action_id === FIXTURE_ACTION)).toHaveLength(0)

    const reapplied = runCli(['up', ...scope(tenant, organizationA), ...FIXTURE_TARGET])
    expect(reapplied.status, reapplied.stderr).toBe(0)
    expect(reapplied.stdout).toContain(' configs: 1 upgrade action applied')
  })

  test('keeps the action applied when the compensation rejects changed data', async () => {
    const tenant = tenantId as string
    await withClient((client) =>
      client.query(
        `update module_configs set value_json = '{"marker":"edited by an operator"}'::jsonb
          where module_id = 'configs' and name = $3 and tenant_id = $1 and organization_id = $2`,
        [tenant, organizationA, `upgrade_action_test_fixture:${organizationA}`],
      ),
    )
    const refused = runCli(['down', ...scope(tenant, organizationA), ...FIXTURE_TARGET])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain(`${FIXTURE_ACTION}@${FIXTURE_VERSION} was not reverted: handler failed`)
    expect(refused.stderr).not.toContain('edited by an operator')
    expect((await ledger(tenant, organizationA)).filter((row) => row.action_id === FIXTURE_ACTION)).toHaveLength(1)
    expect(await fixtureConfigRows(tenant, organizationA)).toHaveLength(1)
  })

  test('refuses to revert an unapplied, forward-only or unregistered target', async () => {
    const tenant = tenantId as string
    const unapplied = runCli(['down', ...scope(tenant, organizationB), ...FIXTURE_TARGET])
    expect(unapplied.status).toBe(1)
    expect(unapplied.stderr).toContain('UPGRADE_ACTION_NOT_APPLIED')

    const forwardOnly = parseList(runCli(['list', ...scope(tenant, organizationB)]).stdout).find(
      (entry) => entry.detail === 'forward-only' && entry.scope === 'organization',
    )
    if (forwardOnly) {
      const result = runCli(['down', ...scope(tenant, organizationB), '--action', forwardOnly.id, '--version', forwardOnly.version])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('UPGRADE_ACTION_NOT_REVERSIBLE')
    }

    const wrongVersion = runCli(['down', ...scope(tenant, organizationB), '--action', FIXTURE_ACTION, '--version', '0.0.2'])
    expect(wrongVersion.status).toBe(1)
    expect(wrongVersion.stderr).toContain('UPGRADE_ACTION_NOT_AVAILABLE')
  })

  test('shows a completion recorded by the banner as applied and never reruns it', async () => {
    const tenant = tenantId as string
    await withClient((client) =>
      client.query(
        `insert into upgrade_action_runs (id, version, action_id, organization_id, tenant_id, completed_at, created_at)
         values (gen_random_uuid(), $1, $2, $3, $4, now(), now())`,
        [FIXTURE_VERSION, FIXTURE_ACTION, organizationB, tenant],
      ),
    )
    const listed = parseList(runCli(['list', ...scope(tenant, organizationB)]).stdout)
    expect(listed.find((entry) => entry.id === FIXTURE_ACTION)?.state).toBe('applied')

    const result = runCli(['up', ...scope(tenant, organizationB), ...FIXTURE_TARGET])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(' configs: no pending upgrade actions')
    expect(await fixtureConfigRows(tenant, organizationB)).toHaveLength(0)
  })

  test('rolls back a schedule written by a failing action together with its ledger row', async () => {
    const tenant = tenantId as string
    const organizationId = await createOrganizationInDb({ name: 'QA upgrade CLI rollback', tenantId: tenant })
    const action = 'configs.test-schedule-rollback-fixture'
    const result = runCli(['up', ...scope(tenant, organizationId), '--action', action, '--version', '0.0.1'], {
      OM_UPGRADE_ACTION_ROLLBACK_FIXTURE: '1',
    })
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain(`${action}@0.0.1 failed: handler failed`)
    const schedules = await withClient(async (client) =>
      (
        await client.query<{ id: string }>(
          `select id from scheduled_jobs where tenant_id = $1 and organization_id = $2 and source_module = 'configs'`,
          [tenant, organizationId],
        )
      ).rows,
    )
    expect(schedules).toEqual([])
    expect((await ledger(tenant, organizationId)).filter((row) => row.action_id === action)).toEqual([])
  })

  test('isolates competing applies of one action in one organization', async () => {
    const tenant = tenantId as string
    const organizationId = await createOrganizationInDb({ name: 'QA upgrade CLI race', tenantId: tenant })
    const results = await Promise.all([
      runCliAsync(['up', ...scope(tenant, organizationId), ...FIXTURE_TARGET]),
      runCliAsync(['up', ...scope(tenant, organizationId), ...FIXTURE_TARGET]),
    ])
    const transcript = results.map((result) => `${result.stdout}\n${result.stderr}`).join('\n----\n')
    for (const result of results) expect(result.status, transcript).toBe(0)
    expect(results.filter((result) => result.stdout.includes(' configs: 1 upgrade action applied')), transcript).toHaveLength(1)
    expect((await ledger(tenant, organizationId)).filter((row) => row.action_id === FIXTURE_ACTION)).toHaveLength(1)
    expect(await fixtureConfigRows(tenant, organizationId)).toHaveLength(1)
  })

  test('applies a default batch of organization actions, skips tenant-wide ones and is idempotent on retry', async () => {
    const tenant = tenantId as string
    const states = parseList(runCli(['list', ...scope(tenant, organizationB)]).stdout)
    const tenantWide = states.filter((entry) => entry.scope === 'tenant' && entry.state === 'pending')

    const batch = runCli(['up', ...scope(tenant, organizationB)])
    expect(batch.status, `${batch.stdout}\n${batch.stderr}`).toBe(0)
    for (const entry of tenantWide) {
      expect(batch.stdout).toContain(`skipped tenant-wide ${entry.id}@${entry.version}`)
    }
    const rows = await ledger(tenant, organizationB)
    expect(rows.filter((row) => tenantWide.some((entry) => entry.id === row.action_id))).toEqual([])

    const retry = runCli(['up', ...scope(tenant, organizationB)])
    expect(retry.status, retry.stderr).toBe(0)
    expect(retry.stdout).not.toMatch(/upgrade actions? applied/)
    expect(await ledger(tenant, organizationB)).toEqual(rows)
  })

  test('runs a tenant-wide action only with the opt-in and serializes it across organizations', async () => {
    const tenant = tenantId as string
    const states = parseList(runCli(['list', ...scope(tenant, organizationA)]).stdout)
    const tenantWide = states.find((entry) => entry.scope === 'tenant' && entry.id.includes('schedule'))
    test.skip(!tenantWide, 'No tenant-wide schedule action is enabled in this app')
    const target = ['--action', tenantWide!.id, '--version', tenantWide!.version]

    const refused = runCli(['up', ...scope(tenant, organizationA), ...target])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('pass --allow-tenant-wide')

    const otherTenantsBefore = await withClient(async (client) =>
      (await client.query<{ count: string }>('select count(*) from scheduled_jobs where tenant_id <> $1', [tenant])).rows[0].count,
    )
    const results = await Promise.all([
      runCliAsync(['up', ...scope(tenant, organizationA), ...target, '--allow-tenant-wide']),
      runCliAsync(['up', ...scope(tenant, organizationB), ...target, '--allow-tenant-wide']),
    ])
    for (const result of results) expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)

    for (const organizationId of [organizationA, organizationB]) {
      expect((await ledger(tenant, organizationId)).filter((row) => row.action_id === tenantWide!.id)).toHaveLength(1)
    }
    const fixtureSchedules = await withClient(async (client) =>
      (await client.query<{ id: string }>('select id from scheduled_jobs where tenant_id = $1 and source_module = $2', [tenant, tenantWide!.module])).rows,
    )
    expect(fixtureSchedules.length).toBeGreaterThan(0)
    expect(new Set(fixtureSchedules.map((row) => row.id)).size).toBe(fixtureSchedules.length)
    const otherTenantsAfter = await withClient(async (client) =>
      (await client.query<{ count: string }>('select count(*) from scheduled_jobs where tenant_id <> $1', [tenant])).rows[0].count,
    )
    expect(otherTenantsAfter).toBe(otherTenantsBefore)
  })
})
