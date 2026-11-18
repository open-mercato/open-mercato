import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'
import {
  createAgreementDocument,
  decideFinding,
  deleteDocumentIfExists,
  findingByTitle,
  type FindingBody,
  listFindings,
  readSummary,
} from './helpers/findingsFixtures'
import {
  createPlaybookOrFail,
  createRule,
  deletePlaybookIfExists,
  uniqueCode,
} from './helpers/reviewPlaybookFixtures'

/**
 * TC-DOC-AGENT-001: a review workflow persists a reviewer agent's outcome
 * through the workflow-safe `documents.finding.ingest` command and resumes on
 * the clearance signal.
 *
 * INVOKE_AGENT needs the enterprise orchestrator and a real model, so the
 * agent step is stubbed: the run starts with `context.review` already holding a
 * contract-shaped outcome (`documentReviewOutcomeSchema.data`), exactly what
 * `outputMapping: { review: 'data' }` would merge into the context. Everything
 * after it is the real path: tenant command enablement, the UPDATE_ENTITY
 * gates, whole-value interpolation of `{{context.review.findings}}` into an
 * array, the ingest command run as the workflow user, a human decision that
 * emits `documents.review.cleared`, and the test acting as the consumer
 * subscriber that answers it with the `documents_review_cleared` signal.
 */

export const integrationMeta = {
  dependsOnModules: ['documents', 'workflows', 'audit_logs'],
}

const INGEST_COMMAND_ID = 'documents.finding.ingest'
const COMMAND_SETTINGS_PATH = '/api/workflows/command-settings'
const SIGNAL_NAME = 'documents_review_cleared'
const REVIEW_CLEARED = 'documents.review.cleared'

type WorkflowFindingBody = FindingBody & {
  sourceWorkflowInstanceId?: string | null
  playbookId?: string | null
  ruleId?: string | null
}

type CommandSettingsBody = {
  configured?: boolean
  items?: Array<{ commandId: string; enabled: boolean }>
}

async function readEnabledCommandIds(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', COMMAND_SETTINGS_PATH, { token })
  expect(response.status(), 'GET workflow command settings should return 200').toBe(200)
  const body = await readJsonSafe<CommandSettingsBody>(response)
  const items = body?.items ?? []
  expect(items.map((item) => item.commandId), 'the ingest command is catalogued').toContain(INGEST_COMMAND_ID)
  return items.filter((item) => item.enabled).map((item) => item.commandId)
}

async function writeEnabledCommandIds(
  request: APIRequestContext,
  token: string,
  enabledCommandIds: string[],
): Promise<void> {
  const response = await apiRequest(request, 'PUT', COMMAND_SETTINGS_PATH, { token, data: { enabledCommandIds } })
  expect(response.status(), 'PUT workflow command settings should return 200').toBe(200)
}

