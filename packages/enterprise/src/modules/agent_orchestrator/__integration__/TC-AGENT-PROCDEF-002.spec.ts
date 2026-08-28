import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-PROCDEF-002 — the `agent_orchestrator.processes.*` ACL ladder.
 *
 * Source: `.ai/specs/enterprise/agent-orchestrator/2026-08-11-triggered-process-model.md`
 * §Integration coverage, ACL row: "`processes.view` sees the list;
 * `processes.manage` required to edit; `processes.run` to start."
 *
 * These three ids replaced `agent_orchestrator.tasks.{view,manage,run}` in W1,
 * and `tasks.view` MERGED into the pre-existing `processes.view` rather than
 * adding a fourth feature — so `processes.view` now carries the projection list
 * AND the definitions list, and inherits `dependsOn: proposals.view`.
 *
 * Self-contained: role, user and definition are all created here and removed in
 * `finally`; nothing depends on seeded or demo data.
 */

const DEFINITIONS = '/api/agent_orchestrator/process-definitions'

test.describe('TC-AGENT-PROCDEF-002: processes.{view,manage,run} gate the definition surface', () => {
  test('view lists but cannot edit; manage edits; run starts', async ({ request }) => {
    test.slow()

    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(adminToken)
    const stamp = Date.now()
    // The default password policy requires a digit, an uppercase letter and a
    // special character — a fixture user with a weak one never gets created.
    const password = 'StrongSecret123!'
    const email = `tc-procdef-002-${stamp}@example.com`
    const name = `TC-PROCDEF-002 ${stamp}`

    let roleId: string | null = null
    let userId: string | null = null
    let definitionId: string | null = null

    // Hand-starting is opt-in: a definition with no `manual` trigger 403s on
    // /run regardless of ACL, which would make the processes.run leg below
    // indistinguishable from a permission failure. Declared on the create AND
    // the edit body so the manage leg does not strip it before the run leg.
    const triggers = [{ kind: 'manual' as const }]

    const editBody = {
      name: `${name} (edited)`,
      targetType: 'agent' as const,
      targetAgentId: 'deals.health_check',
      triggers,
      enabled: true,
    }

    try {
      const createResponse = await apiRequest(request, 'POST', DEFINITIONS, {
        token: adminToken,
        data: { name, targetType: 'agent', targetAgentId: 'deals.health_check', triggers, enabled: true },
      })
      expect(createResponse.status(), 'admin seeds the definition').toBe(201)
      definitionId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(definitionId).toBeTruthy()

      roleId = await createRoleFixture(request, adminToken, { name: `TC-PROCDEF-002 ${stamp}` })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      })

      // --- processes.view alone: the list is readable, nothing is writable.
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: null,
        features: ['agent_orchestrator.proposals.view', 'agent_orchestrator.processes.view'],
      })
      const viewerToken = await getAuthToken(request, email, password)

      const listResponse = await apiRequest(
        request,
        'GET',
        `${DEFINITIONS}?id=${encodeURIComponent(definitionId!)}`,
        { token: viewerToken },
      )
      expect(listResponse.status(), 'processes.view sees the definitions list').toBe(200)

      const forbiddenEdit = await apiRequest(request, 'PUT', DEFINITIONS, {
        token: viewerToken,
        data: { id: definitionId, ...editBody },
      })
      expect(forbiddenEdit.status(), 'editing needs processes.manage').toBe(403)

      const forbiddenRun = await apiRequest(
        request,
        'POST',
        `${DEFINITIONS}/${encodeURIComponent(definitionId!)}/run`,
        { token: viewerToken, data: {} },
      )
      expect(forbiddenRun.status(), 'starting a run needs processes.run').toBe(403)

      // --- + processes.manage: the edit is allowed, the run still is not.
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: null,
        features: [
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.processes.view',
          'agent_orchestrator.processes.manage',
        ],
      })
      const managerToken = await getAuthToken(request, email, password)

      const allowedEdit = await apiRequest(request, 'PUT', DEFINITIONS, {
        token: managerToken,
        data: { id: definitionId, ...editBody },
      })
      expect(allowedEdit.status(), 'processes.manage may edit').toBe(200)

      const stillForbiddenRun = await apiRequest(
        request,
        'POST',
        `${DEFINITIONS}/${encodeURIComponent(definitionId!)}/run`,
        { token: managerToken, data: {} },
      )
      expect(stillForbiddenRun.status(), 'manage does not imply run').toBe(403)

      // --- + processes.run: the run is accepted (202, always async).
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: null,
        features: [
          'agent_orchestrator.proposals.view',
          'agent_orchestrator.processes.view',
          'agent_orchestrator.processes.manage',
          'agent_orchestrator.processes.run',
        ],
      })
      const runnerToken = await getAuthToken(request, email, password)

      const acceptedRun = await apiRequest(
        request,
        'POST',
        `${DEFINITIONS}/${encodeURIComponent(definitionId!)}/run`,
        { token: runnerToken, data: {} },
      )
      expect(acceptedRun.status(), 'processes.run may start a run').toBe(202)
      const accepted = await readJsonSafe<{ processRunId?: string; status?: string }>(acceptedRun)
      expect(accepted?.processRunId, 'the 202 body carries processRunId').toBeTruthy()
      expect(accepted?.status).toBe('running')

      const runsResponse = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/process-runs?processDefinitionId=${encodeURIComponent(definitionId!)}`,
        { token: runnerToken },
      )
      expect(runsResponse.status(), 'processes.view reads the run ledger').toBe(200)
      const runs = await readJsonSafe<{ items?: Array<{ id?: string }> }>(runsResponse)
      expect((runs?.items ?? []).length, 'the started run is listed').toBeGreaterThan(0)
    } finally {
      if (definitionId) {
        await apiRequest(
          request,
          'DELETE',
          `${DEFINITIONS}?id=${encodeURIComponent(definitionId)}`,
          { token: adminToken },
        ).catch(() => undefined)
      }
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
