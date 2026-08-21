import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-028 (issue #2462 scenario TC-WF-019) [P0]: Permission gate enforcement (RBAC)
 *
 * Surfaces under test (mutation gates):
 * - POST /api/workflows/definitions, /api/workflows/instances
 * - POST /api/workflows/tasks/[id]/claim, /complete
 * - POST /api/workflows/instances/[id]/signal
 *
 * The restricted role gets view-only workflows features, so it clears the declarative view
 * guards and we exercise the create-specific inner checks (definitions/instances) as well as
 * the declarative mutation guards (claim/complete/signal). A wildcard-granted admin is the
 * positive control. Fabricated UUIDs are used because the gates run before any record lookup.
 */
const FABRICATED_ID = '00000000-0000-4000-8000-000000000000'

test.describe('TC-WF-028: workflow permission gate enforcement (#2462)', () => {
  test('denies mutations to a user without the required workflows features', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const password = 'StrongSecret123!'
    let tenantId = getTokenContext(superadminToken).tenantId
    if (!tenantId) {
      const existing = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', { token: superadminToken })
      const body = await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existing)
      tenantId = body?.items?.[0]?.tenantId ?? ''
    }
    const tenantOpt = tenantId ? { tenantId } : {}

    let orgId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let adminDefinitionId: string | null = null
    const adminToken = await getAuthToken(request, 'admin')

    try {
      orgId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-wf-028-${stamp}`, ...tenantOpt })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-wf-028-${stamp}`, ...tenantOpt })
      // View-only: clears declarative view guards but lacks every mutation feature.
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['workflows.view', 'workflows.definitions.view', 'workflows.instances.view', 'workflows.tasks.view'],
        organizations: null,
      })
      userId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-wf-028-${stamp}@example.com`,
        password,
        organizationId: orgId,
        roles: [roleId],
        name: 'QA TC-WF-028',
      })
      const userToken = await getAuthToken(request, `qa-tc-wf-028-${stamp}@example.com`, password)

      const definitionPayload = buildMinimalDefinitionPayload(Date.now(), '-rbac')

      const createDefinition = await apiRequest(request, 'POST', '/api/workflows/definitions', {
        token: userToken,
        data: definitionPayload,
      })
      expect(createDefinition.status(), 'create definition without workflows.definitions.create is forbidden').toBe(403)

      const startInstance = await apiRequest(request, 'POST', '/api/workflows/instances', {
        token: userToken,
        data: { workflowId: definitionPayload.workflowId },
      })
      expect(startInstance.status(), 'start instance without workflows.instances.create is forbidden').toBe(403)

      const claim = await apiRequest(request, 'POST', `/api/workflows/tasks/${FABRICATED_ID}/claim`, { token: userToken })
      expect(claim.status(), 'claim without workflows.tasks.claim is forbidden').toBe(403)

      const complete = await apiRequest(request, 'POST', `/api/workflows/tasks/${FABRICATED_ID}/complete`, {
        token: userToken,
        data: { formData: { approved: true } },
      })
      expect(complete.status(), 'complete without workflows.tasks.complete is forbidden').toBe(403)

      const signal = await apiRequest(request, 'POST', `/api/workflows/instances/${FABRICATED_ID}/signal`, {
        token: userToken,
        data: { signalName: 'approval' },
      })
      expect(signal.status(), 'signal without workflows.instances.signal is forbidden').toBe(403)

      // Unauthenticated requests are rejected before any feature check.
      const unauthenticated = await apiRequest(request, 'GET', '/api/workflows/definitions', {
        token: 'not-a-valid-session-token',
      })
      expect(unauthenticated.status(), 'an invalid token returns 401').toBe(401)

      // Positive control: an admin holding the workflows.* wildcard can create a definition.
      adminDefinitionId = await createWorkflowDefinitionFixture(request, adminToken, definitionPayload)
      expect(adminDefinitionId, 'wildcard-granted admin can create a definition').toBeTruthy()
    } finally {
      await deleteWorkflowDefinitionIfExists(request, adminToken, adminDefinitionId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgId)
    }
  })
})
