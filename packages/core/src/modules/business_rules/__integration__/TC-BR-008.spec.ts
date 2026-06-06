import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  buildBusinessRulePayload,
  type ExecutionRuleEntry,
  listRuleLogs,
} from './helpers/businessRulesApi'

test.describe('TC-BR-008: Dry-run execution mode', () => {
  test('evaluates a matching rule without persisting execution logs until dryRun is false', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const entityId = crypto.randomUUID()
    const entityType = `QaDryRunEntity${stamp}`
    const ruleKey = `TC_BR_008_${stamp}`
    let ruleId: string | null = null

    try {
      ruleId = await createBusinessRuleFixture(
        request,
        token,
        buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleType: 'ACTION',
          entityType,
          successActions: [
            {
              type: 'SET_FIELD',
              config: { field: 'approvalStatus', value: 'APPROVED' },
            },
          ],
        }),
      )

      const dryRunResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId,
          data: { status: 'ACTIVE', approvalStatus: 'PENDING' },
          dryRun: true,
        },
      })
      expect(dryRunResponse.status(), 'dry-run execution should succeed').toBe(200)
      const dryRunBody = await readJsonSafe<{
        allowed?: boolean
        executedRules?: ExecutionRuleEntry[]
        logIds?: string[]
      }>(dryRunResponse)
      expect(dryRunBody?.allowed).toBe(true)
      const dryRunEntry = dryRunBody?.executedRules?.find((entry) => entry.ruleId === ruleKey)
      expect(dryRunEntry?.conditionResult).toBe(true)
      expect(dryRunEntry?.actionsExecuted?.success).toBe(true)
      expect(dryRunEntry?.logId, 'dry-run rule entry should not include a persisted log id').toBeUndefined()
      expect(dryRunBody?.logIds, 'dry-run response should not include persisted log ids').toBeUndefined()

      const logsAfterDryRun = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&entityId=${encodeURIComponent(entityId)}`,
      )
      expect(logsAfterDryRun.status, 'logs query after dry-run should succeed').toBe(200)
      expect(logsAfterDryRun.items, 'dry-run must not persist execution logs').toHaveLength(0)

      const liveResponse = await apiRequest(request, 'POST', '/api/business_rules/execute', {
        token,
        data: {
          entityType,
          eventType: 'beforeSave',
          entityId,
          data: { status: 'ACTIVE', approvalStatus: 'PENDING' },
          dryRun: false,
        },
      })
      expect(liveResponse.status(), 'non-dry-run execution should succeed').toBe(200)
      const liveBody = await readJsonSafe<{ executedRules?: ExecutionRuleEntry[]; logIds?: string[] }>(liveResponse)
      const liveEntry = liveBody?.executedRules?.find((entry) => entry.ruleId === ruleKey)
      expect(liveEntry?.logId, 'non-dry-run entry should include a persisted log id').toBeTruthy()
      expect(liveBody?.logIds?.length, 'non-dry-run response should include persisted log ids').toBeGreaterThan(0)

      const logsAfterLiveRun = await listRuleLogs(
        request,
        token,
        `?ruleId=${encodeURIComponent(ruleId)}&entityId=${encodeURIComponent(entityId)}`,
      )
      expect(logsAfterLiveRun.items.some((item) => item.executionResult === 'SUCCESS')).toBe(true)
    } finally {
      await deleteBusinessRuleIfExists(request, token, ruleId)
    }
  })
})
