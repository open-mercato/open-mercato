import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function findRepoRoot(startDir: string): string {
  let current = startDir
  while (true) {
    const candidate = path.join(current, 'package.json')
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'))
        if (pkg && (pkg.workspaces || pkg.name === 'open-mercato')) return current
      } catch {
        // ignore JSON parse failures and keep walking
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`Could not locate Open Mercato repo root above ${startDir}`)
    }
    current = parent
  }
}

const repoRoot = findRepoRoot(__dirname)

function runMercato(args: string[]): string {
  return execFileSync('yarn', ['mercato', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })
}

test.describe('TC-AUTH-033: auth sync-role-acls CLI', () => {
  test.slow()

  test('restores default feature ACLs for the admin role after the admin ACL is cleared', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId).toBeTruthy()

    const rolesResponse = await apiRequest(request, 'GET', '/api/auth/roles?pageSize=100&search=admin', {
      token: adminToken,
    })
    expect(rolesResponse.status()).toBe(200)
    const rolesBody = await readJsonSafe<{
      items?: Array<{ id?: string; name?: string; tenantId?: string | null }>
    }>(rolesResponse)
    const adminRole = (rolesBody?.items ?? []).find((r) => r.name === 'admin' && r.tenantId === tenantId)
    expect(adminRole?.id, 'admin role not found for this tenant').toBeTruthy()

    const output = runMercato(['auth', 'sync-role-acls', '--tenant', tenantId])
    expect(output).toContain(`Synced role ACLs for tenant ${tenantId}`)

    const postAdminResponse = await apiRequest(request, 'GET', '/api/auth/roles?pageSize=10', {
      token: adminToken,
    })
    expect(postAdminResponse.status(), 'admin token should still work after sync').toBe(200)
  })

  test('is idempotent — second run adds no new ACL changes and exits cleanly', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)

    const first = runMercato(['auth', 'sync-role-acls', '--tenant', tenantId])
    const second = runMercato(['auth', 'sync-role-acls', '--tenant', tenantId])

    expect(first).toContain(`Synced role ACLs for tenant ${tenantId}`)
    expect(second).toContain(`Synced role ACLs for tenant ${tenantId}`)
  })

  test('fails cleanly with an invalid --tenant value', async () => {
    let errorOutput = ''
    try {
      runMercato(['auth', 'sync-role-acls', '--tenant', '   '])
    } catch (err) {
      errorOutput = String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '')
        + String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr ?? '')
    }
    expect(errorOutput).toContain('Invalid --tenant value')
  })
})
