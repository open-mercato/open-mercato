import { test, expect, request as playwrightRequest } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteAgentOverridesInDb } from './helpers/aiAssistantFixtures';

/**
 * TC-AI-AGENT-OVERRIDES-005 — Per-agent runtime overrides (prompt / mutation-policy / loop).
 * Source: GitHub issue #2495.
 *
 * Surfaces under test:
 *   - /api/ai_assistant/ai/agents/{agentId}/prompt-override     (GET, POST)
 *   - /api/ai_assistant/ai/agents/{agentId}/mutation-policy      (GET, POST, DELETE)
 *   - /api/ai_assistant/ai/agents/{agentId}/loop-override         (GET, PUT, DELETE)
 *
 * Contract notes verified against the route handlers (the issue's guesses were wrong):
 *   - prompt-override + mutation-policy use POST (NOT PUT); loop-override uses PUT.
 *   - prompt-override has no DELETE route (versioned) -> swept via SQL in teardown.
 *   - mutation-policy escalation beyond the agent's declared ceiling -> 400
 *     `escalation_not_allowed` (NOT `policy_escalation_not_allowed`); an invalid
 *     policy value -> 400 `validation_error` (NOT `invalid_mutation_policy`).
 *   - a malformed agentId -> 400 `validation_error`; an unknown one -> 404 `agent_unknown`.
 *   - writes require `ai_assistant.settings.manage`.
 *
 * The agent id is discovered dynamically from GET /ai/agents — never hard-coded.
 */

const AGENTS = '/api/ai_assistant/ai/agents';

interface AgentSummary {
  id: string;
  mutationPolicy: string;
}

const POLICY_RANK: Record<string, number> = {
  'read-only': 0,
  'destructive-confirm-required': 1,
  'confirm-required': 2,
};

