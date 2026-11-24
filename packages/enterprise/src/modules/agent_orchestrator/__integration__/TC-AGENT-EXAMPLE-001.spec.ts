import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import {
  deleteEntityByPathIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  description: 'CLI example setup and authorized access to editable Agent Orchestrator workflows',
  dependsOnModules: ['agent_orchestrator', 'workflows'],
}

const runFile = promisify(execFile)
const DEFINITIONS = '/api/workflows/definitions'
const EXAMPLES = [
  { workflowId: 'agent_orchestrator_deals_health_check_v1', expectedIcon: 'activity' },
  { workflowId: 'agent_orchestrator_refund_triage_v1', expectedIcon: 'badge-dollar-sign' },
]

type SetupResult = { tenantId: string; organizationId: string; reusedExistingUser: boolean }
type WorkflowExample = {
  id: string
  workflowName: string
  updatedAt: string
  enabled: boolean
}

async function setupTenant(
  orgName: string, email: string, password: string, withExamples = false,
): Promise<SetupResult> {
  const { stdout } = await runFile('yarn', [
    'mercato', 'auth', 'setup', '--orgName', orgName, '--email', email, '--password', password, '--json',
    ...(withExamples ? ['--with-examples'] : []),
  ], {
    cwd: process.env.OM_TEST_APP_ROOT?.trim() || process.cwd(),
    env: { ...process.env, OM_APP_ROOT: resolveAppRoot(), FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  }).catch((error: unknown) => {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    throw new Error(`[internal] Fixture tenant setup exited with code ${code}.`)
  })
  return JSON.parse(stdout) as SetupResult
}

async function listExamples(request: APIRequestContext, token: string, workflowId: string): Promise<WorkflowExample[]> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS}?workflowId=${encodeURIComponent(workflowId)}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ data: WorkflowExample[] }>(response))?.data ?? []
}

test('TC-AGENT-EXAMPLE-001: seeds both example workflows on demand and preserves edits across setup', async ({ request }) => {
  test.setTimeout(240_000)
  const suffix = randomUUID()
  const orgName = `Workflow Examples ${suffix}`
  const email = `workflow-examples-${suffix}@example.com`
  const password = `Integration-${randomUUID()}!`
  const superadminToken = await getAuthToken(request, 'superadmin')
  let tenantId: string | null = null
  let tenantToken: string | null = null
  const created = new Set<string>()

  try {
    const initial = await setupTenant(orgName, email, password)
    tenantId = initial.tenantId
    expect(initial.reusedExistingUser).toBe(false)
    tenantToken = await getAuthToken(request, email, password)
    expect(getTokenScope(tenantToken).tenantId).toBe(initial.tenantId)
    for (const example of EXAMPLES) {
      expect(await listExamples(request, tenantToken, example.workflowId)).toHaveLength(0)
    }

    const seeded = await setupTenant(orgName, email, password, true)
    expect(seeded).toMatchObject({
      tenantId: initial.tenantId,
      organizationId: initial.organizationId,
      reusedExistingUser: true,
    })
    const rows: WorkflowExample[] = []
    for (const example of EXAMPLES) {
      const listed = await listExamples(request, tenantToken, example.workflowId)
      expect(listed).toHaveLength(1)
      const [row] = listed
      created.add(row.id)
      rows.push(row)

      const response = await apiRequest(request, 'GET', `${DEFINITIONS}/${row.id}`, { token: tenantToken })
      expect(response.status()).toBe(200)
      const detail = await readJsonSafe<{ data: WorkflowExample & { metadata: unknown } }>(response)
      expect(detail?.data).toMatchObject({
        id: row.id,
        workflowId: example.workflowId,
        tenantId: initial.tenantId,
        organizationId: initial.organizationId,
        version: 1,
        enabled: true,
        source: 'user',
        createdBy: null,
        grantedFeatures: null,
        metadata: { category: 'Agents', icon: example.expectedIcon },
      })
      expect(detail?.data.metadata).not.toHaveProperty('generatedBy')
    }

    const editedName = 'Deal Health Check edited during setup coverage'
    const edit = await apiRequest(request, 'PUT', `${DEFINITIONS}/${rows[0].id}`, {
      token: tenantToken,
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': rows[0].updatedAt },
      data: { workflowName: editedName, enabled: false },
    })
    expect(edit.status()).toBe(200)

    const repeated = await setupTenant(orgName, email, password, true)
    expect(repeated.tenantId).toBe(initial.tenantId)
    expect(await listExamples(request, tenantToken, EXAMPLES[0].workflowId)).toMatchObject([
      { id: rows[0].id, workflowName: editedName, enabled: false },
    ])
    expect(await listExamples(request, tenantToken, EXAMPLES[1].workflowId)).toMatchObject([
      { id: rows[1].id, workflowName: rows[1].workflowName, enabled: true },
    ])
  } finally {
    for (const id of created) {
      await deleteEntityByPathIfExists(request, tenantToken, `${DEFINITIONS}/${id}`)
    }
    if (tenantId) {
      const response = await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token: superadminToken })
      expect(response.ok()).toBe(true)
    }
  }
})
