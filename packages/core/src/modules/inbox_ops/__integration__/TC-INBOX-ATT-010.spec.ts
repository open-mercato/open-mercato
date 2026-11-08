import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { expectConflictBanner } from '@open-mercato/core/helpers/integration/optimisticLockUi'
import {
  INGEST_QUEUE,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  fetchInboxEmail,
  findInboundEmailIds,
  postResendEmailReceived,
  readEmailAttachmentRows,
  receiveInboundEmail,
  registerInboundFixture,
  resolveInboxAddress,
  setInboundFixtureFailDownloads,
  skipUnlessResendStubAvailable,
  textPart,
  uniqueRunId,
  waitForAttachmentsCompleted,
  waitForTerminalEmailStatus,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

function baseUrl(): string {
  return process.env.BASE_URL?.trim() || 'http://localhost:3000'
}

function trackHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

function trackDeleteRequests(page: Page, emailId: string): string[] {
  const requests: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && req.url().includes(`/api/inbox_ops/emails/${emailId}`)) requests.push(req.url())
  })
  return requests
}

function logRow(page: Page, subject: string) {
  return page.getByRole('row').filter({ has: page.getByText(subject, { exact: true }) })
}

async function openDeleteDialog(page: Page, subject: string) {
  const row = logRow(page, subject)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Open actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete email' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Delete email?')).toBeVisible()
  return dialog
}

/**
 * TC-INBOX-ATT-010: "Delete email" on the processing log — Escape cancels without a request, a user
 * without `inbox_ops.proposals.manage` sees no Delete action and gets 403 from the route, an email
 * changed after the page loaded surfaces the conflict bar, and confirming with Cmd/Ctrl+Enter
 * deletes the email and releases its files. Retry on an email whose attachment downloads keep
 * failing re-enqueues the ingest once the provider recovers.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md (Phase 3)
 */
test.describe('TC-INBOX-ATT-010: Delete email and Retry from the processing log', () => {
  test('Delete: Escape, permission, optimistic-lock conflict and confirmed release', async ({ page, request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS * 2)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-010-delete')
    const subject = `Delete ${run}`
    let roleId: string | null = null
    let userId: string | null = null
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject,
        text: 'File attached.',
        attachments: [textPart(`${run}.txt`, 'delete me')],
      })
      expect(received.email.attachmentIds ?? []).toHaveLength(1)
      await waitForTerminalEmailStatus(request, admin, received.emailId)

      roleId = await createRoleFixture(request, admin, { name: run, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, admin, { roleId, features: ['inbox_ops.log.view', 'inbox_ops.proposals.view'] })
      const reviewerEmail = `${run}@example.com`
      const reviewerPassword = `Inbox1!${randomUUID()}`
      userId = await createUserFixture(request, admin, {
        email: reviewerEmail,
        password: reviewerPassword,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'Reviewer without manage',
      })
      const reviewer = await getAuthToken(request, reviewerEmail, reviewerPassword)

      const reviewerErrors = trackHydrationErrors(page)
      await page.context().addCookies([{ name: 'auth_token', value: reviewer, url: baseUrl(), sameSite: 'Lax' }])
      await page.goto('/backend/inbox-ops/log')
      await logRow(page, subject).getByRole('button', { name: 'Open actions' }).click()
      await expect(page.getByRole('menuitem', { name: 'Show attachments' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Delete email' })).toHaveCount(0)
      expect((await ownerPolicyRequest('DELETE', `/api/inbox_ops/emails/${received.emailId}`, reviewer)).status).toBe(403)
      expect(reviewerErrors).toEqual([])

      await page.context().clearCookies()
      const adminErrors = trackHydrationErrors(page)
      const deleteRequests = trackDeleteRequests(page, received.emailId)
      await login(page, 'admin')
      await page.goto('/backend/inbox-ops/log')

      let dialog = await openDeleteDialog(page, subject)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(deleteRequests, 'Escape must cancel without a request').toEqual([])

      dialog = await openDeleteDialog(page, subject)
      await withClient(async (client) => {
        await client.query(`update inbox_emails set updated_at = updated_at + interval '1 second' where id = $1`, [received.emailId])
      })
      await page.keyboard.press('ControlOrMeta+Enter')
      await expectConflictBanner(page)
      await expect(dialog).toBeVisible()
      expect(deleteRequests).toHaveLength(1)
      expect((await fetchInboxEmail(request, admin, received.emailId)).status, 'a stale delete must not delete').toBe(200)

      await page.reload()
      dialog = await openDeleteDialog(page, subject)
      await page.keyboard.press('ControlOrMeta+Enter')
      await expect(dialog).toHaveCount(0)
      await expect(logRow(page, subject)).toHaveCount(0)
      expect(deleteRequests).toHaveLength(2)
      expect((await fetchInboxEmail(request, admin, received.emailId)).status).toBe(404)
      await expect.poll(async () => (await readEmailAttachmentRows(received.emailId)).length, {
        message: 'the email attachments should be released',
      }).toBe(0)
      expect(adminErrors).toEqual([])
    } finally {
      await deleteUserIfExists(request, admin, userId)
      await deleteRoleIfExists(request, admin, roleId)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })

  test('Retry re-enqueues an ingest whose downloads kept failing', async ({ page, request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS * 2)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-010-retry')
    const subject = `Retry ${run}`
    const fileName = `${run}.txt`
    try {
      const to = await resolveInboxAddress(request, admin)
      const from = `Supplier <supplier@tc-inbox-att.example.test>`
      const fixture = await registerInboundFixture({ to, from, subject, text: 'File attached.', attachments: [textPart(fileName, 'retry me')], failDownloads: true })
      tracker.fixtures.push(fixture.providerEmailId)
      expect(await postResendEmailReceived({ providerEmailId: fixture.providerEmailId, to, from })).toBe(200)
      const emailIds = await findInboundEmailIds(admin, fixture.providerEmailId)
      tracker.emails.push(...emailIds)
      const [emailId] = emailIds
      expect(emailId).toBeTruthy()

      // The queue's attempts are spent and the delayed retry waits: pending, failure clock started,
      // next run in the future.
      await expect.poll(async () => {
        await drainIntegrationQueue(INGEST_QUEUE)
        return withClient(async (client) => {
          const result = await client.query<{ waiting: boolean }>(
            `select (attachments_status = 'pending' and attachments_first_failure_at is not null and attachments_next_run_at > now()) as waiting
               from inbox_emails where id = $1`,
            [emailId],
          )
          return result.rows[0]?.waiting === true
        })
      }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000], message: 'the ingest should wait for its delayed retry' }).toBe(true)

      await setInboundFixtureFailDownloads(fixture.providerEmailId, false)

      const errors = trackHydrationErrors(page)
      await login(page, 'admin')
      await page.goto('/backend/inbox-ops/log')
      const row = logRow(page, subject)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'Retry' }).click()
      await expect(page.getByText('Reprocessing started')).toBeVisible()

      const email = await waitForAttachmentsCompleted(request, admin, emailId)
      expect(email.attachmentIds ?? []).toHaveLength(1)
      const parts = await withClient(async (client) => {
        const result = await client.query<{ status: string }>('select status from inbox_email_attachments where inbox_email_id = $1', [emailId])
        return result.rows.map((part) => part.status)
      })
      expect(parts).toEqual(['stored'])
      expect(errors).toEqual([])
    } finally {
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
