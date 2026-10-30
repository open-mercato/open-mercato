import { expect, test } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { GATED_AGENT_ID, GATED_AGENT_INPUT, agentApiRunPath } from './helpers/agentAccessFixtures'

/**
 * TC-AGENT-ACC-003: the agent-token door never runs an agent for an unauthenticated caller.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-invocation-access-and-identity-binding.md
 * (§E, Integration: agent-token door).
 *
 * `POST /api/agent_orchestrator/agent-api/agents/:id/run` is invisible (404) unless
 * `OM_AGENT_API_ENABLED` is on in the APP process, which the Playwright runner
 * cannot read. The spec therefore probes the route: a 404 must be the disabled
 * body; anything else means the door is enabled, and then a missing or forged
 * Bearer token must get the one minimal 401 and never a run.
 *
 * Minting a valid agent token needs a provisioned agent principal plus a
 * delegation grant; the valid-token / revoked-grant / scope-denied paths are
 * covered by the route unit tests (`api/agent-api/agents/[id]/run`).
 *
 * No records are created, so there is nothing to clean up.
 */

const FORGED_TOKEN = 'it-agent-acc-003.not-a-real.agent-token'

type DoorBody = { error?: string; code?: string }

test.describe('TC-AGENT-ACC-003: agent-token door', () => {
  test('is hidden when disabled and answers 401 to a bad or missing token when enabled', async ({ request }) => {
    const forged = await request.fetch(agentApiRunPath(GATED_AGENT_ID), {
      method: 'POST',
      headers: { Authorization: `Bearer ${FORGED_TOKEN}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ input: GATED_AGENT_INPUT }),
    })
    const forgedBody = await readJsonSafe<DoorBody>(forged)

    if (forged.status() === 404) {
      expect(forgedBody?.error).toBe('Not found')
      expect(forgedBody?.code, 'a disabled door is not an unknown agent').toBeUndefined()
      return
    }

    expect(forged.status(), JSON.stringify(forgedBody)).toBe(401)
    expect(forgedBody).toEqual({ error: 'unauthorized' })

    const missing = await request.fetch(agentApiRunPath(GATED_AGENT_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ input: GATED_AGENT_INPUT }),
    })
    expect(missing.status()).toBe(401)
    expect(await readJsonSafe<DoorBody>(missing)).toEqual({ error: 'unauthorized' })
  })
})
