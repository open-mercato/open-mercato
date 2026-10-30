import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { AGENTS_LIST_PATH } from './helpers/agentAccessFixtures'
import {
  POLICY_CHECK_AGENT_ID,
  POLICY_CHECK_REQUIRED_FEATURE,
  POLICY_CHECK_TOOL_ID,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-003: the integrity example agent is registered with its access and tool contract.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Testing Strategy → Integration fixtures: a test agent in `agent_examples` with the rule kinds).
 *
 * No model needed. `support.policy_check` loads — `defineAgent` parses its
 * integrity rules against the result schema and throws on an invalid rule, so a
 * listed agent proves the declaration is well formed — and the registry reports its declared
 * `requiredFeatures`, its lookup tool, the research result kind and a sample input.
 */

type AgentListItem = {
  id?: string
  resultKind?: string
  tools?: string[]
  requiredFeatures?: string[]
  invocable?: boolean
  sampleInput?: { reply?: unknown; policySetVersion?: unknown }
}

test.describe('TC-AGENT-INT-003: integrity example agent registration', () => {
  test('lists support.policy_check with its required features and lookup tool', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', AGENTS_LIST_PATH, { token })
    expect(response.status(), await response.text()).toBe(200)
    const body = await readJsonSafe<{ items?: AgentListItem[] }>(response)
    const agent = (body?.items ?? []).find((item) => item.id === POLICY_CHECK_AGENT_ID)
    expect(agent, `${POLICY_CHECK_AGENT_ID} is registered`).toBeTruthy()
    expect(agent?.requiredFeatures).toEqual([POLICY_CHECK_REQUIRED_FEATURE])
    expect(agent?.tools).toContain(POLICY_CHECK_TOOL_ID)
    expect(agent?.resultKind).toBe('research')
    expect(agent?.invocable).toBe(true)
    expect(typeof agent?.sampleInput?.reply).toBe('string')
    expect(typeof agent?.sampleInput?.policySetVersion).toBe('string')
  })
})
