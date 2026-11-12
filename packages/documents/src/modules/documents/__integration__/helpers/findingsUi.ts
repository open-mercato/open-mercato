import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAgreementDocument,
  ingestFindings,
  listFindings,
  type FindingInput,
  type FindingListBody,
} from './findingsFixtures'

export const FINDINGS_UI_BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

export const TERM_FINDING: FindingInput = {
  severity: 'blocking',
  title: 'Confidentiality term too long',
  explanation: 'The term exceeds the standard two-year position.',
  ruleCode: 'NDA-3.1',
  sectionLabel: '2. Obligations',
  quote: 'secret for five years',
  suggestedText: 'secret for two years',
}

export const LAW_FINDING: FindingInput = {
  severity: 'warning',
  title: 'Governing law favours the discloser',
  explanation: 'Prefer the home jurisdiction.',
  ruleCode: 'NDA-7.2',
  sectionLabel: '3. Governing Law',
  quote: 'laws of the disclosing party',
  suggestedText: 'laws of the receiving party',
}

export const MISSING_FINDING: FindingInput = {
  severity: 'info',
  title: 'Notice clause missing',
  explanation: 'Consider adding a notice clause.',
  quote: 'This passage does not exist in the agreement',
  suggestedText: 'Notices must be sent in writing.',
}

export async function createReviewedAgreement(
  request: APIRequestContext,
  token: string,
  title: string,
  findings: FindingInput[] = [TERM_FINDING, LAW_FINDING, MISSING_FINDING],
): Promise<{ documentId: string; list: FindingListBody }> {
  const documentId = await createAgreementDocument(request, token, title)
  const ingest = await ingestFindings(request, token, documentId, { findings })
  expect(ingest.response.status(), 'POST findings should return 201').toBe(201)
  return { documentId, list: await listFindings(request, token, documentId) }
}

export async function loginWithToken(page: Page, token: string): Promise<void> {
  const scope = getTokenContext(token)
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: FINDINGS_UI_BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: FINDINGS_UI_BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: FINDINGS_UI_BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: FINDINGS_UI_BASE_URL },
    { name: 'om_cookie_notice_ack', value: 'ack', url: FINDINGS_UI_BASE_URL },
    { name: 'om_feedback_suppress', value: '1', url: FINDINGS_UI_BASE_URL },
  ])
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

export function editorLocator(page: Page): Locator {
  return page.locator('.ProseMirror:visible').first()
}

export async function openDocumentChanges(page: Page, documentId: string): Promise<Locator> {
  await page.goto(`/backend/documents/${encodeURIComponent(documentId)}`, { waitUntil: 'domcontentloaded' })
  await expect(editorLocator(page)).toContainText('Mutual Non-Disclosure Agreement', { timeout: 30_000 })
  const changesTab = page.getByRole('tab', { name: /Changes/ })
  await expect(changesTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  const panel = page.getByTestId('documents-findings-panel')
  await expect(panel).toBeVisible()
  return panel
}

export const SINGLE_USER_FALLBACK_NOTICE = 'Realtime is unavailable — changes are saved in single-user mode.'

export async function isRealtimeConnected(page: Page): Promise<boolean> {
  const fallbackNotice = page.getByText(SINGLE_USER_FALLBACK_NOTICE)
  await expect(page.getByText('Live', { exact: true }).or(fallbackNotice).first()).toBeVisible({ timeout: 30_000 })
  return (await fallbackNotice.count()) === 0
}

export async function readPersistedContentHtml(request: APIRequestContext, token: string, documentId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/documents/${encodeURIComponent(documentId)}/content`, { token })
  if (response.status() !== 200) return ''
  const body = await readJsonSafe<{ contentHtml?: string }>(response)
  return body?.contentHtml ?? ''
}

export function findingCard(page: Page, title: string): Locator {
  return page.getByTestId('documents-finding-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

export async function selectEditorText(page: Page, expected: string): Promise<void> {
  const editor = editorLocator(page)
  await expect(editor).toContainText(expected)
  await editor.focus()
  await editor.evaluate((root, selectionText) => {
    const nodes: Text[] = []
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('.collaboration-carets__caret')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
      },
    })
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    const fullText = nodes.map((node) => node.data).join('')
    const start = fullText.indexOf(selectionText)
    if (start < 0) throw new Error(`[internal] Could not find editor text: ${selectionText}`)
    const locate = (absoluteOffset: number): { node: Text; offset: number } => {
      let remaining = absoluteOffset
      for (const node of nodes) {
        if (remaining <= node.data.length) return { node, offset: remaining }
        remaining -= node.data.length
      }
      throw new Error(`[internal] Editor offset ${absoluteOffset} is outside its text content`)
    }
    const from = locate(start)
    const to = locate(start + selectionText.length)
    const range = root.ownerDocument.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    const selection = root.ownerDocument.defaultView?.getSelection()
    if (!selection) throw new Error('[internal] Browser selection is unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    root.ownerDocument.dispatchEvent(new Event('selectionchange'))
  }, expected)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(expected)
}
