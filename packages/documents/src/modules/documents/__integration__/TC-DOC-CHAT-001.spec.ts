import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDocumentsUser,
  deleteDocumentIfExists,
  deleteDocumentsUser,
  findingByTitle,
  listFindings,
  shareDocument,
  type FindingsTestUser,
} from './helpers/findingsFixtures'
import {
  createReviewedAgreement,
  LAW_FINDING,
  loginWithToken,
  openDocumentChanges,
  TERM_FINDING,
} from './helpers/findingsUi'

export const integrationMeta = {
  dependsOnModules: ['documents', 'ai_assistant'],
}

const EXECUTE = '/api/ai_assistant/tools/execute'
const AGENTS = '/api/ai_assistant/ai/agents'
const AGENT_ID = 'documents.review_assistant'

type ExecuteBody<T> = { success?: boolean; result?: T; error?: string }
type ListedFinding = { id: string; title: string; severity: string; status: string; ruleCode: string | null; sectionLabel: string | null }

async function expectChatPanel(page: Page) {
  const region = page.getByRole('region', { name: 'AI chat' })
  await expect(region).toBeVisible({ timeout: 30_000 })
  return region
}

test.describe('TC-DOC-CHAT-001: review assistant chat', () => {
  test('exposes the agent and its finding tools, and refuses direct mutations', async ({ request }) => {
    let adminToken: string | null = null
    let documentId: string | null = null
    let commenter: FindingsTestUser | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const reviewed = await createReviewedAgreement(request, adminToken, `TC-DOC-CHAT-001 api ${Date.now()}`)
      documentId = reviewed.documentId
      const term = findingByTitle(reviewed.list, TERM_FINDING.title)

      const agents = await apiRequest(request, 'GET', AGENTS, { token: adminToken })
      expect(agents.status()).toBe(200)
      const agentList = await readJsonSafe<{ agents?: Array<{ id: string }> }>(agents)
      expect(agentList?.agents?.some((agent) => agent.id === AGENT_ID), 'review assistant should be listed').toBe(true)

      const list = await apiRequest(request, 'POST', EXECUTE, {
        token: adminToken,
        data: { toolName: 'documents.list_review_findings', args: { documentId, severity: 'blocking' } },
      })
      expect(list.status()).toBe(200)
      const listBody = await readJsonSafe<ExecuteBody<{ findings: ListedFinding[]; total: number }>>(list)
      expect(listBody?.success).toBe(true)
      expect(listBody?.result?.findings.map((finding) => finding.title)).toEqual([TERM_FINDING.title])
      expect(listBody?.result?.findings[0]).toEqual(expect.objectContaining({
        ruleCode: TERM_FINDING.ruleCode,
        sectionLabel: TERM_FINDING.sectionLabel,
        status: 'open',
      }))

      const detail = await apiRequest(request, 'POST', EXECUTE, {
        token: adminToken,
        data: { toolName: 'documents.get_review_finding', args: { documentId, findingId: term.id } },
      })
      expect(detail.status()).toBe(200)
      const detailBody = await readJsonSafe<ExecuteBody<{ id: string; quote: string; suggestedText: string | null }>>(detail)
      expect(detailBody?.result).toEqual(expect.objectContaining({
        id: term.id,
        quote: TERM_FINDING.quote,
        suggestedText: TERM_FINDING.suggestedText,
      }))

      for (const toolName of ['documents.apply_finding', 'documents.keep_finding', 'documents.reopen_finding']) {
        const direct = await apiRequest(request, 'POST', EXECUTE, {
          token: adminToken,
          data: { toolName, args: { documentId, findingId: term.id, note: 'direct' } },
        })
        expect(direct.status(), `${toolName} must not run without approval`).toBe(403)
      }
      const after = findingByTitle(await listFindings(request, adminToken, documentId), TERM_FINDING.title)
      expect(after.status).toBe('open')
      expect(after.updatedAt).toBe(term.updatedAt)

      commenter = await createDocumentsUser(request, adminToken, {
        label: 'chat-commenter',
        features: ['documents.view', 'documents.edit', 'ai_assistant.view'],
      })
      await shareDocument(request, adminToken, documentId, commenter.id, 'commenter')
      const hidden = await apiRequest(request, 'POST', EXECUTE, {
        token: commenter.token,
        data: { toolName: 'documents.list_review_findings', args: { documentId } },
      })
      expect(hidden.status(), 'commenters cannot read findings through the assistant').not.toBe(200)
    } finally {
      await deleteDocumentsUser(request, adminToken, commenter)
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })

  test('opens the chat in the rail, moves it to the dock and back, and asks about a finding', async ({ page, request }) => {
    test.slow()
    let adminToken: string | null = null
    let documentId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const reviewed = await createReviewedAgreement(request, adminToken, `TC-DOC-CHAT-001 ui ${Date.now()}`, [TERM_FINDING, LAW_FINDING])
      documentId = reviewed.documentId
      await loginWithToken(page, adminToken)
      const panel = await openDocumentChanges(page, documentId)

      const assistantTab = page.getByRole('tab', { name: 'Ask AI' })
      await expect(assistantTab).toBeVisible()
      await assistantTab.click()
      await expect(assistantTab).toHaveAttribute('aria-selected', 'true')
      const railChat = await expectChatPanel(page)
      const composer = railChat.getByLabel('Message composer')
      await composer.fill('Draft kept across placements')

      await page.getByTestId('documents-review-assistant-placement-toggle').click()
      const dock = page.getByTestId('documents-review-assistant-dock')
      await expect(dock).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Ask AI' })).toHaveCount(0)
      const dockChat = dock.getByRole('region', { name: 'AI chat' })
      await expect(dockChat).toBeVisible()
      await expect(dockChat.getByLabel('Message composer')).toHaveValue('Draft kept across placements')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('documents-review-assistant-dock')).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('documents-review-assistant-dock-collapse').click()
      await expect(page.getByTestId('documents-review-assistant-dock').getByRole('region', { name: 'AI chat' })).toBeVisible()

      await page.getByTestId('documents-review-assistant-placement-toggle').click()
      await expect(page.getByTestId('documents-review-assistant-dock')).toHaveCount(0)
      await expect(page.getByRole('tab', { name: 'Ask AI' })).toHaveAttribute('aria-selected', 'true')
      await expectChatPanel(page)

      await page.getByRole('tab', { name: /Changes/ }).click()
      const termCard = panel.getByTestId('documents-finding-card').filter({ hasText: TERM_FINDING.title })
      await termCard.getByTestId('documents-finding-ask-ai').click()
      await expect(page.getByRole('tab', { name: 'Ask AI' })).toHaveAttribute('aria-selected', 'true')
      const askChat = await expectChatPanel(page)
      await expect(askChat.getByLabel('Message composer')).toHaveValue(new RegExp(TERM_FINDING.title))
    } finally {
      await deleteDocumentIfExists(request, adminToken, documentId)
    }
  })
})
