import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEAL_RESOURCE_KIND,
  DEAL_UPDATE_COMMAND_ID,
  NOT_FOUND_BODY,
  createQaDeal,
  deleteQaDealIfExists,
  explainAuditEntry,
  listDealAuditActions,
  updateQaDeal,
  uniqueSuffix,
} from './helpers/explainApi'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * TC-INS-018: Explain one audit entry's cause
 * Covers:
 *   - GET /api/insights/explain/log?logId=
 *
 * A deal status change is explained as a proven `user` cause of the caller. An
 * audit entry from another organization answers exactly like a random id (404
 * `{"error":"not_found"}`) unless that organization is selected, and a malformed
 * id is rejected with 400.
 */
test.describe('TC-INS-018: explain an audit entry', () => {
  test('explains a deal log and hides logs of other organizations', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    let otherOrgId: string | null = null
    let otherDealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { tenantId, userId } = getTokenScope(token)
      const suffix = uniqueSuffix()
      dealId = await createQaDeal(request, token, { title: `QA INS-018 ${suffix}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: `qa_log_${suffix}` })
      const updateLog = (await listDealAuditActions(request, token, dealId))
        .find((item) => item.commandId === DEAL_UPDATE_COMMAND_ID)
      expect(updateLog, 'the status change is audited').toBeTruthy()

      const explained = await explainAuditEntry(request, token, updateLog!.id)
      expect(explained.status, `explain/log should return 200: ${explained.text}`).toBe(200)
      expect(explained.body).toEqual(expect.objectContaining({
        logId: updateLog!.id,
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: dealId,
        commandId: DEAL_UPDATE_COMMAND_ID,
        state: 'done',
        confidence: 'proven',
      }))
      expect(explained.body?.cause).toEqual(expect.objectContaining({ kind: 'user', legacy: false, derivedFromActor: false }))
      expect(explained.body?.actor).toEqual(expect.objectContaining({ kind: 'user', id: userId, isSelf: true, redacted: false }))
      expect(explained.body?.correlationId).toMatch(UUID_PATTERN)

      otherOrgId = await createOrganizationInDb({ name: `QA INS-018 Org ${suffix}`, tenantId })
      otherDealId = await createQaDeal(request, token, {
        title: `QA INS-018 other ${suffix}`,
        status: 'open',
        selectedOrgId: otherOrgId,
      })
      const otherLogs = await listDealAuditActions(request, token, otherDealId, { selectedOrgId: otherOrgId })
      expect(otherLogs.length, 'the other organization deal is audited').toBeGreaterThan(0)
      const otherLogId = otherLogs[0].id

      const inOwnOrg = await explainAuditEntry(request, token, otherLogId, { selectedOrgId: otherOrgId })
      expect(inOwnOrg.status, `the log is explainable inside its organization: ${inOwnOrg.text}`).toBe(200)
      expect(inOwnOrg.body?.resourceId).toBe(otherDealId)

      const outOfScope = await explainAuditEntry(request, token, otherLogId)
      expect(outOfScope.status, 'a log of another organization is not found').toBe(404)
      expect(outOfScope.body).toEqual(NOT_FOUND_BODY)

      const randomLog = await explainAuditEntry(request, token, randomUUID())
      expect(randomLog.status).toBe(404)
      expect(randomLog.text, 'out-of-scope and missing logs are indistinguishable').toBe(outOfScope.text)

      const malformed = await explainAuditEntry(request, token, `not-a-uuid-${suffix}`)
      expect(malformed.status, 'a malformed log id is rejected').toBe(400)
      expect(malformed.body).toEqual(expect.objectContaining({ error: 'invalid_query' }))
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
      await deleteQaDealIfExists(request, token, otherDealId, otherOrgId ? { selectedOrgId: otherOrgId } : {})
      await deleteOrganizationInDb(otherOrgId).catch(() => undefined)
    }
  })
})
