import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { ownerPolicyRequest } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  textPart,
  uniqueRunId,
  waitForDeleteFeatureCheck,
  waitForEmailAttachmentList,
  waitForTerminalEmailStatus,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments', 'messages'] }

function baseUrl(): string {
  return process.env.BASE_URL?.trim() || 'http://localhost:3000'
}

function jwtSubject(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { sub?: unknown }
  if (typeof payload.sub !== 'string') throw new Error('[internal] token has no subject')
  return payload.sub
}

/** Collects hydration and uncaught page errors while a route loads. */
function trackHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

async function signInAs(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{ name: 'auth_token', value: token, url: baseUrl(), sameSite: 'Lax' }])
}

function logRow(page: Page, subject: string) {
  return page.getByRole('row').filter({ has: page.getByText(subject, { exact: true }) })
}

async function openRowActions(page: Page, subject: string): Promise<void> {
  const row = logRow(page, subject)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Open actions' }).click()
}

/**
 * TC-INBOX-ATT-009: the attachments of an inbound email are listed on the proposal page, in the
 * mirrored Messages thread and in the processing log's "Show attachments" dialog. A user with
 * `inbox_ops.log.view` but not `inbox_ops.proposals.view` sees no "Show attachments" action and,
 * as a recipient of the thread, no attachment section (the list route answers 403). Every route
 * loads without hydration errors. The proposal and the Message are inserted for the ingested email
 * because CI has no LLM key.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md (Phase 3)
 */
