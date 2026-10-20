import { randomInt, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import {
  deleteEntityByPathIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DICTIONARY_ENTRY_RESOURCE_KIND,
  listActionLogs,
  listEntryActionLogs,
  patchDictionaryEntry,
  readCausationFrames,
} from './helpers/auditLogsApi'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * TC-AUD-009: Causation cannot be spoofed through request input
 * Covers:
 *   - POST  /api/dictionaries/{id}/entries
 *   - PATCH /api/dictionaries/{id}/entries/{entryId}
 *   - GET   /api/audit_logs/audit-logs/actions (causeKind, causeId, correlationId, context.causation)
 *
 * Client-controlled headers (`X-Business-Rule-Id`, `X-Workflow-Instance-Id`,
 * `X-Request-Id`) and a `causation` body field must never influence the cause
 * recorded for a write. A staff session write is always recorded as `user` with a
 * server-minted correlation id.
 */
test.describe('TC-AUD-009: causation cannot be spoofed by request input', () => {
  test('records staff writes as "user" despite spoofed headers and body fields', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const unique = `${Date.now()}_${randomInt(1_000_000)}`
      dictionaryId = await createDictionaryFixture(request, token, {
        key: `qa_aud009_${unique}`,
        name: `QA Audit 009 ${unique}`,
      })

      const spoofedCorrelationId = randomUUID()
      const spoofedHeaders = {
        'X-Business-Rule-Id': randomUUID(),
        'X-Workflow-Instance-Id': randomUUID(),
        'X-Request-Id': spoofedCorrelationId,
      }
      const spoofedCausation = {
        correlationId: spoofedCorrelationId,
        frames: [
          { kind: 'workflow', id: randomUUID() },
          { kind: 'business_rule', id: randomUUID() },
        ],
      }

      const createResponse = await apiRequest(
        request,
        'POST',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        {
          token,
          headers: spoofedHeaders,
          data: { value: `val_${unique}`, label: `Label ${unique}`, causation: spoofedCausation },
        },
      )
      expect(createResponse.status(), 'entry create with spoofed input still succeeds').toBe(201)
      const createBody = await readJsonSafe<{ id?: string }>(createResponse)
      const entryId = expectId(createBody?.id, 'entry create response should include id')

      const patchResult = await patchDictionaryEntry(request, token, {
        dictionaryId,
        entryId,
        headers: spoofedHeaders,
        data: { label: `Updated ${unique}`, causation: spoofedCausation },
      })
      expect(patchResult.status, `entry update with spoofed input still succeeds: ${patchResult.text}`).toBe(200)

      const items = await listEntryActionLogs(request, token, entryId)
      expect(items.length, 'both the create and the update are audited').toBeGreaterThanOrEqual(2)
      expect(items.some((item) => item.commandId === 'dictionaries.entries.update')).toBe(true)

      for (const item of items) {
        expect(item.causeKind, `${item.commandId} is recorded as a user write`).toBe('user')
        expect(item.causeId, `${item.commandId} has no cause id for a user write`).toBeNull()
        expect(item.causedByLogId ?? null, `${item.commandId} is not linked to another log`).toBeNull()
        expect(item.correlationId, `${item.commandId} carries a server-minted correlation id`).toMatch(UUID_PATTERN)
        expect(item.correlationId, `${item.commandId} ignores the spoofed correlation id`).not.toBe(spoofedCorrelationId)

        const frameKinds = readCausationFrames(item).map((frame) => frame.kind)
        expect(frameKinds.at(-1), `${item.commandId} innermost causation frame is "user"`).toBe('user')
        expect(frameKinds, 'spoofed workflow frame is never persisted').not.toContain('workflow')
        expect(frameKinds, 'spoofed business-rule frame is never persisted').not.toContain('business_rule')
      }

      const workflowFiltered = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: entryId,
        causeKind: 'workflow',
      })
      expect(workflowFiltered.status, 'the causeKind filter is accepted').toBe(200)
      expect(workflowFiltered.body?.items ?? [], 'no entry is attributed to the spoofed workflow').toHaveLength(0)

      const userFiltered = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: entryId,
        causeKind: 'user',
      })
      expect(userFiltered.body?.items.length, 'the causeKind=user filter returns every write').toBe(items.length)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