test.describe('TC-AI-AGENT-OVERRIDES-005: Per-agent runtime overrides', () => {
  test('prompt + mutation-policy + loop override CRUD, validation, escalation, RBAC', async ({
    request,
    baseURL,
  }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(adminToken);

    const agentsRes = await apiRequest(request, 'GET', AGENTS, { token: adminToken });
    expect(agentsRes.status()).toBe(200);
    const agentsBody = await readJsonSafe<{ agents: AgentSummary[] }>(agentsRes);
    expect(Array.isArray(agentsBody?.agents) && (agentsBody?.agents.length ?? 0) > 0, 'at least one agent is registered').toBe(
      true,
    );
    // Intentionally targets the first registered agent (whichever modules are
    // enabled). Policy assertions are computed relative to that agent's declared
    // ceiling (`codeDeclared`) so the test is correct for any agent.
    const agentId = agentsBody!.agents[0].id;

    const promptOverride = `${AGENTS}/${encodeURIComponent(agentId)}/prompt-override`;
    const mutationPolicy = `${AGENTS}/${encodeURIComponent(agentId)}/mutation-policy`;
    const loopOverride = `${AGENTS}/${encodeURIComponent(agentId)}/loop-override`;

    try {
      // --- prompt-override (GET + POST; reserved-key validation) ---
      const savePrompt = await apiRequest(request, 'POST', promptOverride, {
        token: adminToken,
        data: { sections: { tone: 'Be concise and helpful.' } },
      });
      expect(savePrompt.status(), 'POST prompt-override returns 200').toBe(200);
      const savedPrompt = await readJsonSafe<{ ok: boolean; version: number }>(savePrompt);
      expect(savedPrompt?.ok).toBe(true);
      expect(typeof savedPrompt?.version).toBe('number');

      const getPrompt = await apiRequest(request, 'GET', promptOverride, { token: adminToken });
      expect(getPrompt.status()).toBe(200);
      const promptBody = await readJsonSafe<{ override: { sections: Record<string, string> } | null }>(getPrompt);
      expect(promptBody?.override?.sections?.tone).toBe('Be concise and helpful.');

      const reserved = await apiRequest(request, 'POST', promptOverride, {
        token: adminToken,
        data: { sections: { mutationPolicy: 'confirm-required' } },
      });
      expect(reserved.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(reserved))?.code).toBe('reserved_key');

      // --- mutation-policy (GET + POST + DELETE; escalation + invalid value) ---
      const getPolicy = await apiRequest(request, 'GET', mutationPolicy, { token: adminToken });
      expect(getPolicy.status()).toBe(200);
      const policyBody = await readJsonSafe<{ codeDeclared: string }>(getPolicy);
      const codeDeclared = policyBody?.codeDeclared ?? 'read-only';

      // 'read-only' is the most restrictive policy, so saving it is never an escalation.
      const savePolicy = await apiRequest(request, 'POST', mutationPolicy, {
        token: adminToken,
        data: { mutationPolicy: 'read-only' },
      });
      expect(savePolicy.status(), 'saving a non-escalating policy returns 200').toBe(200);

      const getPolicyAfter = await apiRequest(request, 'GET', mutationPolicy, { token: adminToken });
      expect((await readJsonSafe<{ override: { mutationPolicy: string } | null }>(getPolicyAfter))?.override?.mutationPolicy).toBe(
        'read-only',
      );

      const invalidPolicy = await apiRequest(request, 'POST', mutationPolicy, {
        token: adminToken,
        data: { mutationPolicy: 'not-a-valid-policy' },
      });
      expect(invalidPolicy.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(invalidPolicy))?.code).toBe('validation_error');

      // Escalation (widening the agent's declared ceiling) is rejected. Only
      // assert when 'confirm-required' is strictly less restrictive than declared.
      if ((POLICY_RANK[codeDeclared] ?? 0) < POLICY_RANK['confirm-required']) {
        const escalation = await apiRequest(request, 'POST', mutationPolicy, {
          token: adminToken,
          data: { mutationPolicy: 'confirm-required' },
        });
        expect(escalation.status()).toBe(400);
        expect((await readJsonSafe<{ code?: string }>(escalation))?.code).toBe('escalation_not_allowed');
      }

      const deletePolicy = await apiRequest(request, 'DELETE', mutationPolicy, { token: adminToken });
      expect(deletePolicy.status()).toBe(200);
      const getPolicyCleared = await apiRequest(request, 'GET', mutationPolicy, { token: adminToken });
      expect((await readJsonSafe<{ override: unknown }>(getPolicyCleared))?.override, 'override cleared (null, not 404)').toBeNull();

      // --- loop-override (GET + PUT + DELETE) ---
      const putLoop = await apiRequest(request, 'PUT', loopOverride, {
        token: adminToken,
        data: { loopMaxSteps: 5 },
      });
      expect(putLoop.status(), 'PUT loop-override returns 200').toBe(200);

      const getLoop = await apiRequest(request, 'GET', loopOverride, { token: adminToken });
      expect(getLoop.status()).toBe(200);
      expect((await readJsonSafe<{ override: { loopMaxSteps: number } | null }>(getLoop))?.override?.loopMaxSteps).toBe(5);

      const deleteLoop = await apiRequest(request, 'DELETE', loopOverride, { token: adminToken });
      expect(deleteLoop.status()).toBe(200);
      const getLoopCleared = await apiRequest(request, 'GET', loopOverride, { token: adminToken });
      expect((await readJsonSafe<{ override: unknown }>(getLoopCleared))?.override).toBeNull();

      // --- agent-id validation ---
      const malformed = await apiRequest(request, 'GET', `${AGENTS}/BadAgentId/prompt-override`, { token: adminToken });
      expect(malformed.status()).toBe(400);
      expect((await readJsonSafe<{ code?: string }>(malformed))?.code).toBe('validation_error');

      const unknown = await apiRequest(request, 'GET', `${AGENTS}/does.not_exist/prompt-override`, { token: adminToken });
      expect(unknown.status()).toBe(404);
      expect((await readJsonSafe<{ code?: string }>(unknown))?.code).toBe('agent_unknown');

      // --- RBAC: employee lacks settings.manage; unauthenticated is rejected ---
      const employeeToken = await getAuthToken(request, 'employee');
      const denied = await apiRequest(request, 'POST', promptOverride, {
        token: employeeToken,
        data: { sections: { tone: 'nope' } },
      });
      expect(denied.status(), 'employee lacks settings.manage -> 403').toBe(403);

      const anon = await playwrightRequest.newContext({ baseURL });
      try {
        const res = await anon.fetch(promptOverride, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ sections: { tone: 'nope' } }),
        });
        expect(res.status(), 'unauthenticated POST is 401').toBe(401);
      } finally {
        await anon.dispose();
      }
    } finally {
      await deleteAgentOverridesInDb({ tenantId, agentId }).catch(() => undefined);
    }
  });
});