async function emittedEventsFor(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    resourceKind: 'documents:document_finding',
    resourceId,
    sortDir: 'asc',
    pageSize: '50',
  })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${params.toString()}`, { token })
  expect(response.status(), 'GET audit log actions should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ context: { emittedEvents?: string[] } | null }> }>(response)
  return (body?.items ?? []).flatMap((item) => item.context?.emittedEvents ?? [])
}

function buildReviewWorkflowPayload(stamp: string) {
  const workflowId = `qa-doc-review-${stamp}`
  return {
    workflowId,
    workflowName: `QA Document Review ${stamp}`,
    description: 'Integration test definition for the document review flow',
    version: 1,
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'await_clearance',
          stepName: 'Await review clearance',
          stepType: 'WAIT_FOR_SIGNAL',
          signalConfig: { signalName: SIGNAL_NAME },
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-await',
          fromStepId: 'start',
          toStepId: 'await_clearance',
          trigger: 'auto',
          continueOnActivityFailure: false,
          activities: [
            {
              activityId: 'ingest_findings',
              activityName: 'Store review findings',
              activityType: 'UPDATE_ENTITY',
              async: false,
              config: {
                commandId: INGEST_COMMAND_ID,
                input: {
                  documentId: '{{context.documentId}}',
                  playbookCode: '{{context.playbookCode}}',
                  findings: '{{context.review.findings}}',
                  source: 'ai',
                  origin: { workflowInstanceId: '{{workflow.instanceId}}' },
                },
              },
            },
          ],
        },
        { transitionId: 'await-to-end', fromStepId: 'await_clearance', toStepId: 'end', trigger: 'auto' },
      ],
    },
  }
}

test.describe('TC-DOC-AGENT-001: review workflow ingests findings and resumes on clearance', () => {
  test('stubbed reviewer outcome → UPDATE_ENTITY ingest → decision → clearance signal', async ({ request }) => {
    test.setTimeout(120_000)
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    let token: string | null = null
    let documentId: string | null = null
    let playbookId: string | null = null
    let definitionId: string | null = null
    let instanceId: string | null = null
    let previousEnabled: string[] | null = null
    try {
      token = await getAuthToken(request, 'admin')
      documentId = await createAgreementDocument(request, token, `TC-DOC-AGENT-001 ${stamp}`)
      const playbookCode = uniqueCode('nda')
      playbookId = await createPlaybookOrFail(request, token, { code: playbookCode, name: `NDA ${stamp}` })
      const rule = await createRule(request, token, playbookId, {
        code: 'term',
        title: 'Confidentiality term',
        severity: 'blocking',
        preferredWording: 'secret for two years',
      })
      expect(rule.response.status(), 'POST review rule should return 201').toBe(201)

      previousEnabled = await readEnabledCommandIds(request, token)
      await writeEnabledCommandIds(request, token, [...new Set([...previousEnabled, INGEST_COMMAND_ID])])

      const payload = buildReviewWorkflowPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      const correlationKey = `documents-review:${documentId}:${stamp}`
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        correlationKey,
        initialContext: {
          documentId,
          playbookCode,
          review: {
            findings: [
              {
                severity: 'blocking',
                title: 'Confidentiality term',
                explanation: 'The term exceeds the playbook position.',
                ruleCode: 'term',
                quote: 'secret for five years',
                suggestedText: 'secret for two years',
              },
              {
                severity: 'warning',
                title: 'Definitions',
                explanation: 'Narrow the definition.',
                quote: 'any non-public information',
              },
            ],
            summary: { sectionsChecked: 3, rulesApplied: 1, truncated: false },
          },
        },
      })

      const parked = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'PAUSED' || instance.status === 'FAILED',
        { timeoutMs: 30_000 },
      )
      expect(parked?.status, 'the run parks on the clearance signal after the ingest').toBe('PAUSED')
      expect(parked?.currentStepId).toBe('await_clearance')

      const list = await listFindings(request, token, documentId)
      expect(list.total, 'both findings arrive as an array, not a string').toBe(2)
      const term: WorkflowFindingBody = findingByTitle(list, 'Confidentiality term')
      expect(term.source).toBe('ai')
      expect(term.sourceWorkflowInstanceId, 'the origin links the workflow run').toBe(instanceId)
      expect(term.playbookId, 'the playbook code resolves to the playbook').toBe(playbookId)
      expect(term.ruleId, 'the rule code resolves to the rule').toBeTruthy()
      const reviewId = list.reviewId as string
      expect((await readSummary(request, token, documentId)).open.blocking).toBe(1)
      expect(await emittedEventsFor(request, token, reviewId), 'an ingest with open blocking findings does not clear').not.toContain(REVIEW_CLEARED)

      const kept = await decideFinding(request, token, documentId, term, 'keep', { note: 'Accepted by counsel' })
      expect(kept.response.status(), 'keeping the blocking finding should return 200').toBe(200)
      expect((await readSummary(request, token, documentId)).open.blocking).toBe(0)
      expect(await emittedEventsFor(request, token, term.id), 'the decision clears the review').toContain(REVIEW_CLEARED)

      const signal = await apiRequest(request, 'POST', '/api/workflows/signals', {
        token,
        data: { correlationKey, signalName: SIGNAL_NAME, payload: { documentId, reviewId } },
      })
      expect(signal.status(), 'the consumer signal should be accepted').toBe(200)

      const completed = await pollWorkflowInstance(
        request,
        token,
        instanceId,
        (instance) => instance.status === 'COMPLETED' || instance.status === 'FAILED',
        { timeoutMs: 30_000 },
      )
      expect(completed?.status, 'the clearance signal resumes the run to the end').toBe('COMPLETED')
      instanceId = null
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
      if (token && previousEnabled) {
        await writeEnabledCommandIds(request, token, previousEnabled).catch(() => undefined)
      }
      await deletePlaybookIfExists(request, token, playbookId)
      await deleteDocumentIfExists(request, token, documentId)
    }
  })
})
