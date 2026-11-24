import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import { resolveIntegrationDatabaseUrl, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { DEFAULT_RECORD_LOCK_SETTINGS, type RecordLockSettings } from '../lib/config'

export const integrationMeta = {
  dependsOnModules: ['auth', 'configs', 'directory', 'record_locks'],
  requiredEnvVars: ['OM_RECORD_LOCK_SETTINGS_ISOLATED_TEST'],
}

const settingsPath = '/api/record_locks/settings'
const globalSettings = `module_id = 'record_locks' and name = 'settings' and tenant_id is null and organization_id is null`

type StoredSettings = { id: string; value: string | null; updatedAt: string }
type ProvisionedTenant = { tenantId: string; organizationId: string; adminUserId: string }

function runMercato(args: string[]): string {
  return execFileSync('yarn', ['mercato', ...args], {
    cwd: resolveAppRoot(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: resolveIntegrationDatabaseUrl(), FORCE_COLOR: '0' },
    timeout: 90_000,
  })
}

function clearSettingsCache(): void {
  runMercato(['configs', 'cache', 'purge', '--global', '--tag', 'module-config:module:record_locks', '--quiet'])
}

test('TC-LOCK-10476 repairs the global legacy resource list during CLI setup', async ({ request }) => {
  test.skip(
    process.env.OM_RECORD_LOCK_SETTINGS_ISOLATED_TEST !== '1',
    'Run alone against a disposable integration app because this fixture writes the global Record Locks row',
  )
  test.setTimeout(240_000)

  const fixtureName = `record-lock-qa-${randomUUID()}`
  const email = `${fixtureName}@example.com`
  const password = `Setup!4-${randomUUID()}`
  const cleanupToken = await getAuthToken(request, 'superadmin')
  const original = await withClient(async (client) => {
    const result = await client.query<StoredSettings>(
      `select id, value_json::text as value, updated_at::text as "updatedAt" from module_configs where ${globalSettings}`,
    )
    return result.rows[0] ?? null
  })
  let provisioned: ProvisionedTenant | null = null

  try {
    await withClient((client) => client.query(
      `insert into module_configs (module_id, name, value_json, tenant_id, organization_id, created_at, updated_at)
       values ('record_locks', 'settings', $1::jsonb, null, null, now(), now())
       on conflict (module_id, name) where tenant_id is null
       do update set value_json = excluded.value_json, updated_at = excluded.updated_at
       where module_configs.organization_id is null`,
      [JSON.stringify({ enabledResources: ['', '   '], timeoutSeconds: 450 })],
    ))
    clearSettingsCache()

    const output = runMercato([
      'auth', 'setup',
      '--orgName', fixtureName,
      '--orgSlug', fixtureName,
      '--email', email,
      '--password', password,
      '--json',
    ])
    const result = output.split('\n').find((line) => line.trimStart().startsWith('{"tenantId":'))
    if (!result) throw new Error('[internal] Fixture tenant setup did not report its result.')
    provisioned = JSON.parse(result) as ProvisionedTenant
    expect(provisioned.tenantId).toBeTruthy()

    const token = await getAuthToken(request, email, password)
    const get = await apiRequest(request, 'GET', settingsPath, { token })
    expect(get.status()).toBe(200)
    expect(await readJsonSafe<{ settings: RecordLockSettings }>(get)).toEqual({
      settings: { ...DEFAULT_RECORD_LOCK_SETTINGS, timeoutSeconds: 450 },
    })

    const customized = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['dictionaries.*'], timeoutSeconds: 600 }
    const post = await apiRequest(request, 'POST', settingsPath, { token, data: customized })
    expect(post.status()).toBe(200)
    expect(await readJsonSafe<{ settings: RecordLockSettings }>(post)).toEqual({ settings: customized })
  } finally {
    try {
      await withClient(async (client) => {
        if (original) {
          await client.query(
            `update module_configs set value_json = $1::jsonb, updated_at = $2::timestamptz
             where id = $3 and ${globalSettings}`,
            [original.value, original.updatedAt, original.id],
          )
        } else {
          await client.query(`delete from module_configs where ${globalSettings}`)
        }
      })
      clearSettingsCache()
    } finally {
      const fixtures = provisioned ?? await withClient(async (client) => {
        const result = await client.query<ProvisionedTenant>(
          `select organizations.tenant_id as "tenantId", organizations.id as "organizationId", users.id as "adminUserId"
           from organizations left join users on users.organization_id = organizations.id
           where organizations.slug = $1`,
          [fixtureName],
        )
        return result.rows[0] ?? null
      })
      await deleteGeneralEntityIfExists(request, cleanupToken, '/api/auth/users', fixtures?.adminUserId ?? null)
      await deleteGeneralEntityIfExists(request, cleanupToken, '/api/directory/organizations', fixtures?.organizationId ?? null)
      await deleteGeneralEntityIfExists(request, cleanupToken, '/api/directory/tenants', fixtures?.tenantId ?? null)
    }
  }
})
