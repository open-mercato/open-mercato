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
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  buildMinimalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-029 (issue #2462 scenario TC-WF-020) [P0]: Organization scoping / cross-org isolation
 *
 * Surfaces under test:
 * - GET  /api/workflows/definitions, /api/workflows/definitions/[id]
 * - GET  /api/workflows/instances, /api/workflows/instances/[id]
 * - POST /api/workflows/instances
 *
 * Two organization-restricted users in the same tenant prove the workflows routes honor the
 * organization scope filter (unlike the directory list): a user in org B cannot list, read, or
 * start workflows that belong to org A. Negative list assertions use `?workflowId=` so they
 * stay deterministic regardless of pagination. Positive controls prove the records exist.
 */
type DefinitionListBody = { data?: Array<{ id?: string; workflowId?: string }> }
type InstanceListBody = { data?: Array<{ id?: string }> }

test.describe('TC-WF-029: workflow organization scoping (#2462)', () => {
  test('isolates workflow definitions and instances across organizations', async ({ request }) => {
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

    let orgAId: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null
    let tokenA = ''

    try {
      orgAId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-wf-029-a-${stamp}`, ...tenantOpt })
      orgBId = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-wf-029-b-${stamp}`, ...tenantOpt })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-wf-029-${stamp}`, ...tenantOpt })
      await setRoleAclFeatures(request, superadminToken, { roleId, features: ['workflows.*'], organizations: null })

      userAId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-wf-029-a-${stamp}@example.com`,
        password,
        organizationId: orgAId,
        roles: [roleId],
        name: 'QA TC-WF-029 A',
      })
      userBId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-wf-029-b-${stamp}@example.com`,
        password,
        organizationId: orgBId,
        roles: [roleId],
        name: 'QA TC-WF-029 B',
      })
      // Restrict each user's visibility to their own organization (sets the scope filter).
      await setUserAclVisibility(request, superadminToken, { userId: userAId, organizations: [orgAId] })
      await setUserAclVisibility(request, superadminToken, { userId: userBId, organizations: [orgBId] })

      tokenA = await getAuthToken(request, `qa-tc-wf-029-a-${stamp}@example.com`, password)
      const tokenB = await getAuthToken(request, `qa-tc-wf-029-b-${stamp}@example.com`, password)

      // User A creates a definition + instance in org A.
      const definitionPayload = buildMinimalDefinitionPayload(Date.now(), '-scope')
      definitionId = await createWorkflowDefinitionFixture(request, tokenA, definitionPayload)
      instanceId = await startWorkflowInstanceFixture(request, tokenA, { workflowId: definitionPayload.workflowId })

      // Positive control: user A can list and read its own org's records.
      const ownDefList = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(definitionPayload.workflowId)}`,
        { token: tokenA },
      )
      const ownDefBody = await readJsonSafe<DefinitionListBody>(ownDefList)
      expect((ownDefBody?.data ?? []).map((d) => d.id), 'owner lists its own definition').toContain(definitionId)
      const ownDefDetail = await apiRequest(request, 'GET', `/api/workflows/definitions/${encodeURIComponent(definitionId)}`, { token: tokenA })
      expect(ownDefDetail.status(), 'owner reads its own definition').toBe(200)
      const ownInstanceDetail = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token: tokenA })
      expect(ownInstanceDetail.status(), 'owner reads its own instance').toBe(200)

      // Cross-org user B cannot see org A's definition in its list...
      const crossDefList = await apiRequest(
        request,
        'GET',
        `/api/workflows/definitions?workflowId=${encodeURIComponent(definitionPayload.workflowId)}`,
        { token: tokenB },
      )
      const crossDefBody = await readJsonSafe<DefinitionListBody>(crossDefList)
      expect((crossDefBody?.data ?? []).map((d) => d.id), 'cross-org user does not list org A definition').not.toContain(definitionId)

      // ...nor read it by id (404, not 403 — the row is simply out of scope).
      const crossDefDetail = await apiRequest(request, 'GET', `/api/workflows/definitions/${encodeURIComponent(definitionId)}`, { token: tokenB })
      expect(crossDefDetail.status(), 'cross-org definition detail returns 404').toBe(404)

      // Cross-org user B cannot see or read org A's instance.
      const crossInstanceList = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?workflowId=${encodeURIComponent(definitionPayload.workflowId)}`,
        { token: tokenB },
      )
      const crossInstanceBody = await readJsonSafe<InstanceListBody>(crossInstanceList)
      expect((crossInstanceBody?.data ?? []).map((i) => i.id), 'cross-org user does not list org A instance').not.toContain(instanceId)
      const crossInstanceDetail = await apiRequest(request, 'GET', `/api/workflows/instances/${encodeURIComponent(instanceId)}`, { token: tokenB })
      expect(crossInstanceDetail.status(), 'cross-org instance detail returns 404').toBe(404)

      // Cross-org user B cannot start an instance from org A's definition (not found in its scope).
      const crossStart = await apiRequest(request, 'POST', '/api/workflows/instances', {
        token: tokenB,
        data: { workflowId: definitionPayload.workflowId },
      })
      expect(crossStart.status(), 'starting another org definition returns 404').toBe(404)
    } finally {
      await cancelWorkflowInstanceIfExists(request, tokenA || superadminToken, instanceId)
      await deleteWorkflowDefinitionIfExists(request, tokenA || superadminToken, definitionId)
      await deleteUserIfExists(request, superadminToken, userAId)
      await deleteUserIfExists(request, superadminToken, userBId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgAId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
