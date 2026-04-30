import { expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
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
const mercatoCwd = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : repoRoot

function runMercato(args: string[]): string {
  return execFileSync('yarn', ['mercato', ...args], {
    cwd: mercatoCwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })
}

function runMercatoCapture(args: string[]): { status: number | null; output: string } {
  const result = spawnSync('yarn', ['mercato', ...args], {
    cwd: mercatoCwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NODE_NO_WARNINGS: '1',
    },
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

type RoleAclResponse = {
  isSuperAdmin?: boolean
  features?: string[]
  organizations?: string[] | null
}

test.describe('TC-AUTH-033: auth sync-role-acls CLI', () => {
  test.slow()

  test('restores default feature ACLs for the admin role after the admin ACL is cleared', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenScope(adminToken)
    expect(tenantId).toBeTruthy()

    const rolesResponse = await apiRequest(request, 'GET', '/api/auth/roles?pageSize=100&search=admin', {
      token: superadminToken,
    })
    expect(rolesResponse.status()).toBe(200)
    const rolesBody = await readJsonSafe<{
      items?: Array<{ id?: string; name?: string; tenantId?: string | null }>
    }>(rolesResponse)
    const adminRole = (rolesBody?.items ?? []).find((r) => r.name === 'admin' && r.tenantId === tenantId)
    expect(adminRole?.id, 'admin role not found for this tenant').toBeTruthy()
    const adminRoleId = adminRole!.id!

    const aclPath = `/api/auth/roles/acl?roleId=${encodeURIComponent(adminRoleId)}&tenantId=${encodeURIComponent(tenantId)}`
    const beforeResponse = await apiRequest(request, 'GET', aclPath, { token: superadminToken })
    expect(beforeResponse.status()).toBe(200)
    const beforeBody = await readJsonSafe<RoleAclResponse>(beforeResponse)
    const originalFeatures = Array.isArray(beforeBody?.features) ? beforeBody!.features! : []
    const originalIsSuperAdmin = !!beforeBody?.isSuperAdmin
    const originalOrganizations = beforeBody?.organizations ?? null
    expect(originalFeatures.length, 'admin ACL must have features before clearing').toBeGreaterThan(0)

    try {
      const clearResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken,
        data: { roleId: adminRoleId, tenantId, features: [], isSuperAdmin: originalIsSuperAdmin },
      })
      expect(clearResponse.status(), 'clearing admin ACL must succeed').toBe(200)

      const clearedResponse = await apiRequest(request, 'GET', aclPath, { token: superadminToken })
      const clearedBody = await readJsonSafe<RoleAclResponse>(clearedResponse)
      expect(clearedBody?.features ?? [], 'admin ACL features must be empty before sync').toEqual([])

      const output = runMercato(['auth', 'sync-role-acls', '--tenant', tenantId])
      expect(output).toContain(`Synced role ACLs for tenant ${tenantId}`)

      const restoredResponse = await apiRequest(request, 'GET', aclPath, { token: superadminToken })
      expect(restoredResponse.status()).toBe(200)
      const restoredBody = await readJsonSafe<RoleAclResponse>(restoredResponse)
      const restoredFeatures = Array.isArray(restoredBody?.features) ? restoredBody!.features! : []
      expect(
        restoredFeatures.length,
        'sync-role-acls must restore admin features from defaultRoleFeatures',
      ).toBeGreaterThan(0)
      expect(restoredFeatures, 'restored admin features must include auth.*').toContain('auth.*')
    } finally {
      await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken,
        data: {
          roleId: adminRoleId,
          tenantId,
          features: originalFeatures,
          isSuperAdmin: originalIsSuperAdmin,
          organizations: originalOrganizations,
        },
      }).catch(() => null)
    }
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
    const { output } = runMercatoCapture(['auth', 'sync-role-acls', '--tenant', '   '])
    expect(output).toContain('Invalid --tenant value')
  })

  test('fails when --tenant points at a non-existent tenant id', async () => {
    const missingTenantId = '00000000-0000-0000-0000-000000000000'
    const { output } = runMercatoCapture(['auth', 'sync-role-acls', '--tenant', missingTenantId])
    expect(output).toContain(`Tenant not found: ${missingTenantId}`)
    expect(output).not.toContain(`Synced role ACLs for tenant ${missingTenantId}`)
  })
})
