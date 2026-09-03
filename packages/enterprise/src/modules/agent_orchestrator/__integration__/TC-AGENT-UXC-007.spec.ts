import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AGENT-UXC-007: schedule timezones must be real IANA identifiers.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-consistency-pass.md
 * (Area 7: `Intl`-backed timezone validation server-side; combobox over
 * `Intl.supportedValuesOf('timeZone')` in the form).
 *
 * `"Warsaw"` (a city, not a zone id) → 400 with a timezone issue;
 * `"Europe/Warsaw"` → created. Carried onto the declared-trigger list by
 * Phase 2 of the triggered process model spec (2026-08-11).
 */

test.describe('TC-AGENT-UXC-007: IANA timezone validation', () => {
  test('city names are rejected, zone ids are accepted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let taskId: string | null = null

    try {
      const invalid = await apiRequest(request, 'POST', '/api/agent_orchestrator/process-definitions', {
        token,
        data: {
          name: `TC-UXC-007 invalid ${stamp}`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          triggers: [{ kind: 'schedule', cron: '0 7 * * 1', timezone: 'Warsaw' }],
        },
      })
      expect(invalid.status(), '"Warsaw" is not an IANA timezone and must be rejected').toBe(400)
      const invalidBody = await readJsonSafe<Record<string, unknown>>(invalid)
      expect(JSON.stringify(invalidBody)).toContain('timezone')

      const valid = await apiRequest(request, 'POST', '/api/agent_orchestrator/process-definitions', {
        token,
        data: {
          name: `TC-UXC-007 valid ${stamp}`,
          targetType: 'agent',
          targetAgentId: 'deals.health_check',
          triggers: [{ kind: 'schedule', cron: '0 7 * * 1', timezone: 'Europe/Warsaw' }],
        },
      })
      expect(valid.ok(), '"Europe/Warsaw" must pass').toBeTruthy()
      taskId = (await readJsonSafe<{ id?: string }>(valid))?.id ?? null
      expect(taskId).toBeTruthy()
    } finally {
      if (taskId) {
        await apiRequest(request, 'DELETE', `/api/agent_orchestrator/process-definitions?id=${encodeURIComponent(taskId)}`, {
          token,
        }).catch(() => {})
      }
    }
  })
})