test.describe('TC-INBOX-ATT-009: attachment lists and their visibility', () => {
  test('lists the files on the proposal, the Messages thread and the log, and hides them from log-only viewers', async ({ page, request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS * 2)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-009')
    const subject = `Offer ${run}`
    const offerName = `${run}-offer.txt`
    const priceListName = `${run}-prices.csv`
    const proposalId = randomUUID()
    let proposalInserted = false
    let messageId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject,
        text: 'Offer and price list attached.',
        attachments: [
          textPart(offerName, 'Offer: 10 x Widget at 4.50'),
          { filename: priceListName, contentType: 'text/csv', content: 'sku,price\nW-1,4.50\n' },
        ],
      })
      expect(received.email.attachmentIds ?? []).toHaveLength(2)
      await waitForTerminalEmailStatus(request, admin, received.emailId)

      roleId = await createRoleFixture(request, admin, { name: run, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, admin, { roleId, features: ['inbox_ops.log.view', 'messages.view'] })
      const viewerEmail = `${run}@example.com`
      const viewerPassword = `Inbox1!${randomUUID()}`
      userId = await createUserFixture(request, admin, {
        email: viewerEmail,
        password: viewerPassword,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'Log viewer',
      })
      const logViewer = await getAuthToken(request, viewerEmail, viewerPassword)

      await withClient(async (client) => {
        await client.query(
          `insert into inbox_proposals
             (id, inbox_email_id, summary, participants, confidence, status, possibly_incomplete, is_active, organization_id, tenant_id, created_at, updated_at)
           values ($1, $2, $3, '[]'::jsonb, 0.9, 'pending', false, true, $4, $5, now(), now())`,
          [proposalId, received.emailId, `Proposal ${run}`, scope.organizationId, scope.tenantId],
        )
      })
      proposalInserted = true

      // The mirrored thread: composed through the API (so subject and body are stored as the module
      // stores them), then turned into an `inbox_ops.email` message linked to the email.
      const composed = await apiRequest(request, 'POST', '/api/messages', {
        token: admin,
        data: {
          recipients: [{ userId: jwtSubject(logViewer), type: 'to' }],
          subject,
          body: 'Offer and price list attached.',
          sendViaEmail: false,
        },
      })
      expect(composed.status(), 'POST /api/messages should create the thread fixture').toBe(201)
      messageId = (await readJsonSafe<{ id?: string }>(composed))?.id ?? null
      expect(messageId).toBeTruthy()
      await withClient(async (client) => {
        await client.query(`update messages set type = 'inbox_ops.email' where id = $1`, [messageId])
        await client.query(
          `insert into message_objects (id, message_id, entity_module, entity_type, entity_id, action_required, created_at)
           values ($1, $2, 'inbox_ops', 'inbox_email', $3, false, now())`,
          [randomUUID(), messageId, received.emailId],
        )
      })

      const adminErrors = trackHydrationErrors(page)
      await login(page, 'admin')

      await page.goto(`/backend/inbox-ops/proposals/${proposalId}`)
      const proposalSection = page.getByRole('button', { name: /Attachments section/ })
      await expect(proposalSection).toBeVisible()
      await expect(page.getByText(offerName, { exact: true })).toBeVisible()
      await expect(page.getByText(priceListName, { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: `Download ${offerName}` })).toHaveAttribute('href', /\/api\/attachments\/file\//)

      await page.goto(`/backend/messages/${messageId}`)
      await expect(page.getByText(offerName, { exact: true })).toBeVisible()
      await expect(page.getByText(priceListName, { exact: true })).toBeVisible()

      const attachmentRequests: string[] = []
      page.on('request', (req) => {
        if (/\/api\/inbox_ops\/emails\/[^/]+\/attachments/.test(req.url())) attachmentRequests.push(req.url())
      })
      await page.goto('/backend/inbox-ops/log')
      await expect(logRow(page, subject)).toBeVisible()
      expect(attachmentRequests, 'the log page issues no attachment request on load').toEqual([])
      await openRowActions(page, subject)
      await page.getByRole('menuitem', { name: 'Show attachments' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText(offerName, { exact: true })).toBeVisible()
      await expect(dialog.getByText(priceListName, { exact: true })).toBeVisible()
      expect(attachmentRequests.every((url) => url.includes(received.emailId))).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(adminErrors, 'admin routes should load without hydration errors').toEqual([])

      const listAsViewer = await ownerPolicyRequest('GET', `/api/inbox_ops/emails/${received.emailId}/attachments`, logViewer)
      expect(listAsViewer.status).toBe(403)

      await page.context().clearCookies()
      const viewerErrors = trackHydrationErrors(page)
      await signInAs(page, logViewer)
      // Row actions settle only after the Delete feature check; absence is asserted after it answered.
      const viewerFeatureCheck = waitForDeleteFeatureCheck(page)
      await page.goto('/backend/inbox-ops/log')
      await viewerFeatureCheck
      await expect(logRow(page, subject)).toBeVisible()
      await expect(logRow(page, subject).getByRole('button', { name: 'Open actions' })).toHaveCount(0)

      // The list renders nothing while loading, so its absence is asserted after the 403 arrived.
      const viewerList = waitForEmailAttachmentList(page, received.emailId)
      await page.goto(`/backend/messages/${messageId}`)
      expect((await viewerList).status(), 'the thread recipient may not list the email attachments').toBe(403)
      await expect(page.getByText('Offer and price list attached.').first()).toBeVisible()
      await expect(page.getByRole('button', { name: /Attachments section/ })).toHaveCount(0)
      await expect(page.getByText(offerName, { exact: true })).toHaveCount(0)
      expect(viewerErrors, 'log-viewer routes should load without hydration errors').toEqual([])
    } finally {
      if (messageId) {
        await withClient(async (client) => {
          await client.query('delete from message_objects where message_id = $1', [messageId])
          await client.query('delete from message_recipients where message_id = $1', [messageId])
          await client.query('delete from messages where id = $1', [messageId])
        }).catch(() => undefined)
      }
      // Each cleanup runs even when an earlier one fails.
      if (proposalInserted) {
        await withClient(async (client) => {
          await client.query('delete from inbox_proposals where id = $1', [proposalId])
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, admin, userId).catch(() => undefined)
      await deleteRoleIfExists(request, admin, roleId).catch(() => undefined)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
